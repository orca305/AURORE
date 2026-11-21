@echo off
setlocal
cd /d "%~dp0..\ai-server"
set "AURORE_AI_MOCK=0"
set "AURORE_OLLAMA_MODEL=aurore-local:e4b"
if exist "%~dp0model-profile.txt" (set /p AURORE_PROFILE_NAME=<"%~dp0model-profile.txt")
if /i "%AURORE_PROFILE_NAME%"=="quality" set "AURORE_OLLAMA_MODEL=aurore-local:12b"
set "AURORE_INTENT_ENABLE_ROUTING=0"
".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8001


