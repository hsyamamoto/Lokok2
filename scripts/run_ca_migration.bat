@echo off
REM Wrapper para executar o script PowerShell de migração local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\run_ca_migration.ps1"
