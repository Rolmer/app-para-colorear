/* ============================================================
   Colorea y Pinta · interfaz
   Dos tipos de lámina:
     · SVG   → las que vienen incluidas (se pintan por zonas)
     · raster → las imágenes PNG/JPG que sube el usuario
                (se pintan por píxeles con el bote de pintura)
   ============================================================ */
(function () {
  "use strict";

  var N = window.Nucleo;
  var DIBUJOS = (window.DIBUJOS || []).map(function (item) {
    item.tipo = "svg";
    return item;
  });
  var NS = "http://www.w3.org/2000/svg";
  var CLAVE = "colorear:pintura:";
  var CATEGORIA_SUBIDAS = "Mis dibujos";
  var LADO_MAXIMO = 1600;              // se reduce la imagen si es más grande
  var PESO_MAXIMO = 12 * 1024 * 1024;  // 12 MB por archivo

  var PALETA = [
    "#ff5d8f", "#f72585", "#ff8fab", "#e63946",
    "#ff7b00", "#ffb703", "#ffe066", "#f9dc5c",
    "#8ac926", "#2a9d8f", "#06d6a0", "#00b4d8",
    "#3a86ff", "#4361ee", "#7209b7", "#9d4edd",
    "#b5179e", "#8d6e63", "#c98a5b", "#f4a261",
    "#2b2d42", "#6c757d", "#adb5bd", N.BLANCO
  ];

  var PISTAS = {
    relleno: "Toca una zona del dibujo para rellenarla con el color elegido.",
    pincel: "Dibuja a mano alzada sobre la lámina. Cambia el grosor con el deslizador.",
    borrador: "Pasa por encima de un trazo para borrarlo, o toca una zona pintada para dejarla como estaba."
  };

  /* ---------- referencias del DOM ---------- */
  var $ = function (sel) { return document.querySelector(sel); };
  var vistaGaleria = $("#vista-galeria");
  var vistaTaller = $("#vista-taller");
  var rejilla = $("#rejilla");
  var filtros = $("#filtros");
  var galeriaVacia = $("#galeria-vacia");
  var paleta = $("#paleta");
  var colorLibre = $("#color-libre");
  var grosor = $("#grosor");
  var grosorValor = $("#grosor-valor");
  var cajaLienzo = $("#lienzo-caja");
  var tituloLamina = $("#titulo-lamina");
  var categoriaLamina = $("#categoria-lamina");
  var progreso = $("#progreso");
  var pista = $("#pista");
  var aviso = $("#aviso");
  var dialogoAyuda = $("#ayuda");
  var grupoRaster = $("#grupo-raster");
  var controlTolerancia = $("#tolerancia");
  var valorTolerancia = $("#tolerancia-valor");
  var casillaLineas = $("#respetar-lineas");
  var entradaArchivo = $("#archivo");
  var zonaSubir = $("#zona-subir");
  var botonDescargarSvg = $("#btn-descargar-svg");

  /* ---------- estado de la aplicación ---------- */
  var SUBIDAS = [];         // láminas subidas por el usuario (desde IndexedDB)
  var estado = null;        // estado del núcleo (zonas/trazos u operaciones)
  var dibujo = null;        // lámina actual
  var modo = "svg";         // "svg" | "raster"
  var herramienta = "relleno";
  var color = PALETA[0];
  var grosorPincel = 10;
  var tolerancia = 40;
  var respetarLineas = true;
  var svgLienzo = null;
  var capaTrazos = null;
  var trazoPreview = null;
  var zonas = [];
  var raster = null;        // { ancho, alto, base, trabajo, ctx }
  var trazoActual = null;   // pincel sobre SVG
  var operacionActual = null; // pincel/borrador sobre imagen
  var pintando = false;
  var ultimaZona = null;
  var ultimoPunto = null;
  var temporizadorGuardado = null;
  var temporizadorAviso = null;
  var categoriaActiva = "Todas";
  var celebrado = false;

  function todasLasLaminas() {
    return DIBUJOS.concat(SUBIDAS);
  }

  function buscarLamina(nombre) {
    return N.buscarDibujo(todasLasLaminas(), nombre);
  }

  /* ============================================================
     Guardado del dibujo en curso (localStorage)
     ============================================================ */
  function leerGuardado(nombre) {
    try {
      var texto = window.localStorage.getItem(CLAVE + nombre);
      if (!texto) return null;
      return JSON.parse(texto);
    } catch (error) {
      return null;
    }
  }

  function escribirGuardado(nombre, datos) {
    try {
      window.localStorage.setItem(CLAVE + nombre, JSON.stringify(datos));
      return true;
    } catch (error) {
      return false;
    }
  }

  function borrarGuardado(nombre) {
    try {
      window.localStorage.removeItem(CLAVE + nombre);
    } catch (error) { /* sin almacenamiento */ }
  }

  function programarGuardado() {
    if (!dibujo || !estado) return;
    if (temporizadorGuardado) window.clearTimeout(temporizadorGuardado);
    temporizadorGuardado = window.setTimeout(function () {
      if (N.esRaster(estado)) escribirGuardado(dibujo.nombre, N.paraGuardarRaster(estado));
      else escribirGuardado(dibujo.nombre, N.paraGuardar(estado));
    }, 350);
  }

  function cambiosDe(registro) {
    var guardado = leerGuardado(registro.nombre);
    if (!guardado) return 0;
    if (registro.tipo === "raster") return guardado.operaciones ? guardado.operaciones.length : 0;
    return guardado.regiones ? Object.keys(guardado.regiones).length : 0;
  }

  /* ============================================================
     Base de datos del navegador para las imágenes subidas
     ============================================================ */
  var bdPromesa = null;

  function abrirBD() {
    if (bdPromesa) return bdPromesa;
    bdPromesa = new Promise(function (resolver, rechazar) {
      if (!window.indexedDB) {
        rechazar(new Error("Este navegador no guarda imágenes"));
        return;
      }
      var peticion = window.indexedDB.open("colorear-pintura", 1);
      peticion.onupgradeneeded = function () {
        var bd = peticion.result;
        if (!bd.objectStoreNames.contains("imagenes")) {
          bd.createObjectStore("imagenes", { keyPath: "id" });
        }
      };
      peticion.onsuccess = function () { resolver(peticion.result); };
      peticion.onerror = function () { rechazar(peticion.error || new Error("No se pudo abrir la base de datos")); };
    });
    return bdPromesa;
  }

  function conAlmacen(modoTransaccion, tarea) {
    return abrirBD().then(function (bd) {
      return new Promise(function (resolver, rechazar) {
        var transaccion = bd.transaction("imagenes", modoTransaccion);
        var almacen = transaccion.objectStore("imagenes");
        var peticion = tarea(almacen);
        transaccion.oncomplete = function () { resolver(peticion ? peticion.result : true); };
        transaccion.onerror = function () { rechazar(transaccion.error || new Error("Error de almacenamiento")); };
      });
    });
  }

  function guardarSubida(registro) {
    return conAlmacen("readwrite", function (almacen) { return almacen.put(registro); });
  }

  function listarSubidas() {
    return conAlmacen("readonly", function (almacen) { return almacen.getAll(); }).then(function (lista) {
      return (lista || []).sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
    });
  }

  function borrarSubida(id) {
    return conAlmacen("readwrite", function (almacen) { return almacen.delete(id); });
  }

  /* ============================================================
     Avisos flotantes
     ============================================================ */
  function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.classList.remove("oculto");
    window.requestAnimationFrame(function () { aviso.classList.add("visible"); });
    if (temporizadorAviso) window.clearTimeout(temporizadorAviso);
    temporizadorAviso = window.setTimeout(function () {
      aviso.classList.remove("visible");
      window.setTimeout(function () { aviso.classList.add("oculto"); }, 220);
    }, 2800);
  }

  /* ============================================================
     Subir imágenes
     ============================================================ */
  function tituloDesdeArchivo(nombre) {
    var base = String(nombre || "Mi dibujo").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
    if (!base) base = "Mi dibujo";
    base = base.charAt(0).toUpperCase() + base.slice(1);
    return base.slice(0, 40);
  }

  function leerImagen(archivo) {
    return new Promise(function (resolver, rechazar) {
      if (!archivo || !/^image\//.test(archivo.type || "")) {
        rechazar(new Error("Ese archivo no es una imagen"));
        return;
      }
      if (archivo.size > PESO_MAXIMO) {
        rechazar(new Error("La imagen es muy grande (máximo 12 MB)"));
        return;
      }
      var lector = new FileReader();
      lector.onerror = function () { rechazar(new Error("No se pudo leer el archivo")); };
      lector.onload = function () {
        var imagen = new Image();
        imagen.onerror = function () { rechazar(new Error("No se pudo abrir la imagen")); };
        imagen.onload = function () { resolver(imagen); };
        imagen.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }

  function normalizarImagen(imagen) {
    var anchoOriginal = imagen.naturalWidth || imagen.width;
    var altoOriginal = imagen.naturalHeight || imagen.height;
    var escala = Math.min(1, LADO_MAXIMO / Math.max(anchoOriginal, altoOriginal));
    var ancho = Math.max(1, Math.round(anchoOriginal * escala));
    var alto = Math.max(1, Math.round(altoOriginal * escala));

    var lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    var contexto = lienzo.getContext("2d");
    contexto.fillStyle = "#ffffff";
    contexto.fillRect(0, 0, ancho, alto);
    contexto.drawImage(imagen, 0, 0, ancho, alto);

    var escalaMini = Math.min(1, 240 / Math.max(ancho, alto));
    var mini = document.createElement("canvas");
    mini.width = Math.max(1, Math.round(ancho * escalaMini));
    mini.height = Math.max(1, Math.round(alto * escalaMini));
    mini.getContext("2d").drawImage(lienzo, 0, 0, mini.width, mini.height);

    return {
      ancho: ancho,
      alto: alto,
      imagen: lienzo.toDataURL("image/png"),
      miniatura: mini.toDataURL("image/png"),
    };
  }

  function subirArchivos(lista) {
    var archivos = Array.prototype.slice.call(lista || []).filter(function (archivo) {
      return archivo && /^image\//.test(archivo.type || "");
    });
    if (!archivos.length) {
      mostrarAviso("Elige una imagen PNG o JPG.");
      return;
    }
    mostrarAviso("Preparando tu dibujo…");

    var cadena = Promise.resolve();
    var ultimo = null;

    archivos.forEach(function (archivo) {
      cadena = cadena
        .then(function () { return leerImagen(archivo); })
        .then(function (imagen) {
          var datos = normalizarImagen(imagen);
          var id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          var registro = {
            id: id,
            nombre: "subido:" + id,
            titulo: tituloDesdeArchivo(archivo.name),
            categoria: CATEGORIA_SUBIDAS,
            tipo: "raster",
            ancho: datos.ancho,
            alto: datos.alto,
            imagen: datos.imagen,
            miniatura: datos.miniatura,
            fecha: Date.now(),
          };
          ultimo = registro;
          return guardarSubida(registro).catch(function () {
            mostrarAviso("Tu dibujo no se podrá guardar al cerrar el navegador.");
            return null;
          });
        })
        .then(function () {
          if (ultimo && !N.buscarDibujo(SUBIDAS, ultimo.nombre)) SUBIDAS.push(ultimo);
        })
        .catch(function (error) {
          ultimo = null;
          mostrarAviso(error && error.message ? error.message : "No se pudo subir la imagen.");
        });
    });

    cadena.then(function () {
      if (!ultimo) { montarFiltros(); montarGaleria(); return; }
      categoriaActiva = CATEGORIA_SUBIDAS;
      montarFiltros();
      montarGaleria();
      mostrarAviso("¡Listo! Ya puedes colorear tu dibujo.");
      abrirTaller(ultimo.nombre);
    });
  }

  function conectarSubida() {
    var boton = $("#btn-subir");
    boton.addEventListener("click", function () { entradaArchivo.click(); });
    entradaArchivo.addEventListener("change", function () {
      subirArchivos(entradaArchivo.files);
      entradaArchivo.value = "";
    });

    ["dragenter", "dragover"].forEach(function (nombre) {
      zonaSubir.addEventListener(nombre, function (evento) {
        evento.preventDefault();
        zonaSubir.classList.add("encima");
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (nombre) {
      zonaSubir.addEventListener(nombre, function (evento) {
        evento.preventDefault();
        zonaSubir.classList.remove("encima");
      });
    });
    zonaSubir.addEventListener("drop", function (evento) {
      if (evento.dataTransfer && evento.dataTransfer.files) subirArchivos(evento.dataTransfer.files);
    });

    document.addEventListener("paste", function (evento) {
      if (!evento.clipboardData || !evento.clipboardData.files || !evento.clipboardData.files.length) return;
      subirArchivos(evento.clipboardData.files);
    });

    // Si se suelta un archivo fuera de la zona, el navegador lo abriría: lo evitamos.
    document.addEventListener("dragover", function (evento) { evento.preventDefault(); });
    document.addEventListener("drop", function (evento) { evento.preventDefault(); });
  }

  /* ============================================================
     Galería
     ============================================================ */
  function montarFiltros() {
    filtros.innerHTML = "";
    N.listarCategorias(todasLasLaminas()).forEach(function (categoria) {
      var boton = document.createElement("button");
      boton.type = "button";
      boton.className = "filtro" + (categoria === categoriaActiva ? " activo" : "");
      boton.textContent = categoria;
      boton.setAttribute("role", "tab");
      boton.setAttribute("aria-selected", categoria === categoriaActiva ? "true" : "false");
      boton.addEventListener("click", function () {
        categoriaActiva = categoria;
        montarFiltros();
        montarGaleria();
      });
      filtros.appendChild(boton);
    });
  }

  function textoAvance(item) {
    if (item.tipo === "raster") return "Tu imagen · " + item.ancho + "×" + item.alto;
    return "Lámina lista para pintar";
  }

  function montarGaleria() {
    var lista = N.filtrarPorCategoria(todasLasLaminas(), categoriaActiva);
    rejilla.innerHTML = "";
    galeriaVacia.classList.toggle("oculto", lista.length > 0);

    lista.forEach(function (item) {
      var cambios = cambiosDe(item);
      var tarjeta = document.createElement("article");
      tarjeta.className = "tarjeta";

      var miniatura = document.createElement("div");
      miniatura.className = "miniatura";
      if (item.tipo === "raster") {
        var imagen = document.createElement("img");
        imagen.src = item.miniatura;
        imagen.alt = item.titulo;
        miniatura.appendChild(imagen);
      } else {
        miniatura.innerHTML = item.svg;
      }

      var titulo = document.createElement("h3");
      titulo.textContent = item.titulo;

      var etiqueta = document.createElement("span");
      etiqueta.className = "categoria";
      etiqueta.textContent = item.categoria;

      var avance = document.createElement("p");
      avance.className = "avance";
      avance.textContent = (cambios > 0 ? "✏️ Ya has pintado (" + cambios + " cambios)" : textoAvance(item));

      var acciones = document.createElement("div");
      acciones.className = "acciones-tarjeta";

      var botonAbrir = document.createElement("button");
      botonAbrir.type = "button";
      botonAbrir.className = "boton primario";
      botonAbrir.textContent = cambios > 0 ? "Seguir pintando" : "🎨 Colorear";
      botonAbrir.addEventListener("click", function () { abrirTaller(item.nombre); });
      acciones.appendChild(botonAbrir);

      var botonImprimir = document.createElement("button");
      botonImprimir.type = "button";
      botonImprimir.className = "boton icono";
      botonImprimir.title = item.tipo === "raster" ? "Imprimir mi imagen" : "Imprimir la lámina en blanco";
      botonImprimir.textContent = "🖨️";
      botonImprimir.addEventListener("click", function () {
        if (item.tipo === "raster") imprimirContenido('<img src="' + item.imagen + '" alt="">', true);
        else imprimirContenido(item.svg, false);
      });
      acciones.appendChild(botonImprimir);

      if (item.tipo === "raster" || cambios > 0) {
        var botonBorrar = document.createElement("button");
        botonBorrar.type = "button";
        botonBorrar.className = "boton icono peligro";
        botonBorrar.title = item.tipo === "raster" ? "Quitar esta imagen" : "Borrar mi dibujo guardado";
        botonBorrar.textContent = "🗑️";
        botonBorrar.addEventListener("click", function () {
          borrarGuardado(item.nombre);
          if (item.tipo === "raster") {
            borrarSubida(item.id).catch(function () { /* seguimos: se quita de la vista */ });
            SUBIDAS = SUBIDAS.filter(function (otro) { return otro.id !== item.id; });
            montarFiltros();
          }
          montarGaleria();
          mostrarAviso(item.tipo === "raster" ? "Imagen quitada de la galería." : "Dibujo borrado. ¡Puedes empezar de nuevo!");
        });
        acciones.appendChild(botonBorrar);
      }

      tarjeta.appendChild(miniatura);
      tarjeta.appendChild(titulo);
      tarjeta.appendChild(etiqueta);
      tarjeta.appendChild(avance);
      tarjeta.appendChild(acciones);
      rejilla.appendChild(tarjeta);
    });
  }

  /* ============================================================
     Paleta y herramientas
     ============================================================ */
  function montarPaleta() {
    paleta.innerHTML = "";
    PALETA.forEach(function (tono) {
      var boton = document.createElement("button");
      boton.type = "button";
      boton.dataset.color = tono;
      boton.className = "color-swatch" + (tono === color ? " activo" : "") + (tono === N.BLANCO ? " blanco" : "");
      boton.style.background = tono;
      boton.title = tono === N.BLANCO ? "Dejar la zona en blanco" : "Pintar con " + tono;
      boton.setAttribute("aria-label", boton.title);
      boton.addEventListener("click", function () { elegirColor(tono); });
      paleta.appendChild(boton);
    });
  }

  function elegirColor(tono) {
    color = tono;
    colorLibre.value = tono;
    Array.prototype.forEach.call(paleta.children, function (hijo) {
      hijo.classList.toggle("activo", hijo.dataset.color === tono);
    });
    if (herramienta === "borrador") seleccionarHerramienta("relleno");
  }

  function seleccionarHerramienta(nombre) {
    herramienta = nombre;
    Array.prototype.forEach.call(document.querySelectorAll(".herramienta"), function (boton) {
      boton.classList.toggle("activa", boton.dataset.herramienta === nombre);
    });
    cajaLienzo.classList.toggle("lapiz", nombre === "pincel");
    cajaLienzo.classList.toggle("borrador", nombre === "borrador");
    pista.textContent = PISTAS[nombre] || "";
  }

  /* ============================================================
     Lienzo de láminas SVG
     ============================================================ */
  function montarLienzo() {
    cajaLienzo.innerHTML = dibujo.svg;
    svgLienzo = cajaLienzo.querySelector("svg");
    zonas = Array.prototype.slice.call(svgLienzo.querySelectorAll(".rg"));
    zonas.forEach(function (zona, i) {
      zona.setAttribute("id", "rg-" + i);
      zona.classList.add("zona");
    });
    capaTrazos = document.createElementNS(NS, "g");
    capaTrazos.setAttribute("id", "capa-trazos");
    svgLienzo.appendChild(capaTrazos);
    trazoPreview = document.createElementNS(NS, "path");
    trazoPreview.setAttribute("id", "trazo-preview");
    trazoPreview.setAttribute("fill", "none");
    trazoPreview.setAttribute("stroke-linecap", "round");
    trazoPreview.setAttribute("stroke-linejoin", "round");
    capaTrazos.appendChild(trazoPreview);

    svgLienzo.addEventListener("pointerdown", alPulsar);
    svgLienzo.addEventListener("pointermove", alMover);
    svgLienzo.addEventListener("pointerup", alSoltar);
    svgLienzo.addEventListener("pointercancel", alSoltar);
    svgLienzo.addEventListener("pointerleave", function () {
      if (!pintando) return;
      if (herramienta !== "pincel") pintando = false;
      else terminarTrazo();
    });
  }

  function puntoEnLienzo(evento) {
    var ctm = svgLienzo.getScreenCTM();
    if (!ctm) return null;
    var punto = svgLienzo.createSVGPoint();
    punto.x = evento.clientX;
    punto.y = evento.clientY;
    var transformado = punto.matrixTransform(ctm.inverse());
    return [Math.round(transformado.x * 10) / 10, Math.round(transformado.y * 10) / 10];
  }

  function zonaEnPuntero(evento) {
    var elemento = document.elementFromPoint(evento.clientX, evento.clientY);
    if (!elemento) return null;
    if (elemento.classList && elemento.classList.contains("zona")) return elemento;
    return elemento.closest ? elemento.closest(".zona") : null;
  }

  function aplicarZona(idZona) {
    var elemento = document.getElementById(idZona);
    if (!elemento) return;
    var tono = estado.regiones[idZona];
    if (tono) elemento.style.fill = tono;
    else elemento.style.removeProperty("fill");
  }

  function refrescarZonas() {
    zonas.forEach(function (zona) { aplicarZona(zona.id); });
  }

  function pathDeTrazo(trazo) {
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", N.trazoAPath(trazo));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", trazo.color);
    path.setAttribute("stroke-width", trazo.grosor);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    return path;
  }

  function refrescarTrazos() {
    if (!capaTrazos) return;
    while (capaTrazos.firstChild) capaTrazos.removeChild(capaTrazos.firstChild);
    estado.trazos.forEach(function (trazo) { capaTrazos.appendChild(pathDeTrazo(trazo)); });
    capaTrazos.appendChild(trazoPreview);
  }

  function rellenarZona(evento) {
    var zona = zonaEnPuntero(evento);
    if (!zona || zona.id === ultimaZona) return;
    ultimaZona = zona.id;
    var nuevo = N.pintarRegion(estado, zona.id, color);
    if (nuevo === estado) return;
    estado = nuevo;
    aplicarZona(zona.id);
    despuesDeCambiar();
  }

  function empezarTrazo(punto) {
    trazoActual = { puntos: [punto], color: color, grosor: grosorPincel };
    trazoPreview.setAttribute("d", N.trazoAPath(trazoActual));
    trazoPreview.setAttribute("stroke", color);
    trazoPreview.setAttribute("stroke-width", String(grosorPincel));
  }

  function seguirTrazo(punto) {
    if (!trazoActual) return;
    var ultimo = trazoActual.puntos[trazoActual.puntos.length - 1];
    if (Math.abs(punto[0] - ultimo[0]) + Math.abs(punto[1] - ultimo[1]) < 2) return;
    trazoActual.puntos.push(punto);
    trazoPreview.setAttribute("d", N.trazoAPath(trazoActual));
  }

  function terminarTrazo() {
    if (trazoActual && trazoActual.puntos.length > 1) {
      var nuevo = N.agregarTrazo(estado, trazoActual);
      if (nuevo !== estado) {
        estado = nuevo;
        refrescarTrazos();
        despuesDeCambiar();
      }
    }
    trazoActual = null;
    if (trazoPreview) trazoPreview.setAttribute("d", "");
  }

  function borrarEnLienzo(evento, esInicio) {
    var punto = puntoEnLienzo(evento);
    if (!punto) return;
    var radio = Math.max(14, grosorPincel / 2 + 6);
    var indice = N.buscarTrazoCerca(estado, punto, radio);
    if (indice >= 0) {
      estado = N.quitarTrazo(estado, indice);
      refrescarTrazos();
      despuesDeCambiar();
      return;
    }
    if (!esInicio) return;
    var zona = zonaEnPuntero(evento);
    if (zona && estado.regiones[zona.id]) {
      estado = N.pintarRegion(estado, zona.id, N.BLANCO);
      aplicarZona(zona.id);
      despuesDeCambiar();
    }
  }

  /* ============================================================
     Lienzo de imágenes subidas (raster)
     ============================================================ */
  var imagenPromesa = null;

  function cargarImagen(datosUrl) {
    return new Promise(function (resolver, rechazar) {
      var imagen = new Image();
      imagen.onload = function () { resolver(imagen); };
      imagen.onerror = function () { rechazar(new Error("No se pudo cargar la imagen")); };
      imagen.src = datosUrl;
    });
  }

  function montarLienzoRaster(item) {
    cajaLienzo.innerHTML = '<p class="cargando">Cargando tu dibujo…</p>';
    var nombreLamina = item.nombre;
    return cargarImagen(item.imagen).then(function (imagen) {
      // Si mientras cargaba se ha vuelto a la galería o se ha abierto otra lámina, no montamos nada.
      if (!dibujo || dibujo.nombre !== nombreLamina) return;
      var base = document.createElement("canvas");
      base.width = item.ancho;
      base.height = item.alto;
      var contextoBase = base.getContext("2d");
      contextoBase.fillStyle = "#ffffff";
      contextoBase.fillRect(0, 0, item.ancho, item.alto);
      contextoBase.drawImage(imagen, 0, 0, item.ancho, item.alto);

      var trabajo = document.createElement("canvas");
      trabajo.width = item.ancho;
      trabajo.height = item.alto;
      trabajo.className = "lienzo-raster";
      trabajo.setAttribute("role", "img");
      trabajo.setAttribute("aria-label", "Tu dibujo para colorear");
      var contexto = trabajo.getContext("2d", { willReadFrequently: true });
      contexto.drawImage(base, 0, 0);

      raster = { ancho: item.ancho, alto: item.alto, base: base, trabajo: trabajo, ctx: contexto };
      cajaLienzo.innerHTML = "";
      cajaLienzo.appendChild(trabajo);

      trabajo.addEventListener("pointerdown", alPulsar);
      trabajo.addEventListener("pointermove", alMover);
      trabajo.addEventListener("pointerup", alSoltar);
      trabajo.addEventListener("pointercancel", alSoltar);
      trabajo.addEventListener("pointerleave", function () {
        if (!pintando) return;
        if (herramienta === "relleno") pintando = false;
        else cerrarOperacion();
      });

      reconstruirRaster();
    });
  }

  function puntoRaster(evento) {
    if (!raster) return null;
    var caja = raster.trabajo.getBoundingClientRect();
    if (!caja.width || !caja.height) return null;
    var x = ((evento.clientX - caja.left) * raster.ancho) / caja.width;
    var y = ((evento.clientY - caja.top) * raster.alto) / caja.height;
    if (x < 0 || y < 0 || x >= raster.ancho || y >= raster.alto) return null;
    return [x, y];
  }

  function umbralLineas() {
    return respetarLineas ? N.UMBRAL_LINEA : 0;
  }

  function aplicarRellenoRaster(operacion) {
    var datos = raster.ctx.getImageData(0, 0, raster.ancho, raster.alto);
    var pintados = N.rellenarImagen(
      datos.data, raster.ancho, raster.alto, operacion.x, operacion.y,
      operacion.color, operacion.tolerancia, operacion.umbralLinea
    );
    if (!pintados) return 0;
    raster.ctx.putImageData(datos, 0, 0);
    return pintados;
  }

  function aplicarBorradoPunto(punto, radio) {
    var ctx = raster.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(punto[0], punto[1], radio, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(raster.base, 0, 0);
    ctx.restore();
  }

  function aplicarOperacionRaster(operacion) {
    if (operacion.tipo === "relleno") {
      aplicarRellenoRaster(operacion);
      return;
    }
    if (operacion.tipo === "trazo") {
      var ctx = raster.ctx;
      ctx.strokeStyle = operacion.color;
      ctx.lineWidth = operacion.grosor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      operacion.puntos.forEach(function (punto, i) {
        if (i === 0) ctx.moveTo(punto[0], punto[1]);
        else ctx.lineTo(punto[0], punto[1]);
      });
      ctx.stroke();
      return;
    }
    if (operacion.tipo === "borrado") {
      operacion.puntos.forEach(function (punto) { aplicarBorradoPunto(punto, operacion.radio); });
    }
  }

  function reconstruirRaster() {
    if (!raster) return;
    raster.ctx.clearRect(0, 0, raster.ancho, raster.alto);
    raster.ctx.drawImage(raster.base, 0, 0);
    estado.operaciones.forEach(aplicarOperacionRaster);
  }

  function resolverPunto(evento) {
    return modo === "raster" ? puntoRaster(evento) : puntoEnLienzo(evento);
  }

  function radioBorradoRaster() {
    return Math.max(10, grosorPincel / 2 + 4);
  }

  function empezarOperacionRaster(punto) {
    if (herramienta === "pincel") {
      operacionActual = { tipo: "trazo", puntos: [punto], color: color, grosor: grosorPincel };
      var ctx = raster.ctx;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(punto[0], punto[1], Math.max(0.5, grosorPincel / 2), 0, Math.PI * 2);
      ctx.fill();
    } else if (herramienta === "borrador") {
      operacionActual = { tipo: "borrado", puntos: [punto], radio: radioBorradoRaster() };
      aplicarBorradoPunto(punto, operacionActual.radio);
    }
  }

  function seguirOperacionRaster(punto) {
    if (!operacionActual) return;
    var ultimo = operacionActual.puntos[operacionActual.puntos.length - 1];
    if (operacionActual.tipo === "trazo") {
      if (Math.abs(punto[0] - ultimo[0]) + Math.abs(punto[1] - ultimo[1]) < 1.5) return;
      var ctx = raster.ctx;
      ctx.strokeStyle = operacionActual.color;
      ctx.lineWidth = operacionActual.grosor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(ultimo[0], ultimo[1]);
      ctx.lineTo(punto[0], punto[1]);
      ctx.stroke();
      operacionActual.puntos.push(punto);
      return;
    }
    if (Math.hypot(punto[0] - ultimo[0], punto[1] - ultimo[1]) < Math.max(3, operacionActual.radio / 2)) return;
    operacionActual.puntos.push(punto);
    aplicarBorradoPunto(punto, operacionActual.radio);
  }

  function cerrarOperacion() {
    if (!operacionActual) return;
    var operacion = operacionActual;
    operacionActual = null;
    var nuevo = N.agregarOperacion(estado, operacion);
    if (nuevo !== estado) {
      estado = nuevo;
      despuesDeCambiar();
    }
  }

  /* ============================================================
     Eventos del lienzo (los dos modos)
     ============================================================ */
  function alPulsar(evento) {
    if (!estado) return;
    if (evento.button !== undefined && evento.button !== 0) return;
    evento.preventDefault();
    var elemento = evento.currentTarget;
    if (elemento && elemento.setPointerCapture) {
      try { elemento.setPointerCapture(evento.pointerId); } catch (error) { /* ignorar */ }
    }
    pintando = true;
    ultimaZona = null;

    if (modo === "svg") {
      if (herramienta === "relleno") rellenarZona(evento);
      else if (herramienta === "pincel") {
        var punto = puntoEnLienzo(evento);
        if (punto) empezarTrazo(punto);
      } else {
        borrarEnLienzo(evento, true);
      }
      return;
    }

    var puntoRasterActual = puntoRaster(evento);
    if (!puntoRasterActual) return;
    ultimoPunto = puntoRasterActual;
    if (herramienta === "relleno") {
      var operacionRelleno = {
        tipo: "relleno",
        x: Math.round(puntoRasterActual[0]),
        y: Math.round(puntoRasterActual[1]),
        color: color,
        tolerancia: tolerancia,
        umbralLinea: umbralLineas(),
      };
      if (!aplicarRellenoRaster(operacionRelleno)) return;
      var nueva = N.agregarOperacion(estado, operacionRelleno);
      if (nueva !== estado) {
        estado = nueva;
        despuesDeCambiar();
      }
      return;
    }
    empezarOperacionRaster(puntoRasterActual);
  }

  function alMover(evento) {
    if (!pintando || !estado) return;
    evento.preventDefault();

    if (modo === "svg") {
      if (herramienta === "relleno") rellenarZona(evento);
      else if (herramienta === "pincel") {
        var punto = puntoEnLienzo(evento);
        if (punto) seguirTrazo(punto);
      } else {
        borrarEnLienzo(evento, false);
      }
      return;
    }

    var actual = puntoRaster(evento);
    if (!actual) return;
    if (herramienta === "relleno") {
      if (ultimoPunto && Math.abs(actual[0] - ultimoPunto[0]) + Math.abs(actual[1] - ultimoPunto[1]) < 4) return;
      var operacion = {
        tipo: "relleno",
        x: Math.round(actual[0]),
        y: Math.round(actual[1]),
        color: color,
        tolerancia: tolerancia,
        umbralLinea: umbralLineas(),
      };
      if (aplicarRellenoRaster(operacion)) {
        ultimoPunto = actual;
        var nueva = N.agregarOperacion(estado, operacion);
        if (nueva !== estado) estado = nueva;
        despuesDeCambiar();
      } else {
        ultimoPunto = actual;
      }
      return;
    }
    seguirOperacionRaster(actual);
  }

  function alSoltar() {
    if (!pintando) return;
    pintando = false;
    if (modo === "svg") {
      if (herramienta === "pincel") terminarTrazo();
      return;
    }
    cerrarOperacion();
  }

  /* ============================================================
     Cambios, historial y progreso
     ============================================================ */
  function despuesDeCambiar() {
    actualizarBotones();
    actualizarProgreso();
    programarGuardado();
    if (celebrado) return;
    if (modo === "svg" && zonas.length > 0 && Object.keys(estado.regiones).length >= zonas.length) {
      celebrado = true;
      mostrarAviso("🎉 ¡Espectacular! Has pintado toda la lámina.");
    }
  }

  function actualizarBotones() {
    $("#btn-deshacer").disabled = !N.hayDeshacer(estado);
    $("#btn-rehacer").disabled = !N.hayRehacer(estado);
  }

  function actualizarProgreso() {
    if (modo === "raster") {
      progreso.textContent = N.textoProgresoRaster(estado.operaciones.length);
      return;
    }
    progreso.textContent = N.textoProgreso(Object.keys(estado.regiones).length, zonas.length);
  }

  function refrescarTodo() {
    if (modo === "raster") reconstruirRaster();
    else {
      refrescarZonas();
      refrescarTrazos();
    }
    actualizarBotones();
    actualizarProgreso();
  }

  /* ============================================================
     Abrir y cerrar el taller
     ============================================================ */
  function abrirTaller(nombre) {
    var item = buscarLamina(nombre);
    if (!item) {
      mostrarAviso("No encontramos la lámina «" + nombre + "».");
      mostrarGaleria();
      return;
    }
    dibujo = item;
    modo = item.tipo === "raster" ? "raster" : "svg";
    grupoRaster.classList.toggle("oculto", modo !== "raster");
    botonDescargarSvg.classList.toggle("oculto", modo === "raster");
    tituloLamina.textContent = item.titulo;
    categoriaLamina.textContent = item.categoria;
    celebrado = false;
    ultimaZona = null;
    ultimoPunto = null;
    trazoActual = null;
    operacionActual = null;
    vistaGaleria.classList.add("oculto");
    vistaTaller.classList.remove("oculto");
    cambiarUrl(item.nombre);
    window.scrollTo(0, 0);
    seleccionarHerramienta(herramienta);

    if (modo === "svg") {
      estado = N.desdeGuardado(item.nombre, leerGuardado(item.nombre));
      montarLienzo();
      refrescarTodo();
      mostrarAviso("Elige un color y toca el dibujo para pintarlo.");
      return;
    }

    estado = N.desdeGuardadoRaster(item.nombre, item.ancho, item.alto, leerGuardado(item.nombre));
    imagenPromesa = montarLienzoRaster(item);
    imagenPromesa
      .then(function () {
        if (!dibujo || dibujo.nombre !== item.nombre) return;
        actualizarBotones();
        actualizarProgreso();
        mostrarAviso("Tu dibujo está listo: toca una zona blanca para rellenarla.");
      })
      .catch(function () {
        mostrarAviso("No se pudo abrir tu dibujo.");
        mostrarGaleria();
      });
  }

  function mostrarGaleria() {
    vistaTaller.classList.add("oculto");
    vistaGaleria.classList.remove("oculto");
    dibujo = null;
    estado = null;
    modo = "svg";
    svgLienzo = null;
    capaTrazos = null;
    trazoPreview = null;
    raster = null;
    zonas = [];
    cajaLienzo.innerHTML = "";
    grupoRaster.classList.add("oculto");
    botonDescargarSvg.classList.remove("oculto");
    cambiarUrl(null);
    montarGaleria();
  }

  function cambiarUrl(nombre) {
    try {
      var base = window.location.href.split("?")[0].split("#")[0];
      var destino = nombre ? base + "?nombre=" + encodeURIComponent(nombre) : base;
      window.history.replaceState(null, "", destino);
    } catch (error) { /* algunos navegadores no lo permiten en file:// */ }
  }

  /* ============================================================
     Descargar e imprimir
     ============================================================ */
  function descargarBlob(blob, nombreArchivo) {
    var url = URL.createObjectURL(blob);
    var enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
      enlace.remove();
    }, 1200);
  }

  function nombreArchivo(extension) {
    var limpio = (dibujo ? dibujo.nombre : "lamina").replace(/[^a-zA-Z0-9_-]+/g, "-");
    return "colorear-" + limpio + "." + extension;
  }

  function descargarSVG() {
    if (!dibujo || !estado || modo === "raster") return;
    descargarBlob(new Blob([N.svgParaExportar(dibujo.svg, estado)], { type: "image/svg+xml;charset=utf-8" }), nombreArchivo("svg"));
    mostrarAviso("Lámina SVG descargada.");
  }

  function descargarPNG() {
    if (!dibujo || !estado) return;
    if (modo === "raster") {
      try {
        raster.trabajo.toBlob(function (blob) {
          if (!blob) {
            mostrarAviso("No se pudo crear el PNG.");
            return;
          }
          descargarBlob(blob, nombreArchivo("png"));
          mostrarAviso("¡Listo! Tu dibujo se ha descargado.");
        }, "image/png");
      } catch (error) {
        mostrarAviso("El navegador bloqueó la descarga de esta imagen.");
      }
      return;
    }

    var texto = N.svgParaExportar(dibujo.svg, estado);
    var url = URL.createObjectURL(new Blob([texto], { type: "image/svg+xml;charset=utf-8" }));
    var imagen = new Image();
    imagen.onload = function () {
      var escala = 3;
      var lienzo = document.createElement("canvas");
      lienzo.width = 400 * escala;
      lienzo.height = 520 * escala;
      var contexto = lienzo.getContext("2d");
      contexto.fillStyle = "#ffffff";
      contexto.fillRect(0, 0, lienzo.width, lienzo.height);
      contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      try {
        lienzo.toBlob(function (blob) {
          if (!blob) {
            mostrarAviso("No se pudo crear el PNG. Descargamos el SVG.");
            descargarSVG();
            return;
          }
          descargarBlob(blob, nombreArchivo("png"));
          mostrarAviso("¡Listo! Lámina descargada en PNG.");
        }, "image/png");
      } catch (error) {
        mostrarAviso("El navegador bloqueó el PNG. Descargamos el SVG.");
        descargarSVG();
      }
    };
    imagen.onerror = function () {
      URL.revokeObjectURL(url);
      mostrarAviso("No se pudo dibujar el PNG. Descargamos el SVG.");
      descargarSVG();
    };
    imagen.src = url;
  }

  function imprimirContenido(contenido, esImagen) {
    var estilos = esImagen
      ? "img{max-width:100%;max-height:100vh;display:block;margin:0 auto}"
      : N.ESTILO_LAMINA + "svg{width:100%;height:auto;display:block}";
    var html =
      '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
      "<title>Lámina para colorear</title><style>" +
      estilos +
      "html,body{margin:0;padding:0;background:#fff}@page{margin:12mm}</style></head><body>" +
      contenido +
      "</body></html>";
    var marco = document.createElement("iframe");
    marco.setAttribute("aria-hidden", "true");
    marco.style.position = "fixed";
    marco.style.right = "0";
    marco.style.bottom = "0";
    marco.style.width = "0";
    marco.style.height = "0";
    marco.style.border = "0";
    marco.srcdoc = html;
    marco.onload = function () {
      window.setTimeout(function () {
        try {
          marco.contentWindow.focus();
          marco.contentWindow.print();
        } catch (error) {
          mostrarAviso("No se pudo abrir la ventana de impresión.");
        }
        window.setTimeout(function () { marco.remove(); }, 1500);
      }, 120);
    };
    document.body.appendChild(marco);
  }

  function imprimirActual() {
    if (!dibujo || !estado) return;
    if (modo === "raster") {
      try {
        imprimirContenido('<img src="' + raster.trabajo.toDataURL("image/png") + '" alt="">', true);
      } catch (error) {
        mostrarAviso("No se pudo preparar la impresión.");
      }
      return;
    }
    imprimirContenido(N.svgParaExportar(dibujo.svg, estado), false);
  }

  /* ============================================================
     Controles
     ============================================================ */
  function conectarControles() {
    window.addEventListener("pointerup", alSoltar);
    window.addEventListener("pointercancel", alSoltar);

    Array.prototype.forEach.call(document.querySelectorAll(".herramienta"), function (boton) {
      boton.addEventListener("click", function () { seleccionarHerramienta(boton.dataset.herramienta); });
    });

    colorLibre.addEventListener("input", function () { elegirColor(colorLibre.value); });

    grosor.addEventListener("input", function () {
      grosorPincel = Number(grosor.value);
      grosorValor.textContent = String(grosorPincel);
    });

    controlTolerancia.addEventListener("input", function () {
      tolerancia = Number(controlTolerancia.value);
      valorTolerancia.textContent = String(tolerancia);
    });

    casillaLineas.addEventListener("change", function () { respetarLineas = casillaLineas.checked; });

    $("#btn-volver").addEventListener("click", mostrarGaleria);

    $("#btn-deshacer").addEventListener("click", function () {
      if (!N.hayDeshacer(estado)) return;
      estado = N.deshacer(estado);
      refrescarTodo();
      programarGuardado();
    });

    $("#btn-rehacer").addEventListener("click", function () {
      if (!N.hayRehacer(estado)) return;
      estado = N.rehacer(estado);
      refrescarTodo();
      programarGuardado();
    });

    $("#btn-limpiar").addEventListener("click", function () {
      if (!estado) return;
      if (!window.confirm("¿Seguro que quieres borrar todo lo pintado?")) return;
      estado = modo === "raster" ? N.borrarTodoRaster(estado) : N.borrarTodo(estado);
      refrescarTodo();
      programarGuardado();
      mostrarAviso(modo === "raster" ? "Tu imagen vuelve a estar como al principio." : "Lámina en blanco otra vez.");
    });

    $("#btn-descargar").addEventListener("click", descargarPNG);
    botonDescargarSvg.addEventListener("click", descargarSVG);
    $("#btn-imprimir").addEventListener("click", imprimirActual);

    $("#btn-terminado").addEventListener("click", function () {
      if (modo === "raster") {
        var cambios = estado.operaciones.length;
        if (!cambios) {
          mostrarAviso("Todavía no has pintado nada. ¡Elige un color y empieza!");
          return;
        }
        mostrarAviso("🎉 ¡Qué bonito! Ya puedes descargar o imprimir tu dibujo.");
        return;
      }
      var pintadas = Object.keys(estado.regiones).length;
      if (pintadas === 0) {
        mostrarAviso("Todavía no has pintado nada. ¡Elige un color y empieza!");
        return;
      }
      mostrarAviso("🎉 ¡Qué bonito! Ya has pintado " + pintadas + " zonas. Puedes descargarlo o imprimirlo.");
    });

    $("#btn-ayuda").addEventListener("click", function () {
      if (dialogoAyuda && dialogoAyuda.showModal) dialogoAyuda.showModal();
      else if (dialogoAyuda) dialogoAyuda.setAttribute("open", "open");
    });

    document.addEventListener("keydown", function (evento) {
      if (/input|textarea|select/i.test(evento.target.tagName)) return;
      if (!vistaTaller.classList.contains("oculto")) {
        if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "z" && !evento.shiftKey) {
          evento.preventDefault();
          $("#btn-deshacer").click();
          return;
        }
        if ((evento.ctrlKey || evento.metaKey) && (evento.key.toLowerCase() === "y" || (evento.shiftKey && evento.key.toLowerCase() === "z"))) {
          evento.preventDefault();
          $("#btn-rehacer").click();
          return;
        }
        if (evento.key.toLowerCase() === "r") seleccionarHerramienta("relleno");
        if (evento.key.toLowerCase() === "p") seleccionarHerramienta("pincel");
        if (evento.key.toLowerCase() === "b") seleccionarHerramienta("borrador");
      }
      if (evento.key === "Escape" && !vistaTaller.classList.contains("oculto")) mostrarGaleria();
    });
  }

  /* ============================================================
     Arranque
     ============================================================ */
  function iniciar() {
    montarPaleta();
    montarFiltros();
    montarGaleria();
    conectarControles();
    conectarSubida();

    if (!DIBUJOS.length) {
      galeriaVacia.classList.remove("oculto");
      galeriaVacia.textContent = "No hay láminas incluidas. Puedes subir tu propio dibujo con el botón de arriba.";
    }

    var parametros = new URLSearchParams(window.location.search);
    var nombre = parametros.get("nombre");

    listarSubidas()
      .then(function (registros) {
        SUBIDAS = registros;
        montarFiltros();
        montarGaleria();
      })
      .catch(function () { /* sin base de datos: solo las láminas incluidas */ })
      .then(function () {
        if (nombre) abrirTaller(nombre);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
