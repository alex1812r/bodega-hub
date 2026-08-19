# Cron de caja con GitHub Actions

Este proyecto usa GitHub Actions para ejecutar el cierre automatico de sesiones de caja vencidas y evitar las limitaciones de Vercel Hobby.

## Secrets requeridos

Configura en GitHub: `Settings -> Secrets and variables -> Actions`:

- `APP_BASE_URL`: URL publica de la app (ej. `https://bodega-hub.vercel.app`)
- `CRON_SECRET`: el mismo secret que valida `/api/cron/cash-sessions/auto-close`

## Workflow

Archivo: `.github/workflows/cash-auto-close.yml`

- `schedule`: cada 15 minutos (`*/15 * * * *`, UTC)
- `workflow_dispatch`: ejecucion manual desde la pestaña **Actions**

El job llama:

- `POST {APP_BASE_URL}/api/cron/cash-sessions/auto-close`
- Header: `Authorization: Bearer {CRON_SECRET}`

Falla si la respuesta HTTP no es `200`.

## Probar rapido

1. Ve a **Actions** en GitHub.
2. Abre **Auto close cash sessions**.
3. Ejecuta **Run workflow**.
4. Revisa logs y confirma status 200 con payload `closedCount/sessionIds`.
