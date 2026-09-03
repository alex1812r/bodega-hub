# Progreso de la corrida

Una línea por fase. Versionado a propósito (regla 1.2 del plan).

| Fase | Estado | Commits | Nota |
|------|--------|---------|------|
| 0 Entorno y emulador | hecho | `7a5fb46` | SDK y AVD `Pixel_7_Pro_API_33` reutilizados; emulador arranca y responde en `emulator-5554` |
| 1 Monorepo, core y Bearer | hecho | `4461a28`, `602285e`, `d40c3ef` | Bearer verificado **contra Supabase real** (5/5 en `scripts/verify-bearer-auth.mjs`); `@bodega/core` con workspaces; web intacta |
| 2 App base | código completo, **build nativo bloqueado** | `7aea527`, `ee09ad1`, `d77a479` | Login, tabs por permisos, tema, cliente HTTP, offline, runner E2E y 33 tests. No se ha podido instalar en el emulador: disco lleno (ver abajo) |
| 3–11 | no empezadas | — | Dependen de poder correr la app en el emulador |

## BLOQUEANTE: disco C: sin espacio

`npx expo run:android` falló cuatro veces. Las tres primeras parecían problemas
distintos (timeout de red, jar corrupto en transforms, `executionHistory.bin`
ilegible); todas eran el mismo síntoma: **C: llegó a 0 bytes libres**.

Estado al detectarlo:

| Unidad | Usado | Libre |
|--------|-------|-------|
| C: | 464,8 GB | 0 GB (tras limpiar lo mío: 0,73 GB) |
| D: | 312,2 GB | 619,35 GB |

Ya liberado (todo generado por esta corrida): `mobile/android/`, la copia de la
plantilla Expo en el scratchpad y `~/.gradle/.tmp`.

**No se ha tocado** `~/.gradle/caches` (8,46 GB): sus subdirectorios son de
septiembre de 2025, abril de 2024 y mayo de 2026, o sea de otros proyectos
Android del usuario. Borrarlo es decisión suya.

Una compilación nativa de Expo necesita del orden de 8–15 GB entre NDK, caches
de Gradle y salidas de build. Opciones, por orden de preferencia:

1. Mover la caché de Gradle a D: (`GRADLE_USER_HOME=D:\gradle`) y compilar allí.
2. Liberar ~15 GB en C:.
3. Mover el repo a D: por completo.

## Hallazgos que cambiaron el plan

1. **`getUser()` no basta.** Pasar `global.headers.Authorization` cubre PostgREST/RLS, pero
   `supabase.auth.getUser()` sin argumento resuelve el usuario desde cookies. Con Bearer devolvía
   `AuthSessionMissingError` → `null` → 401 en todas las rutas. Hay que pasar el token.
2. **Token inválido daba 500.** Descubierto probando contra Supabase real, no en los tests: un JWT
   malformado o caducado produce `AuthApiError 403 bad_jwt`, que caía en `throwIfSupabaseError`.
   Ahora es 401, que es lo que el caso de caos 11.1 necesita.
3. **Lint de la web ya venía en rojo.** 46 errores y 26 warnings en `main`, idénticos antes de tocar
   nada (casi todos `storybook/no-renderer-packages`). No es regresión de esta rama, pero la
   sección 12 pide `lint` en verde: hay que decidir si se arregla aparte o se acepta como deuda.
4. **El preset de Jest de React Native va en la raíz.** `jest-expo` se hoistea a la raíz del
   workspace y resuelve ahí su peer, así que `@react-native/jest-preset` tiene que estar en la raíz
   y en la versión exacta de React Native (0.86.3), no la última.
5. **`minSdk` = 24** (lo fija Expo SDK 57). El AVD de API 33 sirve; no hace falta imagen nueva.
6. **El puerto 3000 ya tenía un `next dev` del usuario.** No se mata; las pruebas van contra él.

## Estado del entorno

- Emulador: `emulator-5554` (Pixel 7 Pro, API 33) arriba.
- BFF: instancia del usuario en `http://localhost:3000`, modo supabase (`.env`).
- Credenciales de seed: `vendedor@example.com` / `Admin123!` verificadas contra el proyecto real.
- `mobile/.env` (gitignored) ya tiene la URL y la anon key reales para el login desde la app.
