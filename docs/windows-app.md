# Windows 데스크톱 앱 빌드

이 프로젝트는 Flask 서버와 웹 UI를 Windows 데스크톱 창 안에서 실행할 수 있습니다. 구조는 로컬 서버와 WebView 창을 함께 띄우는 방식입니다. 사용자는 브라우저 주소를 직접 열지 않고 `GroundControlSystem.exe`를 실행합니다.

## 개발 실행

```powershell
pip install -r requirements-app.txt
python .\desktop_app.py
```

시작하면서 바로 COM 포트에 연결하려면 아래처럼 실행합니다.

```powershell
python .\desktop_app.py --port COM8 --baud 115200
```

WebView 대신 기본 브라우저로 확인하려면 아래 옵션을 씁니다.

```powershell
python .\desktop_app.py --browser
```

## EXE 빌드

```powershell
.\scripts\build_windows.ps1
```

빌드가 끝나면 실행 파일이 생성됩니다.

```text
dist\GroundControlSystem\GroundControlSystem.exe
```

## 설치 프로그램 빌드

설치 프로그램까지 만들려면 Inno Setup이 필요합니다. Inno Setup이 설치되어 있고 `iscc` 명령을 사용할 수 있으면 `build_windows.ps1`이 자동으로 아래 파일도 만듭니다.

```text
dist\installer\GroundControlSystemSetup.exe
```

## 참고

- 앱은 기본적으로 `127.0.0.1`에서만 서버를 엽니다. 다른 PC나 휴대폰에서는 접속할 수 없습니다.
- Nano ESP32는 앱을 실행하는 Windows PC에 USB로 연결되어 있어야 합니다.
- WebView 창이 열리지 않는 PC는 Microsoft Edge WebView2 Runtime 설치가 필요할 수 있습니다.
- COM 포트는 Arduino IDE Serial Monitor와 동시에 사용할 수 없습니다.
