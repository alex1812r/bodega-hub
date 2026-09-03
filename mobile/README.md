# BodegaHub Mobile

App Android (preparada para iOS) del ERP/POS BodegaHub. Consume el mismo BFF
(`/api/*`) que la web, nunca Supabase directo para datos.

Plan de ejecucion: [`docs/agent-prompts/mobile-app-gtm.md`](../docs/agent-prompts/mobile-app-gtm.md).
Estado de la corrida: [`.notes/progress.md`](.notes/progress.md).

## Requisitos

- Node 20+, JDK 17–21, Android SDK con un AVD de API >= 30.
- El BFF corriendo (`npm run dev` en la raiz).

## Configuracion

```bash
cp .env.example .env
```

| Variable | Para que |
|----------|----------|
| `EXPO_PUBLIC_API_BASE_URL` | URL del BFF. Emulador: `http://10.0.2.2:3000`. Dispositivo USB: `http://localhost:3000` con `adb reverse tcp:3000 tcp:3000`. |
| `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Login real. Sin ellas la app solo funciona contra el BFF en modo mock. |
| `EXPO_PUBLIC_ALLOW_DEMO_AUTH` | `true` habilita la pantalla oculta de rol demo (5 toques en el logo). **Siempre `false` en release.** |

## Comandos

```bash
../mobile/scripts/emulator.ps1      # arranca el emulador (reutiliza el AVD que ya tengas)
npx expo run:android                # compila e instala el build de desarrollo
npm test                            # unit + integracion (jest-expo)
npm run typecheck
```

## Arquitectura

```text
src/
  api/        apiClient (Bearer + errores del BFF), queryClient, useApi
  auth/       sesion Supabase cifrada, AuthContext, permisos, tabs por rol
  ui/         componentes base (Button, Input, Card, Screen, estados, tabs)
  theme/      tokens de docs/design-tokens.md + tema claro/oscuro/sistema
  offline/    estado de red
  modules/    un directorio por dominio (fases 3-7)
  app/        rutas de Expo Router: (auth), (store), (platform)
```

La logica de negocio compartida con la web vive en
[`packages/core`](../packages/core) (`@bodega/core`): permisos, moneda REF/VES,
fechas de Caracas, bancos y telefonos venezolanos, metodos de pago y SKU.

## Autenticacion

La app hace `signInWithPassword` contra Supabase en el dispositivo y manda
`Authorization: Bearer <access_token>` a cada request del BFF. El detalle del
lado servidor esta en
[`docs/backend-api-agent-guide.md`](../docs/backend-api-agent-guide.md) §Bearer.

La sesion se guarda troceada en `expo-secure-store` (una sesion de Supabase pasa
del limite de ~2 KB por clave) y el refresco automatico se ata a `AppState`.
