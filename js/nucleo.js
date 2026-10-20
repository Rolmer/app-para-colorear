/* Nucleo de la app de colorear: logica pura, sin DOM ni red.
   Funciona en el navegador (window.Nucleo) y en Node (require) para las pruebas. */
(function (raiz, fabrica) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = fabrica();
  } else {
    raiz.Nucleo = fabrica();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BLANCO = "#ffffff";
  var HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  var ESTILO_LAMINA =
    ".rg{fill:#ffffff;stroke:#1f2430;stroke-width:3.5;stroke-linejoin:round;stroke-linecap:round}" +
    ".ln{fill:none;stroke:#1f2430;stroke-width:3.5;stroke-linejoin:round;stroke-linecap:round}";

  function clonar(valor) {
    return JSON.parse(JSON.stringify(valor));
  }

  function esColorValido(color) {
    return typeof color === "string" && HEX.test(color.trim());
  }

  function crearEstado(nombre) {
    return {
      nombre: String(nombre || ""),
      regiones: {},
      trazos: [],
      pasado: [],
      futuro: [],
    };
  }

  function instantanea(estado) {
    return { regiones: clonar(estado.regiones), trazos: clonar(estado.trazos) };
  }

  function esTrazoValido(trazo) {
    return (
      trazo &&
      typeof trazo === "object" &&
      Array.isArray(trazo.puntos) &&
      trazo.puntos.length > 1 &&
      esColorValido(trazo.color)
    );
  }

  /* Reconstruye un estado a partir de lo guardado en el navegador. */
  function desdeGuardado(nombre, datos) {
    var estado = crearEstado(nombre);
    if (!datos || typeof datos !== "object") return estado;
    if (datos.regiones && typeof datos.regiones === "object") {
      Object.keys(datos.regiones).forEach(function (id) {
        if (esColorValido(datos.regiones[id])) estado.regiones[id] = datos.regiones[id].trim();
      });
    }
    if (Array.isArray(datos.trazos)) {
      estado.trazos = datos.trazos.filter(esTrazoValido).map(function (t) {
        return {
          puntos: t.puntos.map(function (p) {
            return [Number(p[0]) || 0, Number(p[1]) || 0];
          }),
          color: t.color.trim(),
          grosor: Math.max(1, Math.min(60, Number(t.grosor) || 10)),
        };
      });
    }
    return estado;
  }

  /* Datos que se guardan en el navegador (sin historial). */
  function paraGuardar(estado) {
    return { regiones: clonar(estado.regiones), trazos: clonar(estado.trazos) };
  }

  function conCambio(estado, cambios) {
    var nuevo = {
      nombre: estado.nombre,
      regiones: cambios.regiones,
      trazos: cambios.trazos,
      pasado: estado.pasado.concat([instantanea(estado)]),
      futuro: [],
    };
    return nuevo;
  }

  /* Pinta una zona. Con BLANCO la deja como estaba (sin color). */
  function pintarRegion(estado, idRegion, color) {
    if (!idRegion || !esColorValido(color)) return estado;
    var limpio = color.trim();
    var actual = estado.regiones[idRegion];
    var quedaraBlanco = limpio.toLowerCase() === BLANCO;
    if (actual === undefined && quedaraBlanco) return estado;
    if (actual !== undefined && actual === limpio) return estado;
    var regiones = clonar(estado.regiones);
    if (quedaraBlanco) {
      delete regiones[idRegion];
    } else {
      regiones[idRegion] = limpio;
    }
    return conCambio(estado, { regiones: regiones, trazos: clonar(estado.trazos) });
  }

  function agregarTrazo(estado, trazo) {
    if (!esTrazoValido(trazo)) return estado;
    var trazos = clonar(estado.trazos);
    trazos.push({
      puntos: trazo.puntos.map(function (p) {
        return [Number(p[0]) || 0, Number(p[1]) || 0];
      }),
      color: trazo.color.trim(),
      grosor: Math.max(1, Math.min(60, Number(trazo.grosor) || 10)),
    });
    return conCambio(estado, { regiones: clonar(estado.regiones), trazos: trazos });
  }

  function quitarTrazo(estado, indice) {
    if (indice < 0 || indice >= estado.trazos.length) return estado;
    var trazos = clonar(estado.trazos);
    trazos.splice(indice, 1);
    return conCambio(estado, { regiones: clonar(estado.regiones), trazos: trazos });
  }

  function borrarTodo(estado) {
    if (regionesPintadas(estado) === 0 && estado.trazos.length === 0) return estado;
    return conCambio(estado, { regiones: {}, trazos: [] });
  }

  function hayDeshacer(estado) {
    return estado.pasado.length > 0;
  }

  function hayRehacer(estado) {
    return estado.futuro.length > 0;
  }

  /* ---------- historial genérico (láminas SVG y láminas subidas) ---------- */
  function esRaster(estado) {
    return !!estado && estado.tipo === "raster";
  }

  function contenidoDe(estado) {
    if (esRaster(estado)) return { operaciones: clonar(estado.operaciones) };
    return { regiones: clonar(estado.regiones), trazos: clonar(estado.trazos) };
  }

  function estadoCon(estado, contenido, pasado, futuro) {
    if (esRaster(estado)) {
      return {
        nombre: estado.nombre,
        tipo: "raster",
        ancho: estado.ancho,
        alto: estado.alto,
        operaciones: contenido.operaciones,
        pasado: pasado,
        futuro: futuro,
      };
    }
    return {
      nombre: estado.nombre,
      regiones: contenido.regiones,
      trazos: contenido.trazos,
      pasado: pasado,
      futuro: futuro,
    };
  }

  function deshacer(estado) {
    if (!hayDeshacer(estado)) return estado;
    var pasado = estado.pasado.slice();
    var anterior = pasado.pop();
    return estadoCon(estado, anterior, pasado, [contenidoDe(estado)].concat(estado.futuro));
  }

  function rehacer(estado) {
    if (!hayRehacer(estado)) return estado;
    var futuro = estado.futuro.slice();
    var siguiente = futuro.shift();
    return estadoCon(estado, siguiente, estado.pasado.concat([contenidoDe(estado)]), futuro);
  }

  function regionesPintadas(estado) {
    return Object.keys(estado.regiones).length;
  }

  function textoProgreso(pintadas, total) {
    if (!total) return "";
    if (pintadas === 0) return "Todavía no has pintado nada. ¡Elige un color y toca el dibujo!";
    if (pintadas >= total) return "¡Lámina completa! " + pintadas + " de " + total + " zonas pintadas.";
    return pintadas + " de " + total + " zonas pintadas.";
  }

  function trazoAPath(trazo) {
    var puntos = trazo.puntos || [];
    if (!puntos.length) return "";
    var partes = puntos.map(function (p, i) {
      var x = Math.round(Number(p[0]) * 10) / 10;
      var y = Math.round(Number(p[1]) * 10) / 10;
      return (i === 0 ? "M" : "L") + x + "," + y;
    });
    return partes.join(" ");
  }

  /* Distancia de un punto a un segmento, en coordenadas del lienzo. */
  function distanciaASegmento(punto, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var largo = dx * dx + dy * dy;
    var t = 0;
    if (largo > 0) {
      t = ((punto[0] - a[0]) * dx + (punto[1] - a[1]) * dy) / largo;
      t = Math.max(0, Math.min(1, t));
    }
    var px = a[0] + t * dx;
    var py = a[1] + t * dy;
    return Math.hypot(punto[0] - px, punto[1] - py);
  }

  function distanciaATrazo(punto, trazo) {
    var puntos = trazo.puntos || [];
    if (puntos.length === 1) {
      return Math.hypot(punto[0] - puntos[0][0], punto[1] - puntos[0][1]);
    }
    var minima = Infinity;
    for (var i = 1; i < puntos.length; i += 1) {
      var d = distanciaASegmento(punto, puntos[i - 1], puntos[i]);
      if (d < minima) minima = d;
    }
    return minima;
  }

  /* Busca el trazo mas cercano al punto (el ultimo dibujado gana los empates). */
  function buscarTrazoCerca(estado, punto, radio) {
    var mejor = -1;
    var mejorDistancia = Infinity;
    for (var i = estado.trazos.length - 1; i >= 0; i -= 1) {
      var trazo = estado.trazos[i];
      var d = distanciaATrazo(punto, trazo) - trazo.grosor / 2;
      if (d <= radio && d < mejorDistancia) {
        mejor = i;
        mejorDistancia = d;
      }
    }
    return mejor;
  }

  /* Devuelve el SVG final (con las zonas pintadas y los trazos) como texto. */
  function svgParaExportar(svgOriginal, estado) {
    var svg = String(svgOriginal || "").replace(/style="[^"]*"/g, "");
    svg = svg.replace(/(<svg\b[^>]*>)/, "$1<style>" + ESTILO_LAMINA + "</style>");
    var indice = -1;
    svg = svg.replace(/<(path|circle|ellipse|rect|polygon)\b[^>]*>/g, function (etiqueta) {
      if (!/\brg\b/.test(etiqueta)) return etiqueta;
      indice += 1;
      var color = estado.regiones["rg-" + indice];
      if (!esColorValido(color)) return etiqueta;
      return etiqueta.replace(/\s*\/?>$/, ' style="fill:' + color + '"/>');
    });
    var trazos = (estado.trazos || [])
      .map(function (t) {
        return (
          '<path d="' +
          trazoAPath(t) +
          '" fill="none" stroke="' +
          t.color +
          '" stroke-width="' +
          t.grosor +
          '" stroke-linecap="round" stroke-linejoin="round"/>'
        );
      })
      .join("");
    if (trazos) svg = svg.replace(/<\/svg>\s*$/, '<g class="trazos">' + trazos + "</g></svg>");
    return svg;
  }

  function filtrarPorCategoria(dibujos, categoria) {
    if (!categoria || categoria === "Todas") return dibujos.slice();
    return dibujos.filter(function (d) {
      return d.categoria === categoria;
    });
  }

  function listarCategorias(dibujos) {
    var vistas = {};
    var lista = ["Todas"];
    dibujos.forEach(function (d) {
      if (d && d.categoria && !vistas[d.categoria]) {
        vistas[d.categoria] = true;
        lista.push(d.categoria);
      }
    });
    return lista;
  }

  function buscarDibujo(dibujos, nombre) {
    if (!nombre) return null;
    var buscado = String(nombre).toLowerCase();
    for (var i = 0; i < dibujos.length; i += 1) {
      if (String(dibujos[i].nombre).toLowerCase() === buscado) return dibujos[i];
    }
    return null;
  }

  /* ============================================================
     Láminas subidas por el usuario (PNG, JPG...)
     El estado guarda una lista de operaciones (rellenos, trazos y
     borrados) que se reproducen sobre la imagen original. Así el
     historial de deshacer ocupa muy poco y es exacto.
     ============================================================ */

  var UMBRAL_LINEA = 110;

  function limitar(valor, minimo, maximo, porDefecto) {
    var n = Number(valor);
    if (!isFinite(n)) n = porDefecto;
    return Math.max(minimo, Math.min(maximo, n));
  }

  function puntoValido(punto) {
    return [
      Math.round((Number(punto && punto[0]) || 0) * 10) / 10,
      Math.round((Number(punto && punto[1]) || 0) * 10) / 10,
    ];
  }

  function crearEstadoRaster(nombre, ancho, alto) {
    return {
      nombre: String(nombre || ""),
      tipo: "raster",
      ancho: Math.max(1, Math.round(Number(ancho) || 1)),
      alto: Math.max(1, Math.round(Number(alto) || 1)),
      operaciones: [],
      pasado: [],
      futuro: [],
    };
  }

  function normalizarOperacion(operacion) {
    if (!operacion || typeof operacion !== "object") return null;
    if (operacion.tipo === "relleno") {
      if (!esColorValido(operacion.color)) return null;
      return {
        tipo: "relleno",
        x: Math.round(Number(operacion.x) || 0),
        y: Math.round(Number(operacion.y) || 0),
        color: operacion.color.trim(),
        tolerancia: limitar(operacion.tolerancia, 0, 255, 40),
        umbralLinea: limitar(operacion.umbralLinea, 0, 255, UMBRAL_LINEA),
      };
    }
    if (operacion.tipo === "trazo") {
      if (!esColorValido(operacion.color)) return null;
      if (!Array.isArray(operacion.puntos) || operacion.puntos.length < 2) return null;
      return {
        tipo: "trazo",
        puntos: operacion.puntos.map(puntoValido),
        color: operacion.color.trim(),
        grosor: limitar(operacion.grosor, 1, 80, 10),
      };
    }
    if (operacion.tipo === "borrado") {
      if (!Array.isArray(operacion.puntos) || operacion.puntos.length < 1) return null;
      return {
        tipo: "borrado",
        puntos: operacion.puntos.map(puntoValido),
        radio: limitar(operacion.radio, 1, 150, 20),
      };
    }
    return null;
  }

  function agregarOperacion(estado, operacion) {
    if (!esRaster(estado)) return estado;
    var limpia = normalizarOperacion(operacion);
    if (!limpia) return estado;
    var operaciones = clonar(estado.operaciones);
    operaciones.push(limpia);
    return estadoCon(estado, { operaciones: operaciones }, estado.pasado.concat([contenidoDe(estado)]), []);
  }

  function borrarTodoRaster(estado) {
    if (!esRaster(estado) || estado.operaciones.length === 0) return estado;
    return estadoCon(estado, { operaciones: [] }, estado.pasado.concat([contenidoDe(estado)]), []);
  }

  function desdeGuardadoRaster(nombre, ancho, alto, datos) {
    var estado = crearEstadoRaster(nombre, ancho, alto);
    if (datos && Array.isArray(datos.operaciones)) {
      datos.operaciones.forEach(function (operacion) {
        var limpia = normalizarOperacion(operacion);
        if (limpia) estado.operaciones.push(limpia);
      });
    }
    return estado;
  }

  function paraGuardarRaster(estado) {
    return { operaciones: clonar(estado.operaciones) };
  }

  function textoProgresoRaster(cambios) {
    if (!cambios) return "Todavía no has pintado. Elige un color y toca una zona de tu dibujo.";
    if (cambios === 1) return "Llevas 1 cambio (un relleno o un trazo).";
    return "Llevas " + cambios + " cambios (rellenos y trazos).";
  }

  /* ---------- bote de pintura sobre píxeles ---------- */
  function colorARgba(color) {
    if (!esColorValido(color)) return null;
    var h = color.trim().slice(1);
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    var alfa = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), alfa || 255];
  }

  function luminanciaDe(pixel) {
    return 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2];
  }

  function esPixelDeLinea(pixel, umbral) {
    return umbral > 0 && luminanciaDe(pixel) < umbral;
  }

  function mismoColor(a, b, tolerancia) {
    return (
      Math.abs(a[0] - b[0]) <= tolerancia &&
      Math.abs(a[1] - b[1]) <= tolerancia &&
      Math.abs(a[2] - b[2]) <= tolerancia
    );
  }

  /* Los píxeles transparentes se tratan como blancos. */
  function pixelEn(datos, indice) {
    if (datos[indice + 3] < 20) return [255, 255, 255];
    return [datos[indice], datos[indice + 1], datos[indice + 2]];
  }

  /* Rellena la zona contigua del mismo color que el punto (x, y).
     Devuelve cuántos píxeles ha pintado. `datos` es un Uint8ClampedArray RGBA. */
  function rellenarImagen(datos, ancho, alto, x0, y0, color, tolerancia, umbralLinea) {
    var rgba = colorARgba(color);
    if (!rgba || !datos) return 0;
    var x = Math.round(Number(x0) || 0);
    var y = Math.round(Number(y0) || 0);
    if (!(x >= 0 && y >= 0 && x < ancho && y < alto)) return 0;
    var tol = limitar(tolerancia, 0, 255, 40);
    var umbral = limitar(umbralLinea, 0, 255, UMBRAL_LINEA);
    var objetivo = pixelEn(datos, (y * ancho + x) * 4);
    if (esPixelDeLinea(objetivo, umbral)) return 0;
    if (mismoColor(objetivo, rgba, 0)) return 0;

    var pintados = 0;
    var pila = [[x, y]];

    function acepta(px, py) {
      if (px < 0 || py < 0 || px >= ancho || py >= alto) return false;
      var pixel = pixelEn(datos, (py * ancho + px) * 4);
      if (esPixelDeLinea(pixel, umbral)) return false;
      return mismoColor(pixel, objetivo, tol);
    }

    while (pila.length) {
      var actual = pila.pop();
      var cx = actual[0];
      var cy = actual[1];
      if (!acepta(cx, cy)) continue;
      var izquierda = cx;
      while (izquierda - 1 >= 0 && acepta(izquierda - 1, cy)) izquierda -= 1;
      var derecha = cx;
      while (derecha + 1 < ancho && acepta(derecha + 1, cy)) derecha += 1;

      for (var i = izquierda; i <= derecha; i += 1) {
        var indice = (cy * ancho + i) * 4;
        datos[indice] = rgba[0];
        datos[indice + 1] = rgba[1];
        datos[indice + 2] = rgba[2];
        datos[indice + 3] = 255;
        pintados += 1;
      }

      for (var salto = -1; salto <= 1; salto += 2) {
        var fila = cy + salto;
        if (fila < 0 || fila >= alto) continue;
        var enRacha = false;
        for (var j = izquierda; j <= derecha; j += 1) {
          if (acepta(j, fila)) {
            if (!enRacha) {
              pila.push([j, fila]);
              enRacha = true;
            }
          } else {
            enRacha = false;
          }
        }
      }
    }
    return pintados;
  }


  return {
    BLANCO: BLANCO,
    ESTILO_LAMINA: ESTILO_LAMINA,
    esColorValido: esColorValido,
    crearEstado: crearEstado,
    desdeGuardado: desdeGuardado,
    paraGuardar: paraGuardar,
    pintarRegion: pintarRegion,
    agregarTrazo: agregarTrazo,
    quitarTrazo: quitarTrazo,
    borrarTodo: borrarTodo,
    deshacer: deshacer,
    rehacer: rehacer,
    hayDeshacer: hayDeshacer,
    hayRehacer: hayRehacer,
    regionesPintadas: regionesPintadas,
    textoProgreso: textoProgreso,
    trazoAPath: trazoAPath,
    distanciaATrazo: distanciaATrazo,
    buscarTrazoCerca: buscarTrazoCerca,
    svgParaExportar: svgParaExportar,
    filtrarPorCategoria: filtrarPorCategoria,
    listarCategorias: listarCategorias,
    buscarDibujo: buscarDibujo,
    clonar: clonar,
    /* láminas subidas por el usuario */
    UMBRAL_LINEA: UMBRAL_LINEA,
    esRaster: esRaster,
    crearEstadoRaster: crearEstadoRaster,
    desdeGuardadoRaster: desdeGuardadoRaster,
    paraGuardarRaster: paraGuardarRaster,
    agregarOperacion: agregarOperacion,
    borrarTodoRaster: borrarTodoRaster,
    textoProgresoRaster: textoProgresoRaster,
    normalizarOperacion: normalizarOperacion,
    colorARgba: colorARgba,
    rellenarImagen: rellenarImagen,
    limitar: limitar,
  };
});
