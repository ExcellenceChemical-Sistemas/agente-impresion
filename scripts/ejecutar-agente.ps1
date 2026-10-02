# Lanzador del agente de impresion para el inicio automatico de Windows.
#
# - Si el agente se cae, lo vuelve a levantar a los 10 segundos.
# - Guarda todo lo que imprime el agente en logs\agente.log (se rota al pasar de 5 MB).
# - Nunca abre un segundo agente: dos agentes a la vez imprimirian cada etiqueta
#   duplicada. Si ya hay uno corriendo (por ejemplo abierto a mano con "npm run dev"),
#   espera a que ese termine y recien entonces toma su lugar.
# - Corre la version compilada (npm run start / dist\index.js), no "npm run dev": dev
#   usa tsx para transpilar TypeScript al vuelo en cada arranque, que es el flujo
#   pensado para desarrollo, no para producción corriendo desatendido. Si falta el
#   build, se detiene con un mensaje claro en vez de arrastrar el problema al log.
#
# Lo arranca la tarea programada que crea instalar-inicio-automatico.ps1; tambien se
# puede probar a mano:  powershell -ExecutionPolicy Bypass -File scripts\ejecutar-agente.ps1

param(
    # Ruta completa a npm.cmd (la resuelve el instalador; asi no depende del PATH al iniciar sesion).
    [string]$Npm = 'npm.cmd'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$carpeta = Split-Path -Leaf $raiz
Set-Location $raiz

$logs = Join-Path $raiz 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'agente.log'
$limiteBytes = 5MB

function Escribir([string]$texto) {
    "[{0}] [lanzador] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto | Add-Content -Path $log -Encoding UTF8
}

# Hay otro agente si algun node.exe corre el index de esta carpeta.
function AgenteCorriendo {
    $procesos = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $procesos) {
        if ($p.CommandLine -and $p.CommandLine -like "*$carpeta*" -and $p.CommandLine -like '*index.*') { return $true }
    }
    return $false
}

$distIndex = Join-Path $raiz 'dist\index.js'
if (-not (Test-Path $distIndex)) {
    Escribir "Falta el build ($distIndex no existe). Corre 'npm run build' en $raiz antes de iniciar el agente."
    throw "Falta el build: corre 'npm run build' en $raiz antes de iniciar el agente."
}

Escribir 'Lanzador iniciado.'

while ($true) {
    if (AgenteCorriendo) {
        Escribir 'Ya hay un agente corriendo; se espera a que termine para no imprimir duplicado.'
        while (AgenteCorriendo) { Start-Sleep -Seconds 30 }
        Escribir 'El otro agente termino; se toma su lugar.'
    }

    if ((Test-Path $log) -and ((Get-Item $log).Length -gt $limiteBytes)) {
        Move-Item -Force -Path $log -Destination (Join-Path $logs 'agente.log.old')
    }

    Escribir 'Arrancando el agente.'
    # cmd se encarga de juntar stdout y stderr en el mismo archivo (en PowerShell 5.1
    # redirigir el stderr de un programa nativo lo convierte en errores falsos).
    cmd.exe /c "`"$Npm`" run start >> `"$log`" 2>&1"
    Escribir ('El agente se detuvo (codigo {0}). Se reinicia en 10 segundos.' -f $LASTEXITCODE)
    Start-Sleep -Seconds 10
}
