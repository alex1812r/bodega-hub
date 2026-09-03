<#
.SYNOPSIS
  Arranca un emulador Android para la app BodegaHub Mobile.
.DESCRIPTION
  Reutiliza el primer AVD con API >= 30 que exista (regla de la Fase 0 del plan).
  Si no hay ninguno, intenta crear "bodega" con la imagen de sistema instalada mas reciente.
  Si no hay emulador posible, busca un dispositivo USB y prepara "adb reverse".
.PARAMETER NoWindow
  Arranca sin ventana (headless). Util en CI o corridas largas.
.PARAMETER Avd
  Fuerza un AVD concreto en vez de autodetectar.
#>
[CmdletBinding()]
param(
  [switch]$NoWindow,
  [string]$Avd
)

$ErrorActionPreference = 'Stop'

function Get-Sdk {
  foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk", "$env:USERPROFILE\Android\Sdk")) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  throw "No se encontro el Android SDK. Define ANDROID_HOME."
}

$sdk = Get-Sdk
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emulator = Join-Path $sdk 'emulator\emulator.exe'

if (-not (Test-Path $adb)) { throw "Falta adb en $adb" }
if (-not (Test-Path $emulator)) { throw "Falta el emulador en $emulator" }

# Ya hay un dispositivo listo: no arranques otro.
$attached = & $adb devices | Select-String -Pattern '\tdevice$'
if ($attached) {
  $serial = ($attached[0] -split '\s+')[0]
  Write-Host "Dispositivo ya conectado: $serial"
  if ($serial -notlike 'emulator-*') { & $adb -s $serial reverse tcp:3000 tcp:3000 | Out-Null }
  exit 0
}

$avds = & $emulator -list-avds | Where-Object { $_ -and $_.Trim() }

if ($Avd) {
  $target = $Avd
} elseif ($avds) {
  # Preferimos el AVD de API mas alta; el plan exige API >= 30.
  $ranked = foreach ($name in $avds) {
    $ini = Join-Path "$env:USERPROFILE\.android\avd" "$name.ini"
    $api = 0
    if (Test-Path $ini) {
      $line = Select-String -Path $ini -Pattern '^target=android-(\d+)' | Select-Object -First 1
      if ($line) { $api = [int]$line.Matches[0].Groups[1].Value }
    }
    [pscustomobject]@{ Name = $name; Api = $api }
  }
  $usable = $ranked | Where-Object { $_.Api -ge 30 } | Sort-Object Api -Descending
  if (-not $usable) { throw "Hay AVDs pero ninguno con API >= 30: $($avds -join ', ')" }
  $target = $usable[0].Name
  Write-Host "Reutilizando AVD existente: $target (API $($usable[0].Api))"
} else {
  throw "No hay AVDs. Crea uno con Android Studio o instala cmdline-tools para usar avdmanager."
}

$args = @('-avd', $target, '-no-snapshot', '-no-audio', '-no-boot-anim')
if ($NoWindow) { $args += '-no-window' }

Write-Host "Arrancando $target..."
Start-Process -FilePath $emulator -ArgumentList $args -WindowStyle Minimized | Out-Null

& $adb wait-for-device

$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  $booted = (& $adb shell getprop sys.boot_completed 2>$null | Out-String).Trim()
  if ($booted -eq '1') {
    Write-Host "Emulador listo."
    & $adb reverse tcp:3000 tcp:3000 | Out-Null
    & $adb devices
    exit 0
  }
  Start-Sleep -Seconds 3
}

throw "El emulador no termino de arrancar en 5 minutos."
