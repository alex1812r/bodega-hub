# Wrapper: toda la logica vive en db-up.ts.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
npx tsx scripts/stock-lab/db-up.ts reset
exit $LASTEXITCODE
