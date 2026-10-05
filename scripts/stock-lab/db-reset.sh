#!/usr/bin/env sh
# Wrapper: toda la logica vive en db-up.ts.
cd "$(dirname "$0")/../.." && exec npx tsx scripts/stock-lab/db-up.ts reset
