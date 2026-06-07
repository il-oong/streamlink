@echo off
chcp 65001 >nul
cd /d "%~dp0"
title StreamLink 서버

echo ====================================================
echo  StreamLink 서버 시작
echo ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b
)

if not exist yt-dlp.exe (
  echo YouTube 추출 도구를 다운로드합니다...
  curl -L -o yt-dlp.exe https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
  echo.
)

if not exist cloudflared.exe (
  echo 터널 프로그램을 다운로드합니다...
  curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  echo.
)

echo 추출 도구 최신 버전 확인 중...
yt-dlp.exe -U >nul 2>nul

echo.
echo ====================================================
echo  서버를 켭니다.
echo.
echo  잠시 후 아래에 나오는
echo    https://...trycloudflare.com
echo  주소를 복사해서 휴대폰 앱의 설정(톱니바퀴)에
echo  붙여넣으세요.
echo.
echo  이 창은 끄지 말고 켜 두세요.
echo ====================================================
echo.

start /b node server.js
cloudflared.exe tunnel --url http://localhost:3001
