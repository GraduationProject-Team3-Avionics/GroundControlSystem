# Ground Control System

Arduino IDE Serial Monitor 대신 브라우저에서 로컬 GCS를 열고, Nano ESP32 GCS 보드로 시리얼 명령을 보내는 최소 버전입니다.

## 구성

```text
GroundControlSystem.ino    Arduino GCS firmware
server.py                  localhost web server + serial bridge
requirements.txt           Python dependencies
web/
  templates/index.html     Web UI
  static/attitude.js       Canvas artificial horizon renderer
  static/app.js            UI logic
  static/style.css         UI style
```

## 준비

Python 3이 필요합니다.

```powershell
cd C:\Users\임현우\Desktop\Git\GroundControlSystem
python --version
```

의존성을 설치합니다.

```powershell
pip install -r requirements.txt
```

가상환경을 쓰고 싶으면 아래처럼 실행합니다.

```powershell
cd C:\Users\임현우\Desktop\Git\GroundControlSystem
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 실행

기본 실행:

```powershell
cd C:\Users\임현우\Desktop\Git\GroundControlSystem
python server.py
```

브라우저에서 엽니다.

```text
http://127.0.0.1:5000
```

특정 포트로 바로 연결하면서 실행:

```powershell
python server.py --port COM13 --baud 115200
```

웹 서버 포트를 바꾸고 싶을 때:

```powershell
python server.py --web-port 5001
```

## 사용 순서

1. Arduino IDE Serial Monitor를 닫습니다.
2. `python server.py`를 실행합니다.
3. 브라우저에서 `http://127.0.0.1:5000`을 엽니다.
4. 포트 목록에서 Nano ESP32의 COM 포트를 선택합니다.
5. Baud rate는 `115200`으로 둡니다.
6. `Connect`를 누릅니다.
7. `Arm`, `Hover`, `Disarm`, `PWM`, `Motor Test` 버튼 또는 `Custom` 입력창으로 명령을 보냅니다.

## 지원 명령

현재 웹 UI는 Arduino 코드의 `parseSerialLine()`이 받는 텍스트 명령을 그대로 보냅니다.

| UI | 실제 전송 명령 |
| --- | --- |
| Heartbeat | `hb` |
| Arm | `arm` |
| Disarm | `disarm` |
| Hover | `hover` |
| Alt Hold | `althold` |
| Offboard | `offboard` |
| Emergency Hover | `ehover` |
| Emergency Land | `eland` |
| Emergency Disarm | `edisarm` |
| Send PWM | `pwm N` |
| Motor Test | `mt N` |

Custom 입력창에는 아래처럼 직접 입력할 수 있습니다.

```text
help
pwm 1200
mt 1100
1300
```

## 정상 동작 확인

명령을 보내면 Serial Log에 `TX`와 명령 관련 `RX`가 같이 보여야 합니다.

예시:

```text
[17:54:02] TX pwm 1200
[17:54:02] RX [CMD] SetBaseThrottle pwm=1200
[17:54:03] RX [TX CMD] SetBaseThrottle repeat=30 lastSeq=184 result=ok
```

이 로그는 웹 UI에서 보낸 명령이 Nano ESP32 GCS 보드까지 들어갔고, GCS 보드가 nRF24 송신을 시도했다는 뜻입니다.

단, `result=ok`는 FC가 명령을 수락했다는 의미가 아니라 GCS 보드의 `radio.write()`가 성공했다는 의미입니다. FC 수락 여부는 `[STATUS] ... CMD_ACCEPT` 같은 상태 텔레메트리를 봐야 합니다.

Recent Activity는 반복 출력되는 `[STATUS]`, `[IMU]`, `[GNSS]` 라인을 기본으로 숨기고, 화면에는 최근 이벤트 12개만 보여줍니다. 로그가 계속 밀려 내려가는 것을 막기 위한 동작입니다.

Attitude 패널은 Arduino가 출력하는 `[IMU] ... roll=... pitch=... yaw=...` 라인을 파싱해서 표시합니다. 브라우저는 `/api/events` SSE 스트림으로 값을 push 받아서 polling 없이 갱신합니다. `GroundControlSystem.ino`에서 `PRINT_IMU_TELEMETRY`가 `false`이면 인공수평의는 대기 상태로 남습니다.

## 주의사항

- Arduino IDE Serial Monitor와 이 웹 GCS는 같은 COM 포트를 동시에 사용할 수 없습니다.
- 웹 GCS 사용 중에는 Serial Monitor를 닫아야 합니다.
- Arduino 스케치 업로드 직후에는 COM 포트 번호가 바뀔 수 있습니다.
- 포트가 안 보이면 `Refresh`를 누르거나 USB 케이블을 다시 연결합니다.
- Windows에서 다른 프로그램이 COM 포트를 잡고 있으면 `Connect`가 실패합니다.

## 문제 해결

페이지가 안 열릴 때:

```powershell
python server.py
```

실행 후 아래 주소가 출력되는지 확인합니다.

```text
Open http://127.0.0.1:5000
```

5000 포트가 이미 사용 중이면:

```powershell
python server.py --web-port 5001
```

포트 목록 확인:

```powershell
python -m serial.tools.list_ports
```

서버 API 상태 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/status
```

COM 포트 연결은 되는데 FC가 반응하지 않을 때:

- Serial Log에 `TX`가 찍히는지 확인합니다.
- Serial Log에 Arduino의 `[TX CMD] ... result=ok`가 찍히는지 확인합니다.
- `[STATUS]` 로그에 `CMD_ACCEPT`, `CMD_REJECT`, `RF_LINK`가 찍히는지 확인합니다.
- `result=ok`만 있고 FC 반응이 없으면 nRF24 링크, FC arm 조건, FC 쪽 명령 수신 로직을 확인해야 합니다.
