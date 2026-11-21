@echo off
rem 서비스 감시·자동 재시작(수집 포함). 창 없이 백그라운드에서 돈다: start "" /min local-dev\supervise-desktop.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0supervise-desktop.ps1" -Collectors
