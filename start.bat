@echo off
title Seat Draft
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS installer from https://nodejs.org and run it, then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run - installing dependencies...
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo Install failed - check your internet connection. & pause & exit /b 1 )
)

echo.
echo Starting Seat Draft. Keep this window open during the game.
echo Open the "on your network" address below on the big screen.
echo.
node server\index.js
pause
