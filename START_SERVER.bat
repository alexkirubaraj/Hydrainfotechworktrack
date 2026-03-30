@echo off
title WorkTrack Server
echo.
echo ============================================
echo   WorkTrack Server Starting...
echo ============================================
echo.

:: Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please download from https://nodejs.org
    pause
    exit
)

:: Start server
echo Server is starting...
echo.
echo Admin Panel  : http://localhost:3000/admin
echo Employee App : http://localhost:3000/employee
echo.
echo Share your PC IP with employees.
echo To find your IP: open CMD and type 'ipconfig'
echo Example: http://192.168.1.10:3000/employee
echo.
echo *** Keep this window open. Do NOT close it. ***
echo.

:: Open admin panel in browser automatically
start "" "http://localhost:3000/admin"

:: Run server
node server.js

pause
