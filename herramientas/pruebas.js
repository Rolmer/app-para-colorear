/* Pruebas del nucleo de la app. Se ejecutan con Node:
     node herramientas/pruebas.js
   Comprueban la logica de pintado, el historial, el borrador, la exportacion y
   la coherencia entre las zonas del SVG empaquetado y los indices que usa la app. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.resolve(__dirname, "..");
const Nucleo = require(path.join(RAIZ, "js", "nucleo.js"));

let pruebas = 0;
let fallos = 0;

function comprobar(condicion, mensaje) {
  pruebas += 1;
  if (condicion) {
    console.log("  ok  " + mensaje);
  } else {
    fallos += 1;
    console.error("  FALLO  " + mensaje);
  }
}

function igual(obtenido, esperado, mensaje) {
  comprobar(
    obtenido === esperado,
    mensaje + " (esperado: " + JSON.stringify(esperado) + ", obtenido: " + JSON.stringify(obtenido) + ")"
  );
}

/* --- carga del archivo empaquetado tal como lo usa el navegador --- */
function cargarDibujos() {
  const ruta = path.join(RAIZ, "js", "dibujos.js");
  const codigo = fs.readFileSync(ruta, "utf8");
  const contexto = { window: {} };
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);
  return contexto.window.DIBUJOS;
}

function contarZonas(svg) {
  let total = 0;
  String(svg).replace(/<(path|circle|ellipse|rect|polygon)\b[^>]*>/g, (etiqueta) => {
    if (/\brg\b/.test(etiqueta)) total += 1;
    return etiqueta;
  });
  return total;
}

const dibujos = cargarDibujos();
console.log("Laminas empaquetadas: " + dibujos.length);

/* ---------- 1. estado y pintado de zonas ---------- */
console.log("\n1) Pintado de zonas");
let estado = Nucleo.crearEstado("prueba");
igual(Nucleo.regionesPintadas(estado), 0, "un estado nuevo no tiene zonas pintadas");

estado = Nucleo.pintarRegion(estado, "rg-3", "#ff0000");
igual(estado.regiones["rg-3"], "#ff0000", "la zona queda con el color elegido");
igual(Nucleo.regionesPintadas(estado), 1, "se cuenta una zona pintada");

const sinCambio = Nucleo.pintarRegion(estado, "rg-3", "#ff0000");
comprobar(sinCambio === estado, "pintar del mismo color no crea historial");

estado = Nucleo.pintarRegion(estado, "rg-3", Nucleo.BLANCO);
comprobar(!("rg-3" in estado.regiones), "pintar de blanco deja la zona sin color");

estado = Nucleo.pintarRegion(estado, "rg-1", "no-es-un-color");
comprobar(!("rg-1" in estado.regiones), "se rechazan colores invalidos");

estado = Nucleo.pintarRegion(estado, "rg-2", "#00ff88");
estado = Nucleo.pintarRegion(estado, "rg-5", "#123456");

/* ---------- 2. deshacer y rehacer ---------- */
console.log("\n2) Deshacer y rehacer");
comprobar(Nucleo.hayDeshacer(estado), "hay cambios que deshacer");
estado = Nucleo.deshacer(estado);
comprobar(!("rg-5" in estado.regiones), "deshacer quita la ultima zona pintada");
comprobar(Nucleo.hayRehacer(estado), "queda algo que rehacer");
estado = Nucleo.rehacer(estado);
igual(estado.regiones["rg-5"], "#123456", "rehacer recupera la zona");
igual(Nucleo.regionesPintadas(estado), 2, "quedan dos zonas pintadas");

while (Nucleo.hayDeshacer(estado)) estado = Nucleo.deshacer(estado);
igual(Nucleo.regionesPintadas(estado), 0, "deshaciendo todo se vuelve a la lamina vacia");

/* ---------- 3. trazos del pincel ---------- */
console.log("\n3) Pincel y borrador");
estado = Nucleo.agregarTrazo(estado, { puntos: [[10, 10], [20, 20], [30, 30]], color: "#3a86ff", grosor: 8 });
estado = Nucleo.agregarTrazo(estado, { puntos: [[100, 100], [140, 100]], color: "#ff5d8f", grosor: 12 });
igual(estado.trazos.length, 2, "se guardan los dos trazos");
igual(Nucleo.trazoAPath(estado.trazos[0]), "M10,10 L20,20 L30,30", "el trazo se convierte en un path valido");
comprobar(Nucleo.agregarTrazo(estado, { puntos: [[1, 1]], color: "#000000", grosor: 4 }) === estado, "se rechazan trazos de un solo punto");

igual(Nucleo.buscarTrazoCerca(estado, [25, 24], 6), 0, "el borrador encuentra el trazo cercano");
igual(Nucleo.buscarTrazoCerca(estado, [200, 200], 6), -1, "lejos de todo no borra nada");
igual(Nucleo.buscarTrazoCerca(estado, [120, 104], 6), 1, "encuentra el segundo trazo por su grosor");

estado = Nucleo.quitarTrazo(estado, 0);
igual(estado.trazos.length, 1, "quitar un trazo lo elimina de la lista");
estado = Nucleo.deshacer(estado);
igual(estado.trazos.length, 2, "deshacer recupera el trazo borrado");

/* ---------- 4. guardado y recuperacion ---------- */
console.log("\n4) Guardado en el navegador");
const guardado = Nucleo.paraGuardar(estado);
comprobar(!("pasado" in guardado) && !("futuro" in guardado), "no se guarda el historial");
const recuperado = Nucleo.desdeGuardado("prueba", {
  regiones: { "rg-1": "#ff0000", "rg-2": "rojo" },
  trazos: [{ puntos: [["5", "6"], [7, 8]], color: "#00b4d8", grosor: "9" }, { puntos: [[1, 1]], color: "#000000" }],
});
igual(Object.keys(recuperado.regiones).length, 1, "solo se recuperan los colores validos");
igual(recuperado.trazos.length, 1, "solo se recuperan los trazos completos");
igual(recuperado.trazos[0].puntos[0][0], 5, "las coordenadas se convierten a numero");
igual(recuperado.trazos[0].grosor, 9, "el grosor se conserva");

/* ---------- 5. exportacion del SVG ---------- */
console.log("\n5) Exportacion del SVG");
const lamina = Nucleo.buscarDibujo(dibujos, "princess-01");
comprobar(!!lamina, "se encuentra la lamina princess-01 por su nombre");
igual(Nucleo.buscarDibujo(dibujos, "no-existe"), null, "un nombre desconocido devuelve null");

const totalZonas = contarZonas(lamina.svg);
comprobar(totalZonas > 20, "la lamina tiene zonas rellenables (" + totalZonas + ")");

let lleno = Nucleo.crearEstado("princess-01");
for (let i = 0; i < totalZonas; i += 1) lleno = Nucleo.pintarRegion(lleno, "rg-" + i, "#ffb703");
lleno = Nucleo.agregarTrazo(lleno, { puntos: [[10, 10], [50, 60]], color: "#7209b7", grosor: 10 });
const exportado = Nucleo.svgParaExportar(lamina.svg, lleno);
const rellenos = (exportado.match(/style="fill:/g) || []).length;
igual(rellenos, totalZonas, "todas las zonas se exportan con su color");
comprobar(exportado.indexOf("<style>") > -1, "el SVG exportado lleva sus estilos");
comprobar(exportado.indexOf('<g class="trazos">') > -1, "el SVG exportado incluye los trazos del pincel");
comprobar(exportado.trim().endsWith("</svg>"), "el SVG exportado cierra correctamente");
comprobar(exportado.indexOf("<!--") === -1, "el SVG exportado no lleva comentarios");

const primeraZona = exportado.match(/<rect[^>]*class="rg[^>]*>/)[0];
comprobar(primeraZona.indexOf('style="fill:#ffb703"') > -1, "el primer relleno va en la primera zona (el fondo)");

const vacio = Nucleo.svgParaExportar(lamina.svg, Nucleo.crearEstado("princess-01"));
comprobar((vacio.match(/style="fill:/g) || []).length === 0, "sin pintar no se anade ningun relleno");

/* ---------- 6. galeria ---------- */
console.log("\n6) Galeria");
const categorias = Nucleo.listarCategorias(dibujos);
comprobar(categorias[0] === "Todas", "la primera categoria es Todas");
comprobar(categorias.length >= 3, "hay varias categorias (" + categorias.join(", ") + ")");
igual(Nucleo.filtrarPorCategoria(dibujos, "Todas").length, dibujos.length, "Todas devuelve la lista completa");
const princesas = Nucleo.filtrarPorCategoria(dibujos, "Princesas");
comprobar(princesas.length >= 1 && princesas.every((d) => d.categoria === "Princesas"), "el filtro devuelve solo su categoria");

let conSvg = true;
dibujos.forEach((d) => {
  if (!d.svg || d.svg.indexOf("<svg") !== 0 || contarZonas(d.svg) < 10) conSvg = false;
});
comprobar(conSvg, "todas las laminas son SVG con zonas rellenables");

/* ---------- 7. coherencia entre la interfaz y el HTML ---------- */
console.log("\n7) Interfaz y HTML");
const html = fs.readFileSync(path.join(RAIZ, "index.html"), "utf8");
const app = fs.readFileSync(path.join(RAIZ, "js", "app.js"), "utf8");

const idsUsados = new Set();
for (const coincidencia of app.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) idsUsados.add(coincidencia[1]);
const idsQueFaltan = [...idsUsados].filter((id) => html.indexOf('id="' + id + '"') === -1);
comprobar(idsQueFaltan.length === 0, "todos los identificadores que usa app.js existen en index.html" + (idsQueFaltan.length ? " (faltan: " + idsQueFaltan.join(", ") + ")" : ""));

["js/dibujos.js", "js/nucleo.js", "js/app.js", "css/estilos.css"].forEach((relativo) => {
  comprobar(fs.existsSync(path.join(RAIZ, relativo)), "existe el archivo " + relativo);
});

const herramientasHtml = [...html.matchAll(/data-herramienta="([a-z]+)"/g)].map((m) => m[1]);
comprobar(herramientasHtml.length === 3, "hay tres herramientas en el panel (" + herramientasHtml.join(", ") + ")");
const pistas = app.match(/var PISTAS = \{([\s\S]*?)\};/);
const pistasOk = pistas && herramientasHtml.every((h) => pistas[1].indexOf(h + ":") !== -1);
comprobar(!!pistasOk, "cada herramienta del panel tiene su texto de ayuda");

const clasesCss = [".rg", ".ln", ".zona", ".herramienta", ".color-swatch", ".zona-subir", ".casilla", ".cargando"];
const css = fs.readFileSync(path.join(RAIZ, "css", "estilos.css"), "utf8");
comprobar(clasesCss.every((c) => css.indexOf(c) !== -1), "la hoja de estilos define las clases que usa la app");
comprobar(css.indexOf(".lienzo-caja canvas") !== -1, "la hoja de estilos prepara el lienzo de las imagenes subidas");

comprobar(html.indexOf('id="archivo"') !== -1 && /accept="image\/png/.test(html), "hay un selector de archivos para PNG/JPG");
comprobar(html.indexOf('id="tolerancia"') !== -1 && html.indexOf('id="respetar-lineas"') !== -1, "el panel incluye tolerancia y proteccion de lineas");
comprobar(html.indexOf('id="grupo-raster"') !== -1 && html.indexOf('class="grupo oculto" id="grupo-raster"') !== -1, "los ajustes de imagen empiezan ocultos (solo para laminas subidas)");

["rellenarImagen", "desdeGuardadoRaster", "paraGuardarRaster", "agregarOperacion", "borrarTodoRaster"].forEach((funcion) => {
  comprobar(app.indexOf("N." + funcion) !== -1, "app.js usa N." + funcion + " para las laminas subidas");
});
comprobar(app.indexOf("indexedDB") !== -1, "las imagenes subidas se guardan en la base de datos del navegador");
comprobar(app.indexOf("dragenter") !== -1 && app.indexOf('"paste"') !== -1, "se pueden subir imagenes arrastrandolas o pegandolas");

/* ---------- 8. archivo de muestra para revisar la exportacion a mano ---------- */
const muestra = path.join(RAIZ, "herramientas", "_exportada.svg");
let muestraEstado = Nucleo.crearEstado("princess-01");
["#ffd6e7", "#ffe066", "#8ac926", "#00b4d8", "#ff5d8f", "#9d4edd", "#f4a261"].forEach((tono, i) => {
  muestraEstado = Nucleo.pintarRegion(muestraEstado, "rg-" + i, tono);
});
muestraEstado = Nucleo.pintarRegion(muestraEstado, "rg-8", "#ffb703");
muestraEstado = Nucleo.agregarTrazo(muestraEstado, { puntos: [[40, 60], [120, 90], [200, 70]], color: "#f72585", grosor: 12 });
fs.writeFileSync(muestra, Nucleo.svgParaExportar(lamina.svg, muestraEstado), "utf8");
if (process.argv.indexOf("--escribir-muestra") > -1) {
  console.log("\nMuestra exportada en " + muestra);
}

/* ---------- 8. laminas subidas por el usuario (PNG) ---------- */
console.log("\n8) Laminas subidas (relleno por pixeles)");

function imagenBlanca(ancho, alto, tono) {
  const datos = new Uint8ClampedArray(ancho * alto * 4);
  const valor = tono === undefined ? 255 : tono;
  for (let i = 0; i < datos.length; i += 4) {
    datos[i] = valor;
    datos[i + 1] = valor;
    datos[i + 2] = valor;
    datos[i + 3] = 255;
  }
  return datos;
}

function pintarPixel(datos, ancho, x, y, tono) {
  const i = (y * ancho + x) * 4;
  datos[i] = tono[0];
  datos[i + 1] = tono[1];
  datos[i + 2] = tono[2];
  datos[i + 3] = tono[3] === undefined ? 255 : tono[3];
}

function leerPixel(datos, ancho, x, y) {
  const i = (y * ancho + x) * 4;
  return [datos[i], datos[i + 1], datos[i + 2], datos[i + 3]];
}

function rectangulo(datos, ancho, x1, y1, x2, y2, tono, grosor) {
  const g = grosor || 2;
  for (let x = x1; x <= x2; x += 1) {
    for (let d = 0; d < g; d += 1) {
      pintarPixel(datos, ancho, x, y1 + d, tono);
      pintarPixel(datos, ancho, x, y2 - d, tono);
    }
  }
  for (let y = y1; y <= y2; y += 1) {
    for (let d = 0; d < g; d += 1) {
      pintarPixel(datos, ancho, x1 + d, y, tono);
      pintarPixel(datos, ancho, x2 - d, y, tono);
    }
  }
}

const NEGRO = [32, 36, 48, 255];
const ROSA = [255, 93, 143, 255];

igual(JSON.stringify(Nucleo.colorARgba("#ff5d8f")), JSON.stringify(ROSA), "el color se convierte a RGBA");
igual(JSON.stringify(Nucleo.colorARgba("#fff")), JSON.stringify([255, 255, 255, 255]), "se aceptan colores de tres cifras");
igual(Nucleo.colorARgba("rojo"), null, "se rechazan los colores con nombre");

const ANCHO = 80;
const ALTO = 60;
let relleno = imagenBlanca(ANCHO, ALTO);
rectangulo(relleno, ANCHO, 10, 10, 70, 50, NEGRO, 2);

const pintados = Nucleo.rellenarImagen(relleno, ANCHO, ALTO, 40, 30, "#ff5d8f", 30, 110);
comprobar(pintados > 2000, "el bote pinta la zona blanca interior (" + pintados + " pixeles)");
igual(JSON.stringify(leerPixel(relleno, ANCHO, 40, 30)), JSON.stringify(ROSA), "el centro de la zona queda rosa");
igual(JSON.stringify(leerPixel(relleno, ANCHO, 4, 4)), JSON.stringify([255, 255, 255, 255]), "el exterior no se pinta");
igual(JSON.stringify(leerPixel(relleno, ANCHO, 10, 30)), JSON.stringify(NEGRO), "la linea negra se respeta");
igual(Nucleo.rellenarImagen(relleno, ANCHO, ALTO, 10, 30, "#3a86ff", 30, 110), 0, "pulsar sobre la linea no pinta nada");
igual(Nucleo.rellenarImagen(relleno, ANCHO, ALTO, 40, 30, "#ff5d8f", 30, 110), 0, "pintar del mismo color no cambia nada");
igual(Nucleo.rellenarImagen(relleno, ANCHO, ALTO, -5, 30, "#3a86ff", 30, 110), 0, "un punto fuera de la imagen no pinta");
comprobar(Nucleo.rellenarImagen(relleno, ANCHO, ALTO, 40, 30, "#3a86ff", 30, 0) > 0, "sin proteger lineas se puede repintar la zona");

/* la tolerancia decide si el relleno cruza tonos parecidos */
function degradadoDosTonos() {
  const datos = imagenBlanca(ANCHO, ALTO);
  for (let y = 0; y < ALTO; y += 1) {
    for (let x = 40; x < ANCHO; x += 1) pintarPixel(datos, ANCHO, x, y, [250, 250, 250, 255]);
  }
  return datos;
}

const degradadoBajo = degradadoDosTonos();
const conToleranciaBaja = Nucleo.rellenarImagen(degradadoBajo, ANCHO, ALTO, 20, 30, "#ffb703", 2, 0);
igual(JSON.stringify(leerPixel(degradadoBajo, ANCHO, 60, 30)), JSON.stringify([250, 250, 250, 255]), "con tolerancia baja no cruza al tono vecino");
igual(conToleranciaBaja, 40 * ALTO, "con tolerancia baja pinta solo su mitad");

const degradadoAlto = degradadoDosTonos();
const conToleranciaAlta = Nucleo.rellenarImagen(degradadoAlto, ANCHO, ALTO, 20, 30, "#3a86ff", 20, 0);
igual(JSON.stringify(leerPixel(degradadoAlto, ANCHO, 60, 30)), JSON.stringify([58, 134, 255, 255]), "con tolerancia alta cruza al tono vecino");
igual(conToleranciaAlta, ANCHO * ALTO, "con tolerancia alta pinta toda la imagen");

/* los pixeles transparentes se tratan como blancos */
let transparente = new Uint8ClampedArray(ANCHO * ALTO * 4);
comprobar(Nucleo.rellenarImagen(transparente, ANCHO, ALTO, 5, 5, "#00b4d8", 30, 110) === ANCHO * ALTO, "una imagen transparente se rellena entera");
igual(leerPixel(transparente, ANCHO, 5, 5)[3], 255, "el relleno deja el pixel opaco");

/* estado, historial y guardado de las laminas subidas */
let subida = Nucleo.crearEstadoRaster("subido:1", 800, 600);
comprobar(Nucleo.esRaster(subida), "el estado raster se reconoce");
igual(subida.ancho, 800, "se guarda el ancho de la imagen");
subida = Nucleo.agregarOperacion(subida, { tipo: "relleno", x: 10, y: 20, color: "#ff5d8f", tolerancia: 999, umbralLinea: -5 });
igual(subida.operaciones.length, 1, "se anade una operacion de relleno");
igual(subida.operaciones[0].tolerancia, 255, "la tolerancia se limita a su maximo");
igual(subida.operaciones[0].umbralLinea, 0, "el umbral de linea se limita a su minimo");
comprobar(Nucleo.agregarOperacion(subida, { tipo: "relleno", x: 1, y: 1, color: "azul" }) === subida, "se rechazan operaciones con color invalido");
comprobar(Nucleo.agregarOperacion(subida, { tipo: "trazo", puntos: [[1, 2]], color: "#000000" }) === subida, "se rechaza un trazo de un punto");
comprobar(Nucleo.agregarOperacion(Nucleo.crearEstado("svg"), { tipo: "relleno", x: 1, y: 1, color: "#000000" }).operaciones === undefined, "no se pueden anadir operaciones a una lamina SVG");

subida = Nucleo.agregarOperacion(subida, { tipo: "trazo", puntos: [[1, 2], [3, 4]], color: "#3a86ff", grosor: 12 });
subida = Nucleo.agregarOperacion(subida, { tipo: "borrado", puntos: [[5, 5]], radio: 20 });
igual(subida.operaciones.length, 3, "se guardan las tres operaciones");
comprobar(Nucleo.hayDeshacer(subida), "hay cambios que deshacer en la lamina subida");
subida = Nucleo.deshacer(subida);
igual(subida.operaciones.length, 2, "deshacer quita la ultima operacion");
igual(subida.operaciones[1].tipo, "trazo", "queda el trazo como ultima operacion");
subida = Nucleo.rehacer(subida);
igual(subida.operaciones.length, 3, "rehacer recupera la operacion");
subida = Nucleo.borrarTodoRaster(subida);
igual(subida.operaciones.length, 0, "borrar todo deja la imagen original");
subida = Nucleo.deshacer(subida);
igual(subida.operaciones.length, 3, "deshacer recupera todo tras borrar");

const recuperadoRaster = Nucleo.desdeGuardadoRaster("subido:1", 800, 600, {
  operaciones: [
    { tipo: "relleno", x: 5, y: 6, color: "#ff5d8f" },
    { tipo: "trazo", puntos: [[1, 1], [2, 2]], color: "verde" },
    { tipo: "desconocido" },
  ],
});
igual(recuperadoRaster.operaciones.length, 1, "solo se recuperan las operaciones validas");
igual(Nucleo.paraGuardarRaster(recuperadoRaster).operaciones.length, 1, "el guardado conserva las operaciones");
comprobar(Nucleo.textoProgresoRaster(0).length > 0 && Nucleo.textoProgresoRaster(5).indexOf("5") > -1, "el progreso de la lamina subida se describe");

/* ---------- 9. lamina sintetica para revisar el relleno a ojo ---------- */
function escribirBMP(ruta, datos, ancho, alto) {
  const rellenoFila = (4 - ((ancho * 3) % 4)) % 4;
  const tamFila = ancho * 3 + rellenoFila;
  const tamDatos = tamFila * alto;
  const buffer = Buffer.alloc(54 + tamDatos);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(54 + tamDatos, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(ancho, 18);
  buffer.writeInt32LE(alto, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(tamDatos, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);
  for (let y = 0; y < alto; y += 1) {
    let destino = 54 + y * tamFila;
    const filaOrigen = alto - 1 - y;
    for (let x = 0; x < ancho; x += 1) {
      const i = (filaOrigen * ancho + x) * 4;
      buffer[destino] = datos[i + 2];
      buffer[destino + 1] = datos[i + 1];
      buffer[destino + 2] = datos[i];
      destino += 3;
    }
  }
  fs.writeFileSync(ruta, buffer);
}

const ANCHO_MUESTRA = 260;
const ALTO_MUESTRA = 200;
const muestraRaster = imagenBlanca(ANCHO_MUESTRA, ALTO_MUESTRA);
/* circulo negro (contorno) y una linea diagonal que lo cruza */
for (let a = 0; a < 360; a += 0.35) {
  const rad = (a * Math.PI) / 180;
  for (let g = -2; g <= 2; g += 1) {
    const cx = Math.round(110 + (72 + g) * Math.cos(rad));
    const cy = Math.round(100 + (72 + g) * Math.sin(rad));
    if (cx >= 0 && cy >= 0 && cx < ANCHO_MUESTRA && cy < ALTO_MUESTRA) pintarPixel(muestraRaster, ANCHO_MUESTRA, cx, cy, NEGRO);
  }
}
for (let t = 0; t < 260; t += 1) {
  const x = Math.round(20 + t * 0.8);
  const y = Math.round(30 + t * 0.6);
  for (let g = -1; g <= 1; g += 1) {
    if (x >= 0 && y + g >= 0 && x < ANCHO_MUESTRA && y + g < ALTO_MUESTRA) pintarPixel(muestraRaster, ANCHO_MUESTRA, x, y + g, NEGRO);
  }
}

const pintadosCirculo = Nucleo.rellenarImagen(muestraRaster, ANCHO_MUESTRA, ALTO_MUESTRA, 110, 140, "#ff5d8f", 40, 110);
const pintadosArriba = Nucleo.rellenarImagen(muestraRaster, ANCHO_MUESTRA, ALTO_MUESTRA, 110, 60, "#ffe066", 40, 110);
const pintadosFondo = Nucleo.rellenarImagen(muestraRaster, ANCHO_MUESTRA, ALTO_MUESTRA, 8, 8, "#cdeaff", 40, 110);
comprobar(pintadosCirculo > 1000 && pintadosArriba > 200 && pintadosFondo > 1000, "la lamina de prueba se pinta por zonas");
igual(JSON.stringify(leerPixel(muestraRaster, ANCHO_MUESTRA, 110, 140)), JSON.stringify(ROSA), "el trozo de abajo del circulo queda rosa");
igual(JSON.stringify(leerPixel(muestraRaster, ANCHO_MUESTRA, 110, 60)), JSON.stringify([255, 224, 102, 255]), "el trozo de arriba queda amarillo");
igual(JSON.stringify(leerPixel(muestraRaster, ANCHO_MUESTRA, 8, 8)), JSON.stringify([205, 234, 255, 255]), "el fondo queda celeste");
const rutaMuestra = path.join(RAIZ, "herramientas", "_relleno.bmp");
escribirBMP(rutaMuestra, muestraRaster, ANCHO_MUESTRA, ALTO_MUESTRA);
console.log("  (lamina de prueba escrita en " + rutaMuestra + ")");

console.log("\n" + (pruebas - fallos) + "/" + pruebas + " comprobaciones correctas");
if (fallos > 0) {
  console.error(fallos + " comprobaciones han fallado");
  process.exit(1);
}
process.exit(0);
