@echo off
pushd %~dp0
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
node server.js %*
pause
popd
