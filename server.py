import argparse
import atexit
import json
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional

import serial
import serial.tools.list_ports
from flask import Flask, Response, jsonify, render_template, request, stream_with_context


BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"

app = Flask(
    __name__,
    template_folder=str(WEB_DIR / "templates"),
    static_folder=str(WEB_DIR / "static"),
    static_url_path="/static",
)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

IMU_ATTITUDE_PATTERN = re.compile(
    r"\[IMU\].*?roll=(?P<roll>-?\d+(?:\.\d+)?)\s+"
    r"pitch=(?P<pitch>-?\d+(?:\.\d+)?)\s+"
    r"yaw=(?P<yaw>-?\d+(?:\.\d+)?)"
)
ALTITUDE_PATTERNS = (
    re.compile(r"\[IMU\].*?\salt=(?P<altitude>-?\d+(?:\.\d+)?)\s*m\b"),
    re.compile(r"\[GNSS\].*?\srelAlt=(?P<altitude>-?\d+(?:\.\d+)?)\s*m\b"),
    re.compile(r"\[GNSS\].*?\shmsl=(?P<altitude>-?\d+(?:\.\d+)?)\s*m\b"),
)
FLOAT_PATTERN = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)"
EKF_STATE_PATTERN = re.compile(
    rf"\[EKF\].*?posNED\[m\]\s+n=(?P<pos_n>{FLOAT_PATTERN})\s+"
    rf"e=(?P<pos_e>{FLOAT_PATTERN})\s+"
    rf"d=(?P<pos_d>{FLOAT_PATTERN}).*?"
    rf"velNED\[mps\]\s+n=(?P<vel_n>{FLOAT_PATTERN})\s+"
    rf"e=(?P<vel_e>{FLOAT_PATTERN})\s+"
    rf"d=(?P<vel_d>{FLOAT_PATTERN})"
)
EKF_COVARIANCE_PATTERN = re.compile(
    rf"\[EKF_COV\].*?Ppos\[m2\]\s+n=(?P<cov_n>{FLOAT_PATTERN})\s+"
    rf"e=(?P<cov_e>{FLOAT_PATTERN})\s+"
    rf"d=(?P<cov_d>{FLOAT_PATTERN})"
)


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store"
    return response


class SerialBridge:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._changed = threading.Condition(self._lock)
        self._serial: Optional[serial.Serial] = None
        self._reader: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._logs = deque(maxlen=80)
        self._port = ""
        self._baud = 115200
        self._suppressed_rx_count = 0
        self._attitude = {
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "valid": False,
            "updated_at": 0.0,
        }
        self._altitude = {
            "meters": 0.0,
            "valid": False,
            "updated_at": 0.0,
        }
        self._ekf = {
            "frame": "NED",
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "velocity": {"x": 0.0, "y": 0.0, "z": 0.0},
            "position_covariance": {"x": 0.0, "y": 0.0, "z": 0.0},
            "valid": False,
            "covariance_valid": False,
            "updated_at": 0.0,
            "covariance_updated_at": 0.0,
        }
        self._version = 0

    def connect(self, port: str, baud: int) -> None:
        port = port.strip()
        if not port:
            raise ValueError("Port is required")

        with self._lock:
            self._close_locked()
            self._stop.clear()
            self._serial = serial.Serial(port, baud, timeout=0.1, write_timeout=0.5)
            self._port = port
            self._baud = baud
            self._append_log("system", f"Connected to {port} @ {baud}")
            self._reader = threading.Thread(target=self._read_loop, daemon=True)
            self._reader.start()

    def disconnect(self) -> None:
        with self._lock:
            self._close_locked()
            self._append_log("system", "Disconnected")

    def send_command(self, command: str) -> None:
        command = command.strip()
        if not command:
            raise ValueError("Command is empty")
        if len(command) > 78:
            raise ValueError("Command is too long")

        with self._lock:
            if self._serial is None or not self._serial.is_open:
                raise RuntimeError("Serial port is not connected")

            self._serial.write((command + "\n").encode("utf-8"))
            self._append_log("tx", command)

    def snapshot(self) -> dict:
        with self._lock:
            connected = self._serial is not None and self._serial.is_open
            return {
                "version": self._version,
                "connected": connected,
                "port": self._port if connected else "",
                "baud": self._baud,
                "logs": list(self._logs),
                "suppressed_rx_count": self._suppressed_rx_count,
                "attitude": dict(self._attitude),
                "altitude": dict(self._altitude),
                "ekf": self._ekf_snapshot_locked(),
            }

    def wait_for_snapshot(self, last_version: int, timeout: float = 10.0) -> dict:
        with self._changed:
            if self._version <= last_version:
                self._changed.wait(timeout=timeout)
            return self._snapshot_locked()

    def _read_loop(self) -> None:
        line = bytearray()

        while not self._stop.is_set():
            with self._lock:
                serial_port = self._serial

            if serial_port is None or not serial_port.is_open:
                return

            try:
                data = serial_port.read(serial_port.in_waiting or 1)
            except serial.SerialException as exc:
                with self._lock:
                    self._append_log("error", f"Serial read error: {exc}")
                    self._close_locked()
                return

            if not data:
                continue

            for value in data:
                if value in (10, 13):
                    if line:
                        text = line.decode("utf-8", errors="replace").strip()
                        line.clear()
                        with self._lock:
                            self._append_rx_line(text)
                    continue

                if len(line) < 512:
                    line.append(value)
                else:
                    line.clear()
                    with self._lock:
                        self._append_log("error", "Dropped overlong serial line")

    def _close_locked(self) -> None:
        self._stop.set()
        if self._serial is not None:
            try:
                self._serial.close()
            finally:
                self._serial = None

    def _append_log(self, direction: str, message: str) -> None:
        self._logs.append(
            {
                "time": time.strftime("%H:%M:%S"),
                "direction": direction,
                "message": message,
            }
        )
        self._mark_changed()

    def _append_rx_line(self, message: str) -> None:
        attitude_updated = self._update_attitude(message)
        altitude_updated = self._update_altitude(message)
        ekf_updated = self._update_ekf_state(message)
        ekf_covariance_updated = self._update_ekf_covariance(message)

        if self._is_repeating_telemetry(message):
            self._suppressed_rx_count += 1
            if not attitude_updated and not altitude_updated and not ekf_updated and not ekf_covariance_updated:
                self._mark_changed()
            return

        self._append_log("rx", message)

    def _update_attitude(self, message: str) -> bool:
        match = IMU_ATTITUDE_PATTERN.search(message)
        if match is None:
            return False

        self._attitude = {
            "roll": float(match.group("roll")),
            "pitch": float(match.group("pitch")),
            "yaw": float(match.group("yaw")),
            "valid": True,
            "updated_at": time.time(),
        }
        self._mark_changed()
        return True

    def _update_altitude(self, message: str) -> bool:
        for pattern in ALTITUDE_PATTERNS:
            match = pattern.search(message)
            if match is None:
                continue

            self._altitude = {
                "meters": float(match.group("altitude")),
                "valid": True,
                "updated_at": time.time(),
            }
            self._mark_changed()
            return True

        return False

    def _update_ekf_state(self, message: str) -> bool:
        match = EKF_STATE_PATTERN.search(message)
        if match is None:
            return False

        self._ekf["position"] = {
            "x": float(match.group("pos_n")),
            "y": float(match.group("pos_e")),
            "z": float(match.group("pos_d")),
        }
        self._ekf["velocity"] = {
            "x": float(match.group("vel_n")),
            "y": float(match.group("vel_e")),
            "z": float(match.group("vel_d")),
        }
        self._ekf["valid"] = True
        self._ekf["updated_at"] = time.time()
        self._mark_changed()
        return True

    def _update_ekf_covariance(self, message: str) -> bool:
        match = EKF_COVARIANCE_PATTERN.search(message)
        if match is None:
            return False

        self._ekf["position_covariance"] = {
            "x": float(match.group("cov_n")),
            "y": float(match.group("cov_e")),
            "z": float(match.group("cov_d")),
        }
        self._ekf["covariance_valid"] = True
        self._ekf["covariance_updated_at"] = time.time()
        self._mark_changed()
        return True

    @staticmethod
    def _is_repeating_telemetry(message: str) -> bool:
        return message.startswith(("[STATUS]", "[IMU]", "[GNSS]", "[EKF]", "[EKF_COV]"))

    def _snapshot_locked(self) -> dict:
        connected = self._serial is not None and self._serial.is_open
        return {
            "version": self._version,
            "connected": connected,
            "port": self._port if connected else "",
            "baud": self._baud,
            "logs": list(self._logs),
            "suppressed_rx_count": self._suppressed_rx_count,
            "attitude": dict(self._attitude),
            "altitude": dict(self._altitude),
            "ekf": self._ekf_snapshot_locked(),
        }

    def _ekf_snapshot_locked(self) -> dict:
        return {
            "frame": self._ekf["frame"],
            "position": dict(self._ekf["position"]),
            "velocity": dict(self._ekf["velocity"]),
            "position_covariance": dict(self._ekf["position_covariance"]),
            "valid": self._ekf["valid"],
            "covariance_valid": self._ekf["covariance_valid"],
            "updated_at": self._ekf["updated_at"],
            "covariance_updated_at": self._ekf["covariance_updated_at"],
        }

    def _mark_changed(self) -> None:
        with self._changed:
            self._version += 1
            self._changed.notify_all()


bridge = SerialBridge()
atexit.register(bridge.disconnect)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/ports")
def api_ports():
    ports = [port.device for port in serial.tools.list_ports.comports()]
    return jsonify({"ports": ports})


@app.get("/api/status")
def api_status():
    return jsonify(bridge.snapshot())


@app.get("/api/events")
def api_events():
    def stream():
        last_version = -1
        while True:
            snapshot = bridge.wait_for_snapshot(last_version)
            last_version = int(snapshot["version"])
            data = json.dumps(snapshot, separators=(",", ":"))
            yield f"data: {data}\n\n"

    return Response(stream_with_context(stream()), mimetype="text/event-stream")


@app.post("/api/connect")
def api_connect():
    payload = request.get_json(force=True)
    port = str(payload.get("port", ""))
    baud = int(payload.get("baud", 115200))

    try:
        bridge.connect(port, baud)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    return jsonify({"ok": True, "status": bridge.snapshot()})


@app.post("/api/disconnect")
def api_disconnect():
    bridge.disconnect()
    return jsonify({"ok": True, "status": bridge.snapshot()})


@app.post("/api/command")
def api_command():
    payload = request.get_json(force=True)
    command = str(payload.get("command", ""))

    try:
        bridge.send_command(command)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    return jsonify({"ok": True})


def main() -> None:
    parser = argparse.ArgumentParser(description="Localhost GCS command panel")
    parser.add_argument("--port", default="", help="Optional serial port to connect on startup, such as COM5")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--web-port", type=int, default=5000)
    args = parser.parse_args()

    if args.port:
        try:
            bridge.connect(args.port, args.baud)
        except Exception as exc:
            print(f"Serial autoconnect failed: {exc}")

    print()
    print("Ground Control System")
    print(f"Open http://{args.host}:{args.web_port}")
    print()

    app.run(host=args.host, port=args.web_port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
