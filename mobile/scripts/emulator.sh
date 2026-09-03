#!/usr/bin/env bash
# Arranca un emulador Android para BodegaHub Mobile (macOS/Linux/WSL).
# Reutiliza el primer AVD con API >= 30; ver mobile/scripts/emulator.ps1 para Windows nativo.
set -euo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"

[ -x "$ADB" ] || { echo "Falta adb en $ADB" >&2; exit 1; }
[ -x "$EMULATOR" ] || { echo "Falta el emulador en $EMULATOR" >&2; exit 1; }

if "$ADB" devices | grep -q "$(printf '\tdevice$')"; then
  serial="$("$ADB" devices | grep "$(printf '\tdevice$')" | head -1 | cut -f1)"
  echo "Dispositivo ya conectado: $serial"
  case "$serial" in emulator-*) ;; *) "$ADB" -s "$serial" reverse tcp:3000 tcp:3000 >/dev/null ;; esac
  exit 0
fi

target="${1:-}"
if [ -z "$target" ]; then
  best_api=0
  while read -r name; do
    [ -n "$name" ] || continue
    ini="$HOME/.android/avd/$name.ini"
    api=0
    [ -f "$ini" ] && api="$(sed -n 's/^target=android-\([0-9]*\)/\1/p' "$ini" | head -1)"
    api="${api:-0}"
    if [ "$api" -ge 30 ] && [ "$api" -gt "$best_api" ]; then best_api="$api"; target="$name"; fi
  done < <("$EMULATOR" -list-avds)
  [ -n "$target" ] || { echo "No hay AVDs con API >= 30." >&2; exit 1; }
  echo "Reutilizando AVD existente: $target (API $best_api)"
fi

"$EMULATOR" -avd "$target" -no-snapshot -no-audio -no-boot-anim "${EMU_EXTRA_ARGS:-}" >/dev/null 2>&1 &
"$ADB" wait-for-device

for _ in $(seq 1 100); do
  if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    echo "Emulador listo."
    "$ADB" reverse tcp:3000 tcp:3000 >/dev/null
    "$ADB" devices
    exit 0
  fi
  sleep 3
done

echo "El emulador no termino de arrancar en 5 minutos." >&2
exit 1
