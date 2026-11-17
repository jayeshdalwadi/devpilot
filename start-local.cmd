@echo off
rem Double-click or run from cmd: starts the app locally (see scripts/start-local.js)
cd /d "%~dp0"
node scripts\start-local.js %*
