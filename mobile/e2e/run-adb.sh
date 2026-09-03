#!/usr/bin/env bash
# Runner E2E sobre adb. Uso: ./run-adb.sh [flujo...]
set -euo pipefail
node "$(dirname "$0")/runner.mjs" "$@"
