@echo off
REM wmic shim - redirects deprecated wmic to modern PowerShell equivalents
REM This file should be placed in a directory that's early in PATH

set "WMIC_ARGS=%*"
set "WMIC_LOWER=%WMIC_ARGS:~0,100%"
set "WMIC_LOWER=%WMIC_LOWER:a=A%"
set "WMIC_LOWER=%WMIC_LOWER:b=B%"
set "WMIC_LOWER=%WMIC_LOWER:c=C%"
set "WMIC_LOWER=%WMIC_LOWER:d=D%"
set "WMIC_LOWER=%WMIC_LOWER:e=E%"
set "WMIC_LOWER=%WMIC_LOWER:f=F%"
set "WMIC_LOWER=%WMIC_LOWER:g=G%"
set "WMIC_LOWER=%WMIC_LOWER:h=H%"
set "WMIC_LOWER=%WMIC_LOWER:i=I%"
set "WMIC_LOWER=%WMIC_LOWER:j=J%"
set "WMIC_LOWER=%WMIC_LOWER:k=K%"
set "WMIC_LOWER=%WMIC_LOWER:l=L%"
set "WMIC_LOWER=%WMIC_LOWER:m=M%"
set "WMIC_LOWER=%WMIC_LOWER:n=N%"
set "WMIC_LOWER=%WMIC_LOWER:o=O%"
set "WMIC_LOWER=%WMIC_LOWER:p=P%"
set "WMIC_LOWER=%WMIC_LOWER:q=Q%"
set "WMIC_LOWER=%WMIC_LOWER:r=R%"
set "WMIC_LOWER=%WMIC_LOWER:s=S%"
set "WMIC_LOWER=%WMIC_LOWER:t=T%"
set "WMIC_LOWER=%WMIC_LOWER:u=U%"
set "WMIC_LOWER=%WMIC_LOWER:v=V%"
set "WMIC_LOWER=%WMIC_LOWER:w=W%"
set "WMIC_LOWER=%WMIC_LOWER:x=X%"
set "WMIC_LOWER=%WMIC_LOWER:y=Y%"
set "WMIC_LOWER=%WMIC_LOWER:z=Z%"

echo === System Information (wmic shim) ===
echo Command: wmic %*
echo.

if "%WMIC_LOWER%"=="process" (
    powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object Name,ProcessId,CommandLine | Where-Object {$_.Name -like '*node*'} | Format-Table -AutoSize"
) else if "%WMIC_LOWER%"=="cpu" (
    powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | Format-List"
) else if "%WMIC_LOWER%"=="processid" (
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId=%WMIC_ARGS%' | Select-Object Name,ProcessId,CommandLine | Format-List"
) else if "%WMIC_LOWER%"=="win32_videocontroller" (
    powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | Format-List"
) else (
    powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object Name,Manufacturer,Model,TotalPhysicalMemory | Format-List"
    powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | Format-List"
    powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | Format-List"
)
exit /b 0
