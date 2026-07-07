@echo off
REM === Modern system info replacement for wmic ===
REM Usage: system-info [cpu|gpu|memory|disk|network]

if "%~1"=="cpu" (
    powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | Format-List"
    exit /b 0
)

if "%~1"=="gpu" (
    powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | Format-List"
    exit /b 0
)

if "%~1"=="memory" (
    powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1); Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | Format-List"
    exit /b 0
)

if "%~1"=="disk" (
    powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object Model,Size,InterfaceType | Format-List"
    powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,@{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}},@{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}} | Format-Table"
    exit /b 0
)

if "%~1"=="network" (
    powershell -NoProfile -Command "Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object Name,InterfaceDescription,LinkSpeed | Format-Table"
    exit /b 0
)

REM Default: show all info
echo === System Info ===
echo CPU:
powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | Format-List"
echo GPU:
powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | Format-List"
echo Memory:
powershell -NoProfile -Command "Write-Output ('Total: ' + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1) + ' GB')"
echo Disk:
powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,@{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}} | Format-Table"
exit /b 0
