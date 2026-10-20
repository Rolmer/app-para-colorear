"""Empaqueta las laminas SVG en js/dibujos.js.

Lee dibujos/*.svg y dibujos/manifest.json, y escribe un archivo JavaScript con
la lista de dibujos (nombre, titulo, categoria y el marcado SVG). Asi la app
funciona abriendo index.html directamente, sin servidor ni peticiones de red.

Uso:  python herramientas/empaquetar.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIBUJOS = RAIZ / "dibujos"
DESTINO = RAIZ / "js" / "dibujos.js"
CABECERA = """/* Archivo generado por herramientas/empaquetar.py. No lo edites a mano:
   anade o cambia los .svg en dibujos/ y vuelve a ejecutar el script. */
window.DIBUJOS = [
"""
PIE = """];\n"""


def titulo_por_defecto(nombre: str) -> str:
    return nombre.replace("-", " ").replace("_", " ").strip().capitalize()


def limpiar(svg: str) -> str:
    """Deja el SVG en una sola linea, sin declaraciones ni comentarios XML."""
    svg = re.sub(r"<\?xml.*?\?>", "", svg, flags=re.S)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r">\s+<", "><", svg)
    return svg.strip()


def main() -> int:
    if not DIBUJOS.is_dir():
        print("No existe la carpeta", DIBUJOS)
        return 1
    manifiesto = {}
    ruta_manifiesto = DIBUJOS / "manifest.json"
    if ruta_manifiesto.exists():
        datos = json.loads(ruta_manifiesto.read_text(encoding="utf-8"))
        manifiesto = {d["nombre"]: d for d in datos}

    entradas = []
    for ruta in sorted(DIBUJOS.glob("*.svg")):
        nombre = ruta.stem
        svg = limpiar(ruta.read_text(encoding="utf-8"))
        if "`" in svg or "${" in svg:
            print("ERROR: el SVG", nombre, "contiene backticks o ${, no se puede incrustar")
            return 1
        meta = manifiesto.get(nombre, {})
        entradas.append(
            {
                "nombre": nombre,
                "titulo": meta.get("titulo", titulo_por_defecto(nombre)),
                "categoria": meta.get("categoria", "Otras láminas"),
                "svg": svg,
            }
        )

    if not entradas:
        print("No hay laminas SVG que empaquetar")
        return 1

    faltan = sorted(set(manifiesto) - {e["nombre"] for e in entradas})
    for nombre in faltan:
        print("Aviso: el manifiesto menciona", nombre, "pero no existe el SVG")

    bloques = []
    for e in entradas:
        bloques.append(
            "  {\n"
            f"    nombre: {json.dumps(e['nombre'], ensure_ascii=False)},\n"
            f"    titulo: {json.dumps(e['titulo'], ensure_ascii=False)},\n"
            f"    categoria: {json.dumps(e['categoria'], ensure_ascii=False)},\n"
            f"    svg: `{e['svg']}`\n"
            "  }"
        )
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(CABECERA + ",\n".join(bloques) + PIE, encoding="utf-8")
    print(f"{len(entradas)} laminas -> {DESTINO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
