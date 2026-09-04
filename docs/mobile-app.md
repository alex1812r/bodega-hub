# BodegaHub Mobile

App Android (preparada para iOS) del ERP/POS BodegaHub. Consume el mismo BFF
(`/api/*`) que la web; nunca habla con Supabase directo para datos, solo para
autenticarse.

**La app vive en su propio repositorio, hermano de este:**
`../bodegahub-app`. Esta pagina documenta como encaja con el backend; el detalle
de la app esta en su propio README. Lo unico que comparten es
[`packages/core`](../packages/core), que la app enlaza con
`file:../control-ventas/packages/core`.

Plan de ejecución: [`agent-prompts/mobile-app-gtm.md`](agent-prompts/mobile-app-gtm.md).
Estado de la corrida en curso: `../bodegahub-app/.notes/progress.md`.

## Estado actual

| Fase | Estado |
|------|--------|
| 0 Entorno y emulador | Hecho |
| 1 `@bodega/core` y Bearer en el BFF | Hecho y verificado contra Supabase real |
| 2 App base (login, tabs, tema, HTTP, offline, runner E2E) | Hecho y verificado en el emulador |
| 3 Catálogo (productos, inventario, contactos) | Hecho y verificado en el emulador |
| 4 POS y caja (turno, carrito, cobro con pagos mixtos) | Hecho salvo el escáner de cámara |
| Inicio (KPIs del periodo, mix de pagos, ventas recientes, stock bajo) | **Hecho y verificado con datos reales** |
| 5–11 (ventas/compras, baúl, reportes, platform, release) | Pendientes |

Verificado en el emulador con el APK de desarrollo y **datos reales** de la
tienda sandbox `bodega-qa-caos`: login contra Supabase, tabs por permisos, ciclo
completo de venta (abrir turno → cobrar → cerrar turno) y los indicadores de
Inicio cuadrados contra la base de datos. 127 tests unitarios y 9 flujos E2E en
verde.

### Inicio

Replica los indicadores del dashboard web, apilados: ventas del periodo en REF
con su comparación contra el periodo anterior, total en bolívares separando
cobrado de pendiente, clientes activos, alertas de stock, **mix de pagos**,
ventas recientes y productos bajo el mínimo.

Dos diferencias con la web, ambas deliberadas:

- **El periodo se elige entre Hoy, Ayer y Desde el inicio.** El rango a medida
  espera al selector de fechas que también necesitan los reportes.
- **El mix de pagos solo aparece con `reports.view`.** Vive en `/api/reports/**`,
  y el vendedor no tiene ese permiso: pedirlo igual solo daría un 403.

El cálculo del periodo y de la variación es `@bodega/core/dashboard`, el mismo
que usa la web. Cada cliente aporta su día operativo: la web fija una fecha en
modo mock y la app usa el día de Caracas del dispositivo.

## Setup

```bash
npm install                                  # este repo (web + packages/core)
cd ../bodegahub-app && npm install            # la app
cp .env.example .env
```

| Variable | Para qué |
|----------|----------|
| `EXPO_PUBLIC_API_BASE_URL` | URL del BFF. Emulador: `http://10.0.2.2:3000`. Dispositivo USB: `http://localhost:3000` con `adb reverse tcp:3000 tcp:3000`. Producción: `https://bodega-hub.vercel.app` |
| `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Login real. Sin ellas la app solo sirve contra el BFF en modo mock |
| `EXPO_PUBLIC_ALLOW_DEMO_AUTH` | `true` habilita la pantalla oculta de rol demo (5 toques en el logo del login). **Siempre `false` en release** |

Comandos:

```bash
cd ../bodegahub-app
./scripts/emulator.ps1     # arranca el emulador (reutiliza el AVD existente)
npx expo run:android       # compila e instala el build de desarrollo
npm test                   # unit + integración (jest-expo)
npm run typecheck
npm run e2e                # flujos E2E sobre adb
```

## Requisitos de disco

Una compilación nativa de Expo necesita del orden de **8–15 GB**: NDK, cachés de
Gradle (`~/.gradle/caches`) y las salidas de build con las `.so` de
`react-native-screens`, `reanimated` y `worklets`.

Si el disco del sistema va justo, apunta Gradle a otra unidad antes de compilar:

```bash
setx GRADLE_USER_HOME "D:\gradle"
```

Síntoma típico de disco lleno: Gradle falla con errores que *parecen* de otra
cosa (jar corrupto en `transforms`, `executionHistory.bin` ilegible, timeouts de
descarga). Si ves cualquiera de esos, comprueba el espacio libre antes de nada.

## Arquitectura

```text
control-ventas/packages/core/   @bodega/core — código puro compartido
  permissions, currency, sku, dates/ (Caracas), venezuela/, payments/, types/

bodegahub-app/                  repositorio propio
  src/
    api/        apiClient (Bearer + errores del BFF), queryClient, useApi
    auth/       sesión Supabase cifrada, AuthContext, permisos, tabs por rol
    ui/         Button Input Card Text Screen RoleTabs OfflineBanner + estados
    theme/      tokens de design-tokens.md, tema claro/oscuro/sistema
    offline/    estado de red, cache persistida, guardia de mutaciones
    modules/    un directorio por dominio (fases 3–7)
    app/        rutas de Expo Router
      _layout.tsx        providers + splash + redirección por rol
      (auth)/login.tsx
      (store)/           inicio pos ventas productos inventario mas
      (platform)/        inicio tiendas reportes mas
      dev.tsx            pantalla oculta de desarrollo
  e2e/          runner.mjs (adb) + flows/*.yaml
  scripts/      emulator.ps1 / emulator.sh
```

Stack: Expo SDK 57, React Native 0.86, React 19.2, Expo Router, TanStack Query,
`expo-secure-store`, Zod. `minSdk` 24, `compileSdk` 36, `applicationId`
`com.bodegahub.app`.

## Autenticación

La web se autentica por cookies; la app no tiene cookie jar compartido, así que:

1. `signInWithPassword` con `supabase-js` **en el dispositivo**.
2. Cada request al BFF lleva `Authorization: Bearer <access_token>`.
3. El BFF acepta el header sin que ninguna ruta cambie. El detalle está en
   [`backend-api-agent-guide.md`](backend-api-agent-guide.md) §Bearer.

Dos cosas que no son obvias:

- **`getUser()` necesita el token explícito.** Pasar `global.headers.Authorization`
  cubre PostgREST y RLS, pero `supabase.auth.getUser()` sin argumento resuelve el
  usuario desde cookies y devolvería `AuthSessionMissingError`.
- **La app valida `isActive` por su cuenta.** Esa comprobación vive en
  `POST /api/auth/login`, por donde la app no pasa. Tras el login lee
  `/api/auth/me` y cierra sesión si el usuario está inactivo.

La sesión se guarda **troceada** en `expo-secure-store`: una sesión de Supabase
supera el límite de ~2 KB por clave. Se parte en trozos de 1600 caracteres, todos
dentro del almacén seguro del sistema, en vez de cifrar a mano contra
AsyncStorage. El refresco automático se ata a `AppState`, o la sesión caduca
mientras la app está en segundo plano.

Verificación end-to-end contra el proyecto real:

```bash
node scripts/verify-bearer-auth.mjs
```

## Tabs por rol

Se calculan desde los **permisos efectivos** de `/api/auth/me`, no desde el rol.
La tabla es referencia, no la fuente de verdad:

| Rol | Tabs |
|-----|------|
| `admin` | Inicio · Ventas · Productos · Más |
| `vendedor` | Inicio · POS · Ventas · Más |
| `almacen` | Inicio · Productos · Inventario · Más |
| `contador` | Inicio · Ventas · Más |
| `superadmin` | Inicio · Tiendas · Reportes · Más |

Consecuencias reales de calcularlas por permisos:

- `admin` **no** ve el POS: no tiene `sales.create` ni `cash.operate`.
- `almacen` **no** ve Contactos ni Configuración: no tiene `contacts.view` ni `settings.view`.
- `contador` y `superadmin` no ven Configuración del negocio.

Se separa **Ajustes** (perfil, tema, versión, cerrar sesión; todos los roles) de
**Configuración del negocio** (tasa, usuarios, datos; requiere `settings.view`).

## Ventas e idempotencia

`POST /api/sales` no acepta clave de idempotencia, así que la app **nunca
reintenta una escritura automáticamente**. El cliente HTTP reintenta una vez los
`GET` ante fallo de red, y ninguna otra cosa.

Ante un fallo al confirmar, el mensaje pide verificar en Ventas antes de
reintentar y el carrito se conserva. Añadir `clientRequestId` al backend (con su
parche SQL) es trabajo post-GTM.

## Offline

Online-first con cache persistida:

- Las lecturas vuelven de AsyncStorage al arrancar, con tope de 24 h.
- Banner "Sin conexión" cuando NetInfo reporta red inalcanzable.
- Las mutaciones se bloquean con mensaje en español (`assertOnline`). La cola de
  ventas offline es post-GTM: aceptar en silencio una venta que nunca llega al
  backend es peor que rechazarla.
- Si la alcanzabilidad aún es desconocida, se deja pasar: bloquear ahí sería un
  falso positivo mientras NetInfo comprueba.

## Tests y E2E

```bash
cd ../bodegahub-app
npm test              # 46 tests: permisos, sesión, HTTP, offline, contexto de auth
npm run e2e:parser    # parser del runner E2E
npm run e2e           # flujos completos (necesita emulador + app instalada)
```

**Maestro no corre en Windows nativo**, solo bajo WSL2, y el emulador vive en el
lado Windows. Por eso el runner primario es `e2e/runner.mjs` de la app, que habla
`adb` directamente: `uiautomator dump` para localizar `testID`s, `input tap/text`
para actuar, `screencap` para la evidencia.

Lee el mismo subconjunto de YAML que Maestro, así que los flujos de
`e2e/flows/*.yaml` valen para los dos runners y cambiar de uno a otro no cuesta
nada. Un paso que falla captura la pantalla antes de lanzar el error.

Los `testID` viven todos en `src/testIds.ts` de la app.

## Decisiones y exclusiones

| Tema | Decisión |
|------|----------|
| Datos | Siempre por el BFF. Supabase directo solo para login |
| Navegación | Bottom tabs por rol + stack por tab. Sin drawer |
| Compartir código | `@bodega/core` como fuente TypeScript, sin paso de build |
| Quitar fondo con IA, import de Excel | Excluidos: modelo ONNX pesado y tarea de escritorio |
| Cola de ventas offline, push, biometría | Post-GTM |
| Crear tienda / crear admin | Excluidos: backoffice web |

## Diseño de la cola offline (post-GTM)

Para cuando se implemente, el diseño previsto:

1. Cada venta confirmada sin red se guarda en MMKV con un `clientRequestId` (UUID
   generado en el dispositivo) y estado `pendiente`.
2. El backend acepta ese `clientRequestId` en `POST /api/sales` y lo guarda con
   índice único, de modo que un reenvío devuelve la venta existente en vez de
   crear otra. **Esto requiere parche SQL y es el requisito bloqueante.**
3. Al recuperar la red, un worker reenvía las pendientes en orden, parando al
   primer error que no sea de red.
4. La UI muestra las pendientes con un distintivo y permite descartarlas.
5. El stock se valida de nuevo al sincronizar: una venta offline puede haber
   dejado el inventario en negativo.

Sin el paso 2 la cola es insegura, así que no se implementa antes.
