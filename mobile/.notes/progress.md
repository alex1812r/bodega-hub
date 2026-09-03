# Progreso de la corrida

Una línea por fase. Versionado a propósito (regla 1.2 del plan).

| Fase | Estado | Commit | Nota |
|------|--------|--------|------|
| 0 Entorno y emulador | hecho | `7a5fb46` | SDK y AVD `Pixel_7_Pro_API_33` reutilizados; emulador arranca y responde en `emulator-5554`; WSL2 disponible |
| 1 Monorepo, core y Bearer | hecho | `4461a28`, `602285e`, `d40c3ef` | Bearer verificado **contra Supabase real** (5/5 en `scripts/verify-bearer-auth.mjs`); `@bodega/core` con workspaces; web intacta (796 tests, build ok) |
| 2 App base | en curso | — | — |

## Hallazgos que cambiaron el plan

1. **`getUser()` no basta.** Pasar `global.headers.Authorization` cubre PostgREST/RLS, pero
   `supabase.auth.getUser()` sin argumento resuelve el usuario desde cookies. Con Bearer devolvía
   `AuthSessionMissingError` → `null` → 401 en todas las rutas. Hay que pasar el token:
   `getUser(token)`.
2. **Token inválido daba 500.** Descubierto probando contra Supabase real, no en los tests: un JWT
   malformado o caducado produce `AuthApiError 403 bad_jwt`, que caía en `throwIfSupabaseError`.
   Ahora es 401, que es lo que el caso de caos 11.1 necesita para refrescar el token.
3. **Lint de la web ya venía en rojo.** 46 errores y 26 warnings en `main`, idénticos antes de tocar
   nada (casi todos `storybook/no-renderer-packages`). No es una regresión de esta rama, pero la
   sección 12 pide `lint` en verde: hay que decidir si se arregla aparte o se acepta como deuda.
4. **El puerto 3000 ya tenía un `next dev` del usuario.** No se mata; las pruebas van contra él.

## Estado del entorno

- Emulador: `emulator-5554` (Pixel 7 Pro, API 33) arriba.
- BFF: instancia del usuario en `http://localhost:3000`, modo supabase (`.env`).
- Credenciales de seed: `vendedor@example.com` / `Admin123!` funcionan contra el proyecto real.
