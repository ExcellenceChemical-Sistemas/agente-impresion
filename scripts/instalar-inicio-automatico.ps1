# Hace que el agente de impresion arranque solo cuando se inicia sesion en Windows.
#
# Crea (o reemplaza) la tarea programada "AgenteImpresionExcellence" para el usuario
# actual. No hace falta ser administrador.
#
#   Instalar:   powershell -ExecutionPolicy Bypass -File scripts\instalar-inicio-automatico.ps1
#   Quitar:     powershell -ExecutionPolicy Bypass -File scripts\instalar-inicio-automatico.ps1 -Quitar
#
# Por que una tarea al iniciar sesion y no un servicio de Windows: un servicio corre en
# una sesion aislada donde las impresoras del usuario y el driver de la Epson suelen no
# estar disponibles, y el script de impresion (GDI+) falla. La tarea corre en la sesion
# del usuario, con la impresora a mano. A cambio, la PC tiene que tener la sesion
# iniciada (conviene configurarla con inicio de sesion automatico).

param(
    [switch]$Quitar
)

$ErrorActionPreference = 'Stop'
$nombre = 'AgenteImpresionExcellence'

if ($Quitar) {
    if (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $nombre -Confirm:$false
        Write-Host "Tarea '$nombre' eliminada. El agente ya no arranca solo."
    } else {
        Write-Host "La tarea '$nombre' no existe; no hay nada que quitar."
    }
    return
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$lanzador = Join-Path $PSScriptRoot 'ejecutar-agente.ps1'
$raiz = Split-Path -Parent $PSScriptRoot
$usuario = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path (Join-Path $raiz 'node_modules'))) {
    throw "Falta instalar las dependencias: corre 'npm install' en $raiz antes de instalar el inicio automatico."
}
if (-not (Test-Path (Join-Path $raiz 'dist\index.js'))) {
    throw "Falta compilar el agente: corre 'npm run build' en $raiz antes de instalar el inicio automatico (el lanzador corre la version compilada, no 'npm run dev')."
}

$argumentos = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$lanzador`" -Npm `"$npm`""
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentos -WorkingDirectory $raiz
$disparador = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$config = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $config `
    -Principal $principal -Description 'Agente de impresion de etiquetas (Excellence Chemical). Arranca al iniciar sesion.' `
    -Force | Out-Null

Write-Host "Listo: la tarea '$nombre' arrancara el agente cada vez que $usuario inicie sesion."
Write-Host "Logs del agente: $(Join-Path $raiz 'logs\agente.log')"
Write-Host ''
Write-Host 'Para probarla ahora sin reiniciar:'
Write-Host "  1) Cierra el agente si lo tienes abierto a mano (Ctrl+C en su terminal)."
Write-Host "  2) Start-ScheduledTask -TaskName $nombre"
Write-Host '(Si dejas el manual abierto, el lanzador espera a que termine para no imprimir duplicado.)'
