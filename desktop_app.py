import argparse
import sys
import threading
import time
import urllib.request
import webbrowser
from multiprocessing import freeze_support
from typing import Optional

from werkzeug.serving import make_server

from server import app, bridge


APP_TITLE = "Ground Control System"
DEFAULT_WINDOW_WIDTH = 1600
DEFAULT_WINDOW_HEIGHT = 920
MIN_WINDOW_WIDTH = 1240
MIN_WINDOW_HEIGHT = 720


class LocalWebServer:
    def __init__(self, host: str, port: int) -> None:
        self._server = make_server(host, port, app, threaded=True)
        self.host = host
        self.port = int(self._server.server_port)
        self._thread: Optional[threading.Thread] = None

    @property
    def base_url(self) -> str:
        connect_host = "127.0.0.1" if self.host in {"", "0.0.0.0"} else self.host
        return f"http://{connect_host}:{self.port}"

    def start(self) -> None:
        self._thread = threading.Thread(target=self._server.serve_forever, name="gcs-web-server", daemon=True)
        self._thread.start()
        wait_for_server(f"{self.base_url}/api/status")

    def stop(self) -> None:
        self._server.shutdown()
        if self._thread is not None:
            self._thread.join(timeout=3)


def wait_for_server(url: str, timeout_seconds: float = 8.0) -> None:
    deadline = time.monotonic() + timeout_seconds

    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status < 500:
                    return
        except OSError:
            time.sleep(0.1)

    raise RuntimeError(f"Local web server did not start: {url}")


def connect_serial_on_startup(port: str, baud: int) -> None:
    if not port:
        return

    try:
        bridge.connect(port, baud)
    except Exception as exc:
        print(f"Serial autoconnect failed: {exc}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Desktop Ground Control System")
    parser.add_argument("--port", default="", help="Optional serial port to connect on startup, such as COM5")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--web-port", type=int, default=0, help="Local web port. Use 0 to choose an available port.")
    parser.add_argument("--browser", action="store_true", help="Open in the default browser instead of WebView.")
    parser.add_argument("--debug-webview", action="store_true", help="Enable pywebview debug mode.")
    return parser.parse_args()


def run_browser_mode(url: str) -> None:
    webbrowser.open(url)
    print(f"{APP_TITLE} is running at {url}")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


def run_webview_mode(url: str, debug: bool) -> None:
    try:
        import webview
    except ImportError as exc:
        raise RuntimeError(
            "pywebview is required for desktop mode. Install requirements-app.txt or run with --browser."
        ) from exc

    webview.create_window(
        APP_TITLE,
        url,
        width=DEFAULT_WINDOW_WIDTH,
        height=DEFAULT_WINDOW_HEIGHT,
        min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
    )
    webview.start(debug=debug)


def main() -> None:
    freeze_support()
    args = parse_args()
    web_server = LocalWebServer(args.host, args.web_port)

    try:
        web_server.start()
        connect_serial_on_startup(args.port, args.baud)

        if args.browser:
            run_browser_mode(web_server.base_url)
        else:
            run_webview_mode(web_server.base_url, args.debug_webview)
    finally:
        bridge.disconnect()
        web_server.stop()


if __name__ == "__main__":
    main()
