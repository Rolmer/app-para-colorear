"""Rasterizador minimo del subconjunto de SVG que usan las laminas.

Soporta: rect, circle, ellipse, path (M, L, C, Q, Z en coordenadas absolutas),
atributo transform="translate(x,y)" y las clases .rg (relleno blanco + trazo)
y .ln (solo trazo). Se usa para revisar las laminas sin navegador.

Genera un PNG por lamina y una hoja de contactos con todas.
"""
from __future__ import annotations

import math
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIBUJOS = RAIZ / "dibujos"
SALIDA = RAIZ / "herramientas" / "_png"
NS = "{http://www.w3.org/2000/svg}"
ESCALA = 2  # supersampling
COLOR_LINEA = (31, 36, 48, 255)
COLOR_FONDO = (255, 255, 255, 255)

NUM = re.compile(r"-?\d*\.?\d+(?:e-?\d+)?")
CMD = re.compile(r"([MmLlCcQqZzHhVv])")


def numeros(texto: str) -> list[float]:
    return [float(n) for n in NUM.findall(texto)]


def caja_transform(texto: str | None) -> tuple[float, float]:
    if not texto:
        return (0.0, 0.0)
    m = re.search(r"translate\(\s*(-?[\d.]+)\s*[,\s]\s*(-?[\d.]+)?\s*\)", texto)
    if not m:
        return (0.0, 0.0)
    dx = float(m.group(1))
    dy = float(m.group(2)) if m.group(2) else 0.0
    return (dx, dy)


def cubicos(p0, p1, p2, p3, pasos=28):
    pts = []
    for i in range(1, pasos + 1):
        t = i / pasos
        u = 1 - t
        x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        pts.append((x, y))
    return pts


def cuadraticos(p0, p1, p2, pasos=20):
    pts = []
    for i in range(1, pasos + 1):
        t = i / pasos
        u = 1 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


def puntos_de_path(d: str) -> tuple[list[tuple[float, float]], list[list[tuple[float, float]]]]:
    """Devuelve (subpuntos, subtrazos) donde cada subtrazo es una polilinea."""
    tokens = [t for t in CMD.split(d) if t.strip()]
    subtrazos: list[list[tuple[float, float]]] = []
    actual: list[tuple[float, float]] = []
    pos = (0.0, 0.0)
    inicio = (0.0, 0.0)
    i = 0
    while i < len(tokens):
        comando = tokens[i]
        args = numeros(tokens[i + 1]) if i + 1 < len(tokens) and not CMD.fullmatch(tokens[i + 1].strip()) else []
        i += 2
        mayus = comando.isupper()
        c = comando.upper()
        if c == "M":
            for k in range(0, len(args) - 1, 2):
                p = (args[k], args[k + 1])
                if not mayus:
                    p = (pos[0] + p[0], pos[1] + p[1])
                if k == 0:
                    if len(actual) > 1:
                        subtrazos.append(actual)
                    actual = [p]
                    inicio = p
                else:
                    actual.append(p)
                pos = p
        elif c == "L":
            for k in range(0, len(args) - 1, 2):
                p = (args[k], args[k + 1])
                if not mayus:
                    p = (pos[0] + p[0], pos[1] + p[1])
                actual.append(p)
                pos = p
        elif c == "H":
            for v in args:
                p = (v if mayus else pos[0] + v, pos[1])
                actual.append(p)
                pos = p
        elif c == "V":
            for v in args:
                p = (pos[0], v if mayus else pos[1] + v)
                actual.append(p)
                pos = p
        elif c == "C":
            for k in range(0, len(args) - 5, 6):
                pts = [(args[k], args[k + 1]), (args[k + 2], args[k + 3]), (args[k + 4], args[k + 5])]
                if not mayus:
                    pts = [(pos[0] + px, pos[1] + py) for px, py in pts]
                actual.extend(cubicos(pos, pts[0], pts[1], pts[2]))
                pos = pts[2]
        elif c == "Q":
            for k in range(0, len(args) - 3, 4):
                pts = [(args[k], args[k + 1]), (args[k + 2], args[k + 3])]
                if not mayus:
                    pts = [(pos[0] + px, pos[1] + py) for px, py in pts]
                actual.extend(cuadraticos(pos, pts[0], pts[1]))
                pos = pts[1]
        elif c == "Z":
            if actual:
                actual.append(inicio)
                subtrazos.append(actual)
                actual = []
                pos = inicio
    if len(actual) > 1:
        subtrazos.append(actual)
    planos = [p for sub in subtrazos for p in sub]
    return planos, subtrazos


def color_de(texto: str | None):
    """Convierte '#rrggbb', '#rgb' o 'rgb(r,g,b)' en una tupla RGBA."""
    if not texto:
        return None
    t = texto.strip().lower()
    if t in ("none", "transparent"):
        return None
    if t.startswith("#"):
        h = t[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) >= 6:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
        return None
    numeros_rgb = re.findall(r"[\d.]+", t)
    if len(numeros_rgb) >= 3:
        return tuple(int(float(v)) for v in numeros_rgb[:3]) + (255,)
    return None


def estilos_en_linea(el: ET.Element) -> dict[str, str]:
    salida: dict[str, str] = {}
    for parte in (el.get("style") or "").split(";"):
        if ":" in parte:
            clave, valor = parte.split(":", 1)
            salida[clave.strip().lower()] = valor.strip()
    return salida


def forma_de_elemento(el: ET.Element):
    """Devuelve (subtrazos, cerrado) en coordenadas locales."""
    etiqueta = el.tag.replace(NS, "")
    if etiqueta == "rect":
        x, y = float(el.get("x", 0)), float(el.get("y", 0))
        w, h = float(el.get("width", 0)), float(el.get("height", 0))
        r = float(el.get("rx", 0) or 0)
        if r > 0:
            r = min(r, w / 2, h / 2)
            d = (
                f"M{x + r},{y} L{x + w - r},{y} Q{x + w},{y} {x + w},{y + r} "
                f"L{x + w},{y + h - r} Q{x + w},{y + h} {x + w - r},{y + h} "
                f"L{x + r},{y + h} Q{x},{y + h} {x},{y + h - r} "
                f"L{x},{y + r} Q{x},{y} {x + r},{y} Z"
            )
        else:
            d = f"M{x},{y} L{x + w},{y} L{x + w},{y + h} L{x},{y + h} Z"
        _, subs = puntos_de_path(d)
        return subs, True
    if etiqueta == "circle":
        cx, cy, r = (float(el.get(k, 0)) for k in ("cx", "cy", "r"))
        return circulo(cx, cy, r), True
    if etiqueta == "ellipse":
        cx, cy = float(el.get("cx", 0)), float(el.get("cy", 0))
        rx, ry = float(el.get("rx", 0)), float(el.get("ry", 0))
        return elipse(cx, cy, rx, ry), True
    if etiqueta == "path":
        _, subs = puntos_de_path(el.get("d", ""))
        return subs, False
    return [], False


def circulo(cx, cy, r, pasos=64):
    return [[(cx + r * math.cos(2 * math.pi * i / pasos), cy + r * math.sin(2 * math.pi * i / pasos)) for i in range(pasos + 1)]]


def elipse(cx, cy, rx, ry, pasos=64):
    return [[(cx + rx * math.cos(2 * math.pi * i / pasos), cy + ry * math.sin(2 * math.pi * i / pasos)) for i in range(pasos + 1)]]


def render(ruta_svg: pathlib.Path, escala: int = ESCALA) -> Image.Image:
    arbol = ET.parse(ruta_svg)
    raiz_el = arbol.getroot()
    ancho = float(re.sub(r"[^\d.]", "", raiz_el.get("width", "400")))
    alto = float(re.sub(r"[^\d.]", "", raiz_el.get("height", "520")))
    img = Image.new("RGBA", (int(ancho * escala), int(alto * escala)), (255, 255, 255, 255))
    dibujo = ImageDraw.Draw(img)

    def pintar(el, dx, dy):
        tag = el.tag.replace(NS, "")
        if tag in {"svg", "g"}:
            tdx, tdy = caja_transform(el.get("transform"))
            for hijo in el:
                pintar(hijo, dx + tdx, dy + tdy)
            return
        clases = (el.get("class") or "").split()
        edx, edy = caja_transform(el.get("transform"))
        dx += edx
        dy += edy
        subs, _ = forma_de_elemento(el)
        if not subs:
            return
        relleno = COLOR_FONDO if "rg" in clases else None
        trazo = COLOR_LINEA
        est = estilos_en_linea(el)
        relleno_attr = est.get("fill", el.get("fill"))
        trazo_attr = est.get("stroke", el.get("stroke"))
        ancho_attr = est.get("stroke-width", el.get("stroke-width"))
        if relleno_attr is not None:
            relleno = color_de(relleno_attr)
        if trazo_attr is not None:
            trazo = color_de(trazo_attr)
        grosor = max(1.0, float(ancho_attr) * escala) if ancho_attr else max(1.0, 3.5 * escala)
        for sub in subs:
            pts = [((x + dx) * escala, (y + dy) * escala) for x, y in sub]
            if relleno and len(pts) > 2:
                dibujo.polygon(pts, fill=relleno)
            if trazo and len(pts) > 1:
                dibujo.line(pts, fill=trazo, width=int(round(grosor)), joint="curve")
                if len(pts) > 2:
                    r = grosor / 2
                    for px, py in (pts[0], pts[-1]):
                        dibujo.ellipse([px - r, py - r, px + r, py + r], fill=trazo)

    tdx, tdy = caja_transform(raiz_el.get("transform"))
    for hijo in raiz_el:
        pintar(hijo, tdx, tdy)
    return img.resize((int(ancho), int(alto)), Image.LANCZOS)


def hoja_de_contactos(imagenes: list[tuple[str, Image.Image]], columnas: int = 4) -> Image.Image:
    if not imagenes:
        raise SystemExit("Nada que componer")
    w, h = imagenes[0][1].size
    filas = math.ceil(len(imagenes) / columnas)
    hoja = Image.new("RGB", (columnas * (w + 12) + 12, filas * (h + 12) + 12), (238, 242, 247))
    for i, (_nombre, im) in enumerate(imagenes):
        cx = 12 + (i % columnas) * (w + 12)
        cy = 12 + (i // columnas) * (h + 12)
        hoja.paste(im.convert("RGB"), (cx, cy))
    return hoja


def main() -> int:
    SALIDA.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 1:
        # Se indican archivos concretos: se rasterizan uno a uno.
        for argumento in sys.argv[1:]:
            ruta = pathlib.Path(argumento)
            if not ruta.is_absolute():
                ruta = (RAIZ / argumento).resolve()
            if not ruta.exists():
                print("No existe", ruta)
                return 1
            destino = SALIDA / f"{ruta.stem}.png"
            render(ruta).save(destino)
            print(destino)
        return 0

    svgs = sorted(DIBUJOS.glob("*.svg"))
    if not svgs:
        print("No hay laminas en", DIBUJOS)
        return 1
    imagenes = []
    for ruta in svgs:
        im = render(ruta)
        destino = SALIDA / f"{ruta.stem}.png"
        im.save(destino)
        imagenes.append((ruta.stem, im))
        print("ok", destino.name)
    hoja = hoja_de_contactos(imagenes)
    hoja_ruta = RAIZ / "herramientas" / "_contacto.png"
    hoja.save(hoja_ruta)
    print("hoja de contactos ->", hoja_ruta, hoja.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
