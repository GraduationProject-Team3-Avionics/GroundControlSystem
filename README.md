# Ground Control System

A local web-based ground control system for a Nano ESP32 GCS board. It connects over a serial port, sends drone control commands, and displays IMU/GNSS telemetry in the browser.

Korean documentation is available in [README_ko.md](README_ko.md).

## Current Screen

![Ground Control System screen](docs/gcs-screen.png)

## UI Overview

| Area | Description |
| --- | --- |
| Altitude | Shows the current altitude as a vertical tape. Values are displayed in meters. |
| Top connection bar | Switches theme, selects the COM port, sets the baud rate, refreshes ports, and connects or disconnects. |
| Commands | Sends common commands such as Heartbeat, Arm, Disarm, Hover, Alt Hold, and Land. |
| PWM / Motor Test | Sends `pwm N` and `mt N` commands using the entered PWM value. |
| Custom | Sends a typed command directly. Examples: `help`, `pwm 1200` |
| Attitude | Displays IMU roll, pitch, and yaw using an artificial horizon and heading indicator. |
| Recent Activity | Shows TX/RX logs and recent system messages. |
| Attitude Plots | Shows Roll, Pitch, and Yaw history over the last 30 seconds. |

## Run

Python 3 is required.

```powershell
cd C:\Users\임현우\Desktop\Git\GroundControlSystem
python --version
pip install -r requirements.txt
python server.py
```

Open this address in a browser.

```text
http://127.0.0.1:5000
```

If port 5000 is already in use, choose another web port.

```powershell
python server.py --web-port 5001
```

To connect to a serial port immediately on startup, pass the COM port and baud rate.

```powershell
python server.py --port COM8 --baud 115200
```

To use a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

## Usage

1. Close Arduino IDE Serial Monitor.
2. Start the web server with `python server.py`.
3. Open `http://127.0.0.1:5000` in a browser.
4. Select the Nano ESP32 COM port from the port list.
5. Keep the baud rate at `115200`.
6. Click `Connect`.
7. Use the command buttons or type a command into the `Custom` input.

## Commands

| UI | Sent command |
| --- | --- |
| Heartbeat | `hb` |
| Arm | `arm` |
| Disarm | `disarm` |
| Hover | `hover` |
| Alt Hold | `althold` |
| Offboard | `offboard` |
| Land | Gradually sends `pwm N` from the current PWM value down to `1350` |
| Emergency Hover | `ehover` |
| Emergency Land | `eland` |
| Emergency Disarm | `edisarm` |
| Send PWM | `pwm N` |
| Motor Test | `mt N` |

## Notes

- Arduino IDE Serial Monitor and this web GCS cannot use the same COM port at the same time.
- If the port does not appear, click `Refresh` or reconnect the USB cable.
- If the connection succeeds but the drone does not respond, check `Recent Activity` for `TX`, `RX`, and `[TX CMD] ... result=ok` logs.
