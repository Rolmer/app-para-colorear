"""Servidor local opcional.

Sirve la carpeta del proyecto en http://localhost:8000 y abre el navegador.
Es util porque algunos navegadores limitan el guardado (localStorage) cuando
la pagina se abre directamente desde el disco con file://.

Uso:  python herramientas/servidor.py [puerto]
"""
from __future__ import annotations

import functools
import http.server
import pathlib
import socketserver
import sys
import threading
import webbrowser

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PUERTO_POR_DEFECTO = 8000


def main() -> int:
    puerto = PUERTO_POR_DEFECTO
    if len(sys.argv) > 1:
        try:
            puerto = int(sys.argv[1])
        except ValueError:
            print("El puerto debe ser un numero. Uso: python herramientas/servidor.py [puerto]")
            return 1

    manejador = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(RAIZ))
    try:
        with socketserver.TCPServer(("127.0.0.1", puerto), manejador) as servidor:
            direccion = f"http://localhost:{puerto}/index.html"
            print(f"Sirviendo {RAIZ}")
            print(f"Abre {direccion}  (Ctrl+C para parar)")
            threading.Timer(0.6, lambda: webbrowser.open(direccion)).start()
            servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    except OSError as error:
        print(f"No se pudo abrir el puerto {puerto}: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
