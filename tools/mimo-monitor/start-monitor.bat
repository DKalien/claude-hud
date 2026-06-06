@echo off
REM Start MIMO monitor as daemon (auto-exits when Claude is idle)
cd /d "%~dp0"
pythonw monitor.py --daemon --idle-timeout 1800
