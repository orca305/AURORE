@echo off
setlocal
cd /d "%~dp0..\ai-server"
set "AURORE_AI_MOCK=0"
set "AURORE_OLLAMA_MODEL=aurore-local:e4b"
set "AURORE_INTENT_ENABLE_ROUTING=0"
".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8001


