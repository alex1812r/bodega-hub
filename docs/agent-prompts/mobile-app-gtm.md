# BodegaHub Mobile — plan de ejecución autónoma hasta GTM

> **Para el humano:** abre Claude Code en la raíz del repo y escribe:
> `Ejecuta docs/agent-prompts/mobile-app-gtm.md de principio a fin. No te detengas hasta cumplir la sección 12.`
> Antes de arrancar (5 minutos que evitan días):
> 1. **Mergea `feat/assistant-chat` a `main`** y commitea este documento en `main`. El plan crea `feat/mobile-app` desde `main`; si el documento o `/api/chat` no están ahí, el agente no los ve.
> 2. **Pon `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env.local`.** Es lo único que el modo mock no puede validar: login real, refresh de token y Bearer contra RLS. Sin ellas el plan avanza, pero el reporte final dirá "auth real no verificada".
> 3. Requisitos deseables (el plan los instala si faltan): Android SDK, JDK 17–21, Node 20+. Si tu equipo no puede correr un emulador (sin virtualización), conecta un teléfono con depuración USB y el plan lo usa en su lugar.
> 4. En Windows, Maestro solo corre en WSL2. Si no tienes WSL2, el plan usa el runner `adb` propio (9.2) sin pedirte nada.

---

## 0. Misión

Construir **BodegaHub Mobile**: la app Android (y preparada para iOS) del ERP/POS BodegaHub, con paridad funcional con la web para el trabajo diario de una bodega, pero con componentes, navegación y gestos **nativos de móvil**, no una web empaquetada. La app consume el mismo backend (BFF Next.js + Supabase) que la web.

Entregables:

1. Carpeta `mobile/` (Expo + React Native + TypeScript) en este repo, funcionando contra el BFF existente.
2. Cambios mínimos y retrocompatibles en el BFF para autenticación por token (sección 3).
3. Paquete `packages/core` con el código puro compartido entre web y móvil.
4. Suite de tests unitarios + flujos E2E ejecutados en emulador con capturas.
5. APK release firmado + configuración EAS lista.
6. Documentación (`docs/mobile-app.md`, `modules-catalog.md`) y reporte final.

**No terminas hasta que la sección 12 ("Definición de hecho") esté completa.** El ciclo de calidad (sección 9) se repite hasta dos pasadas limpias seguidas.

---

## 1. Reglas de operación (leer dos veces)

1. **Autonomía total.** No pidas confirmación ni propongas opciones. Decide con las reglas de este documento y ejecuta. Únicas preguntas permitidas al humano: las de 1.6, cada una una sola vez, y sin detenerte a esperar respuesta.
2. **Silencio operativo.** No narres progreso ni expliques qué harás. Las únicas salidas al humano son: el **reporte de hito** al cerrar el hito GTM mínimo (sección 7, ≤ 15 líneas) y el reporte final (sección 13, ≤ 50 líneas). Además mantienes `mobile/.notes/progress.md` **versionado** (una línea por fase: fecha, estado, commit) para que una corrida larga se pueda seguir y retomar. Todo lo demás son acciones, commits y archivos.
3. **Economía de tokens.** Lee con `grep`/`sed -n`, no archivos enteros. Subagentes devuelven ≤ 15 líneas. No repitas lecturas; anota firmas en `mobile/.notes/` (gitignored salvo `progress.md`). No expliques código en prosa.
4. **Manda la versión instalada.** Expo, Expo Router, React Native, NativeWind, TanStack Query, Maestro: después de instalar, lee el README/`.d.ts` de `node_modules` para las APIs que uses. Los nombres de este plan son orientativos. Para el backend, `AGENTS.md` exige leer `node_modules/next/dist/docs/` antes de tocar Next 16.
5. **Pruebas en emulador, siempre.** Nada se da por funcionando sin haberlo visto en el emulador (o dispositivo USB). Captura de pantalla = evidencia. Si una herramienta de E2E no funciona, cambias de herramienta (sección 9.2), no de estándar.
6. **Preguntas permitidas (una vez cada una, sin bloquear):**
   - Si no hay `.env.local` con `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` válidos y el BFF no arranca en modo supabase: *"Sin credenciales de Supabase en .env.local; desarrollo y pruebo contra el BFF en modo mock (API_DATA_SOURCE=mock, ALLOW_DEMO_AUTH=true). Para probar login real, agrégalas."* y sigues en mock. Vuelves a comprobar `.env.local` al inicio de cada ciclo 9; si aparecen, ejecutas el flujo `00-login` y el test de Bearer contra Supabase real.
   - Si el emulador no puede crearse por falta de virtualización y no hay dispositivo USB: *"No hay emulador ni dispositivo Android disponible. Conecta un teléfono con depuración USB o habilita virtualización; continúo con tests unitarios y vuelvo a intentar el emulador en cada ciclo."*
7. **Git.** Rama `feat/mobile-app` desde `main`. Si `main` no contiene `src/app/api/chat/` (el asistente aún no se mergeó), crea la rama desde `feat/assistant-chat` y anótalo en el reporte. Commits pequeños, mensajes en inglés imperativo como los existentes. `git push -u origin feat/mobile-app` permitido. **Nunca** merge a `main`, nunca `push --force`, nunca tocar Vercel ni Supabase de producción.
8. **Secretos.** Nada de keys, keystores ni contraseñas versionadas. `mobile/.env`, `mobile/android/keystores/`, `mobile/credentials.md` van al `.gitignore`. Solo `mobile/.env.example` con placeholders.
9. **El backend web no se rompe.** Cualquier cambio en `src/` debe ser retrocompatible con la web, cubierto por tests, y `npm run typecheck && npm run lint && npm test && npm run build` (web) deben seguir en verde. Si el monorepo (workspaces) rompe el build web y no lo arreglas en 2 intentos, aplica el plan B de 4.2.
10. **Estilo.** Screaming architecture como la web: `mobile/src/modules/<dominio>/<pantalla>/`, `hooks/`, `services/`. Componentes base en `mobile/src/ui/` con los **mismos nombres** que `src/shared/components/` cuando exista equivalente. Español en toda la UI y mensajes. Tokens de `docs/design-tokens.md`.
11. **Sin funciones inventadas de negocio.** La app hace lo que la web hace, adaptado. No inventes reglas ni avisos que el backend o la web no tengan (si la web muestra un aviso, la app muestra el mismo; si no, no). Si una pantalla web depende de algo no disponible en móvil, se adapta o se excluye según la sección 5.
12. **Cuando dudes entre dos formas de hacer algo, elige la más simple que cumpla la sección 12.**

---

## 2. Contexto obligatorio (una sola lectura, con `sed -n`/`grep`)

| Archivo | Qué extraer |
|---------|-------------|
| `AGENTS.md`, `docs/README.md`, `docs/modules-catalog.md` (completo) | Mapa de módulos, rutas, hooks, endpoints, tablas, permisos |
| `docs/plan-erp.md` §1, §5, §7 | Modelo REF/VES y reglas críticas de negocio |
| `docs/auth-permissions.md` | Roles, permisos, overrides, demo auth |
| `docs/frontend-api-guide.md` | `apiFetch`, `PaginatedList`, convenciones TanStack Query, manejo 401 |
| `docs/mock-api-endpoints.md`, `public/openapi.yml` | Contrato exacto de cada endpoint |
| `docs/responsive-ui.md`, `docs/design-tokens.md` | Breakpoints, tarjetas, tokens de color/tipografía |
| `docs/cuadre-baul.md` §1, `docs/chat-ia-analisis.md` | Semántica de caja/baúl; si existe rama/feature de asistente |
| `src/lib/supabase/route-client.ts`, `server-client.ts`, `auth/profile.server.ts`, `src/lib/api/requirePermission.ts` | Cómo se autentica el BFF (cookies) — para el cambio Bearer |
| `src/app/api/auth/login/route.ts`, `me/route.ts`, `logout/route.ts` | Contrato de auth |
| `src/shared/api/apiFetch.ts`, `src/lib/query/query-client.ts` | Cliente HTTP y política 401 |
| `src/shared/auth/permissions.ts`, `Can.tsx`, `src/shared/components/AppShell/appShellNav.ts` | Permisos y menú |
| `src/shared/utils/currency.ts`, `caracasBusinessDay.ts`, `date.ts`, `skuGeneration.ts`, `src/shared/venezuela/*`, `src/shared/payments/paymentMethods.ts` | Código puro a compartir |
| `src/modules/*/types.ts`, `src/modules/purchases/schemas/*` | Tipos y schemas Zod por dominio |
| `src/modules/sales/sale-create/**` (`PosProductGrid`, `PosCartPanel`, `PosCashSessionGate`, checkout) | Reglas del POS |
| `src/modules/cash/**` (`OpenCashSessionModal`, `CloseCashSessionModal`, `CashSessionCountdown`, `cashSessionDeadline.ts`) | Reglas de caja |
| `src/modules/products/**`, `inventory/**`, `contacts/**`, `purchases/**`, `payments/**`, `vault/**`, `reports/**`, `settings/**`, `dashboard/**`, `platform/**` (solo `page.tsx` de cada pantalla y `hooks/`) | Qué muestra cada pantalla y qué hooks usa |
| `src/shared/components/*` (solo nombres y props exportadas) | Catálogo de componentes a espejar |
| `docs/dev-seed-users.md` | Credenciales demo |
| `package.json`, `tsconfig.json`, `jest.config.ts`, `eslint.config.mjs` | Config raíz |

---

## 3. Decisiones fijas (no reabrir)

| Tema | Decisión |
|------|----------|
| Stack | **Expo SDK más reciente estable** + React Native + TypeScript estricto. **Expo Router** (file-based, como App Router). **TanStack Query** (misma versión mayor que la web). **NativeWind** (Tailwind en RN) con los tokens del repo. **Zod** compartido. `expo-secure-store` (sesión; **ojo:** admite ~2 KB por clave y una sesión de Supabase suele superarlos → patrón "clave AES en SecureStore + sesión cifrada en MMKV/AsyncStorage", como el adaptador `LargeSecureStore` de la doc de Supabase para Expo), `expo-camera` (barcode), `expo-image` + `expo-image-picker` + `expo-image-manipulator` (fotos con recorte 4:3), `expo-print` + `expo-sharing` (recibos/reportes PDF), `@shopify/flash-list` (listas), `@react-native-community/netinfo`, `react-native-mmkv` o AsyncStorage (persistencia de cache). Gráficos: `react-native-gifted-charts` (JS puro) o equivalente sin nativo extra. |
| Backend | La app consume **el BFF** (`/api/*`), nunca Supabase directo para datos. Login con `supabase-js` en la app (`signInWithPassword`) → sesión con refresh automático (`startAutoRefresh`/`stopAutoRefresh` atados a `AppState`, como pide la doc de Supabase para RN) → cada request al BFF lleva `Authorization: Bearer <access_token>`. Tras el login, la app llama `/api/auth/me` y si `user.isActive` es `false` cierra sesión con el mismo mensaje que la web ("Tu usuario esta inactivo."): la ruta web `/api/auth/login` hace esa validación y el móvil no pasa por ella. |
| Cambio BFF | Dos piezas, ambas necesarias: (a) `createRouteSupabaseClient()` (y `createServerSupabaseClient()` si `getAuthProfileFromSession` lo usa) leen `Authorization: Bearer` de `headers()`; si existe, crean el cliente con `global.headers.Authorization` y cookies vacías — eso cubre PostgREST/RLS. (b) `getAuthProfileFromSession()` en `src/lib/supabase/auth/profile.server.ts` debe llamar `supabase.auth.getUser(token)` **pasando el token** cuando viene por header: `getUser()` sin argumento lee la sesión de cookies y con Bearer devuelve "Auth session missing" → `null` → 401. Extrae un helper `getBearerToken()` en `src/lib/supabase/` y úsalo en ambos sitios. `proxy.ts` no cambia (excluye `/api`). Tests: `route-client.test.ts` (con y sin header), `profile.server.test.ts` (getUser recibe el token) y una ruta existente ejecutada con `Authorization` en vez de cookie. Sin token ni cookie → comportamiento actual. |
| Demo auth | En dev con `ALLOW_DEMO_AUTH=true`, la app puede enviar `x-demo-role` / `x-demo-user-id` (pantalla oculta de dev, 5 toques en la versión) para E2E sin Supabase. |
| URL del BFF | `EXPO_PUBLIC_API_BASE_URL`. Emulador Android → `http://10.0.2.2:3000`. Dispositivo USB → `adb reverse tcp:3000 tcp:3000` + `http://localhost:3000`. Producción → `https://bodega-hub.vercel.app`. |
| Repo | **npm workspaces**: raíz `package.json` gana `"workspaces": ["mobile", "packages/*"]`. `packages/core` = código puro (tipos, schemas Zod, permisos, moneda, fechas Caracas, bancos/teléfonos VE, métodos de pago, generación SKU), consumido **como fuente TS** (sin paso de build): `"exports"` por subpath apuntando a `src/`. Config obligatoria que el plan no da por hecha: `transpilePackages: ["@bodega/core"]` en `next.config.ts`, `moduleNameMapper` o `transformIgnorePatterns` en `jest.config.ts` de la raíz para el symlink, y `watchFolders` + `nodeModulesPaths` en `mobile/metro.config.js`. La web pasa a re-exportar desde `@bodega/core` (shims de una línea en los archivos originales, sin mover tests). Expo SDK 57 y la web comparten React 19.2, así que el riesgo de React duplicado es bajo; aun así verifica `npm ls react` tras instalar. Plan B (4.2) si rompe el build web. |
| Navegación | **Bottom tabs** por rol + stack por tab. Nada de drawer. Modales → bottom sheets. Listas → tarjetas (como el modo móvil de la web) con búsqueda sticky y filtros en sheet. |
| Plataformas | GTM = **Android** (APK firmado + EAS listo). iOS: proyecto compila con `expo prebuild --platform ios` sin errores de configuración; build real queda para cuando haya Mac/EAS. |
| Offline | **Online-first con cache persistente**: lecturas recientes disponibles sin red, banner "Sin conexión", mutaciones bloqueadas con mensaje claro. Cola de ventas offline = **post-GTM** (documentar diseño, no implementar). |
| Push | Post-GTM. |
| Testing | Jest + `@testing-library/react-native` + MSW (unit/integration). E2E en emulador con **dos runners equivalentes** que ejecutan los mismos flujos YAML de la sección 10: **Maestro** (macOS/Linux/WSL2; en Windows nativo no existe) y el runner propio `mobile/e2e/run-adb.*` (`adb shell input` + `uiautomator dump` + `screencap`). En Windows el runner `adb` es el **primario**; Maestro solo si WSL2 está instalado y `maestro` en WSL alcanza el `adb` del host (`ADB_SERVER_SOCKET=tcp:<ip-host>:5037` con `adb -a nodaemon server start` en Windows). No pierdas más de un intento en eso. |
| Distribución | `expo prebuild` + Gradle `assembleRelease` con keystore generado localmente (gitignored). `eas.json` con perfiles `development`, `preview`, `production`. Nombre "BodegaHub", `applicationId com.bodegahub.app`, `1.0.0` / `versionCode 1`. |

---

## 4. Arquitectura

### 4.1 Estructura objetivo

```text
packages/core/                          @bodega/core — puro, sin React ni Node APIs
  src/
    types/            (sales, purchases, products, contacts, payments, cash, vault, reports, auth, platform)
    schemas/          (Zod: create sale/purchase/payment/product/contact, cash open/close…)
    permissions.ts    (userRoles, permissions, rolePermissions, hasPermission)
    currency.ts       (refToVes, formatRefUsd, formatVesBs, roundMoney)
    dates/            (caracasBusinessDay, presets, cashSessionDeadline)
    venezuela/        (banks, phone)
    payments/         (paymentMethods, validaciones por método)
    sku.ts
  package.json  tsconfig.json  jest.config.ts

mobile/
  app/                                  Expo Router
    _layout.tsx                         providers: QueryClient, Auth, Theme, NetInfo
    (auth)/login.tsx
    (store)/_layout.tsx                 tabs por rol de tienda
      inicio/  ventas/  productos/  mas/          (tabs) — cada una con su stack
    (platform)/_layout.tsx              tabs superadmin: inicio/ tiendas/ reportes/ mas/
    +not-found.tsx
  src/
    api/          apiClient.ts (fetch + Bearer + 401 → logout), queryClient.ts, endpoints por dominio
    auth/         session.ts (supabase-js + SecureStore), useAuth.ts, useCan.ts, roleTabs.ts
    ui/           Button Input Textarea SelectField(PickerSheet) Card Badge Skeleton EmptyState ErrorState
                  LoadingState BottomSheet ScreenHeader SearchBar FilterSheet ListCard MoneyPair
                  StatusBadge InfoGrid DetailSection ActionsMenu(sheet) Pagination(infinite) Toast
                  VenezuelanPhoneField VenezuelanBankField DateRangeSheet ThemeToggle OfflineBanner
    theme/        tokens.ts (desde docs/design-tokens.md), nativewind config, useTheme
    modules/
      dashboard/  products/  inventory/  contacts/  sales/  pos/  cash/  purchases/  payments/
      vault/  reports/  settings/  platform/  assistant/(condicional)  dev/
        <pantalla>/screen.tsx  components/  hooks/  services/
    offline/      persister.ts, useNetworkStatus.ts, mutationGuard.ts, cartDraft.ts (carrito POS persistido)
    utils/        share.ts (pdf), scanner.ts, haptics.ts
  e2e/            flows/*.yaml (Maestro)  screenshots/ (gitignored)  run.ps1 / run.sh (Maestro)  run-adb.ps1 / run-adb.sh (runner adb)
  scripts/        emulator.ps1 / emulator.sh (crear/arrancar AVD), build-release.sh
  assets/         icon.png adaptive-icon.png splash.png (generados)
  app.config.ts  eas.json  package.json  tsconfig.json  babel.config.js  tailwind.config.js  jest.config.ts
  .env.example  .gitignore

src/ (web)                              solo shims de re-export hacia @bodega/core + cambio Bearer
docs/mobile-app.md                      guía de la app (setup, arquitectura, build, E2E)
```

### 4.2 Plan B de repo

Si tras 2 intentos los workspaces rompen `npm run build` de la web (hoisting, versiones duplicadas de React, Metro resolviendo mal): quita `workspaces` de la raíz y deja `mobile/` con `package.json` y lockfile propios. `packages/core` deja de ser paquete npm y se consume **por alias de ruta** en ambos lados: `"@bodega/core/*": ["../packages/core/src/*"]` en `paths` de los dos `tsconfig`, `moduleNameMapper` en los dos `jest.config`, `watchFolders` en Metro y, si Next rechaza importar fuera de la raíz, `experimental.externalDir` o `packages/core` en `tsconfig.include`. Los shims de la web **se mantienen** (apuntan al alias): el código compartido no se pierde, solo cambia cómo se resuelve. Anótalo en el reporte.

### 4.3 Mapa de tabs por rol

| Rol | Tabs | Contenido |
|-----|------|-----------|
| `admin` | Inicio · Ventas · Productos · Más | Inicio=dashboard; Ventas=lista+detalle (sin POS ni "Mi caja": admin no tiene `sales.create` ni `cash.operate`); Productos=catálogo/inventario/categorías; Más=Compras, Contactos, Pagos, Cajas, Baúl, Reportes, Configuración del negocio, Ajustes |
| `vendedor` | Inicio · POS · Ventas · Más | POS es la tab central destacada; Más=Productos (ver), Contactos (clientes), Pagos (ver), Mi caja, Ajustes |
| `almacen` | Inicio · Productos · Inventario · Más | Más=Compras, Ajustes. **Sin** Contactos ni Configuración: el rol no tiene `contacts.view` ni `settings.view` (el catálogo proveedor-producto se abre desde Producto › Proveedores, que sí está en `products.view`) |
| `contador` | Inicio · Ventas · Pagos · Más | Más=Compras, Contactos, Caja (ver), Baúl (ver), Reportes, Ajustes. **Sin** Configuración del negocio (no tiene `settings.view`) |
| `superadmin` | Inicio · Tiendas · Reportes · Más | Dashboard multitienda; tiendas (lista/detalle, sin crear); reportes multitienda; Más=Usuarios (lista), Asistente (si aplica), Ajustes. **Sin** Configuración del negocio |

Dos pantallas distintas que la web mezcla en `/settings`: **Ajustes** (perfil, tema, versión, logout, pantalla dev) es de la app y la ve todo rol; **Configuración del negocio** (tasa, usuarios, datos del negocio, métodos habilitados) exige `settings.view`/`users.manage`.

Las tabs y las entradas de "Más" se calculan desde los permisos efectivos (`/api/auth/me`) con la tabla `rolePermissions` de `core` como referencia, no desde el rol hardcodeado; la tabla de arriba es la guía y ya está cruzada con `src/shared/auth/permissions.ts`. Una pantalla a la que el usuario navega sin permiso muestra `ErrorState` 403, nunca crashea.

---

## 5. Alcance funcional (web → móvil)

Leyenda: **Paridad** = igual que la web; **Adaptado** = misma capacidad, UI distinta; **Reducido** = subconjunto; **Excluido** = no va en GTM (con motivo).

| Módulo | Pantallas móviles | Estado | Adaptaciones clave |
|--------|-------------------|--------|--------------------|
| Auth | Login; splash con restauración de sesión; logout | Paridad | Sesión cifrada (ver §3); refresh automático atado a `AppState`; `isActive=false` en `/me` → logout con mensaje; 401 → login limpiando cache; biometría **excluida** (post-GTM) |
| Dashboard | Inicio con KPIs (hoy/ayer/rango/desde inicio), comparación con periodo anterior, tendencia, ventas recientes, stock bajo | Adaptado | Tarjetas apiladas; rango con `DateRangeSheet`; pull-to-refresh; tasa del día en cabecera |
| POS (`/sales/create`) | Gate de caja (abrir/contador regresivo/vencida); grid 2 columnas con imagen, precio REF+Bs, stock; búsqueda sticky; **escáner de cámara** (EAN-13/8, Code128, QR) + soporte lector USB/Bluetooth (Enter); carrito en bottom sheet con badge; cliente por defecto "Consumidor final" cambiable; checkout con pagos mixtos (efectivo Bs, efectivo USD, pago móvil, punto, transferencia) con validaciones idénticas a la web; confirmación; recibo compartible (PDF) | Adaptado | Cámara sustituye al lector USB como entrada principal; haptics al agregar; teclado numérico; el catálogo se cachea (como la web); **carrito persistido** en MMKV (`offline/cartDraft.ts`) y restaurado al volver al POS, para 11.1 y 11.9; confirmar venta **sin reintento automático** (ver 11.3) |
| Ventas | Lista (filtros estado/cliente/fecha), detalle (ítems, pagos, saldo), registrar pago, anular (con permiso), devolver, compartir recibo PDF | Paridad | Lista en tarjetas con scroll infinito; acciones en sheet |
| Caja | Mi caja (abrir con fondo, resumen del turno, contador regresivo, cerrar con desglose fondo/ventas/cuenta como `CloseCashSessionModal`, panel vencida); Cajas (admin: lista, crear, asignar usuario, activar/desactivar) | Paridad | — |
| Productos | Lista (búsqueda, categoría, estado, imagen), detalle (resumen, stock, historial de precios, ventas del SKU, proveedores + empaques), crear/editar, cambiar precio con motivo, **agregar código de barras con cámara**, foto con cámara/galería + recorte 4:3 y subida firmada, categorías CRUD, desactivar/reactivar | Adaptado | Quitar fondo con IA **excluido** (modelo ONNX pesado); import Excel **excluido** (es tarea de escritorio) |
| Inventario | Existencias (filtros), ajustes (entrada/salida/motivo), movimientos por producto, kardex, conversión empaque→unidad | Paridad | — |
| Contactos | Lista (tipo/búsqueda), detalle con tabs (actividad, ventas, compras, pagos, productos de proveedor), crear/editar, desactivar; catálogo proveedor-producto (vincular, cotizar, historial, empaques M10–M15) | Paridad | Vendedor solo ve clientes (regla del backend) |
| Compras | Lista, detalle (recibir, anular, devolver, pagar), crear con modo unidad/empaque, presets de empaque por proveedor, pago inicial opcional | Paridad | Formulario por pasos (proveedor → líneas → totales/pago) |
| Pagos | Lista (dirección, método, contacto), detalle, registrar (desde venta/compra), anular (permiso) | Paridad | Campos por método con `VenezuelanBankField`/`PhoneField` |
| Baúl | Saldos (efectivo Bs, cuenta Bs, REF), movimientos, depositar, retirar, transferir cierres | Paridad | Mismo aviso de cierres sin transferir que muestra la web (`/api/cash/closures/untransferred`); ningún texto nuevo. Depositar/retirar/transferir van **después del hito GTM mínimo** (§7) |
| Reportes | Cierre del día, ventas diarias, ganancia bruta, rentabilidad, top productos, top clientes, compras por cliente, compras, proveedores, stock bajo, métodos de pago, depreciación FX, kardex (los 13 de `src/app/api/reports/`); rango de fechas; **compartir PDF** | Reducido | Excel **excluido**; gráficos simples; tablas anchas → tarjetas o scroll horizontal; el PDF va después del hito GTM mínimo |
| Ajustes (app) | Perfil, tema claro/oscuro/sistema, versión, logout, pantalla dev (solo dev) | Adaptado | Para todos los roles; no requiere permiso |
| Configuración del negocio | Tasa actual + historial + registrar manual, usuarios (lista, crear, activar/desactivar, cambiar rol), datos del negocio (nombre, prefijo factura, IVA, umbral stock, métodos habilitados) | Paridad | Requiere `settings.view` (usuarios: `users.manage`); overrides de permisos por usuario **excluidos** (la web tampoco los tiene) |
| Platform (superadmin) | Dashboard multitienda con selector de alcance, tiendas (lista/detalle), usuarios (lista/detalle), reportes multitienda | Reducido | Crear tienda / crear admin **excluidos** (backoffice web). Va después del hito GTM mínimo |
| Asistente IA | Chat con chips y bloque "Fuente" | Condicional | Solo si `/api/chat` existe en `main` o en la rama `feat/assistant-chat` mergeada; si no, no crear la pantalla |
| Dev | Pantalla oculta: cambiar `API_BASE_URL`, rol demo, limpiar cache, ver logs | Solo dev | Invisible en release |

Excluidos de GTM además: Storybook móvil, Swagger, MFA, registro, recuperación de contraseña (la web tampoco), notificaciones push, modo kiosco.

---

## 6. Sistema de diseño móvil

- `packages/core` no tiene UI. `mobile/src/theme/tokens.ts` transcribe `docs/design-tokens.md` (colores light/dark, radios, espaciados, tipografía) y alimenta `tailwind.config.js` de NativeWind. Nada de colores literales en pantallas.
- Componentes `mobile/src/ui/` con las mismas props semánticas que sus pares web cuando aplique (`variant`, `size`, `isLoading`, `emptyState`). `DataTable` no existe en móvil: se usa `ListCard` + `InfiniteList` (FlashList + `useInfiniteQuery` sobre `PaginatedList`).
- `MoneyPair`: REF principal, Bs secundario, `tabular-nums`; misma jerarquía que la web.
- Área táctil mínima 44×44; `accessibilityLabel` en todo `Pressable`; soporte de tamaño de fuente del sistema; safe areas; teclado no tapa inputs (`KeyboardAvoidingView`/`react-native-keyboard-controller`).
- Estados obligatorios por pantalla: cargando (skeleton), vacío, error con reintentar, sin conexión (cache + banner), 403.
- Feedback: toasts para éxito/error, haptics en acciones de POS, confirmaciones destructivas en sheet con botón rojo.
- Tema: claro/oscuro/sistema, persistido.

---

## 7. Fases

Cada fase cierra con: tests de la fase en verde, `npm run typecheck && npm run lint` en `mobile/` y `packages/core`, suite web intacta, verificación en emulador de lo construido (captura), commit, línea en `mobile/.notes/progress.md`. Fases marcadas ⇉ se paralelizan con subagentes Coder por módulo.

**Hito GTM mínimo (obligatorio, al cerrar la Fase 4).** Es lo que una bodega necesita para vender desde el teléfono: login, tabs por rol, catálogo en lectura, inventario en lectura, POS completo, Mi caja, lista/detalle de ventas con recibo. Al cerrarlo: ciclo 9 reducido (9.1 + flujos 00–25 + 30 en debug), `git push`, y **reporte de hito** al humano (≤ 15 líneas: qué funciona, capturas, qué falta). Si la corrida se corta después, lo pusheado es usable. El orden de las fases 5–8 es por valor: ventas/pagos/compras → catálogo completo → baúl/config → reportes PDF → platform → asistente/offline.

### Fase 0 — Entorno y emulador

1. Detecta SO y shell. En Windows usa PowerShell para lo nativo; en WSL/bash lo demás. Anota en `mobile/.notes/env.md`.
2. Node ≥ 20. JDK: acepta **17 a 21** (`java -version`; en esta máquina hay JDK 21, que Gradle 8.x/RN 0.86 soportan); fija `JAVA_HOME` en `mobile/android/gradle.properties` local o en el script. Instala Temurin 17 (`winget`/`choco`/`apt`) **solo** si no hay ninguno o Gradle falla por versión. Android SDK: busca `ANDROID_HOME`, `%LOCALAPPDATA%\Android\Sdk`, `~/Android/Sdk`. **Reutiliza lo que haya**: en esta máquina existen `platforms` 34/35/36, `system-images` 33/34 y el AVD `Pixel_7_Pro_API_33`. Descarga solo lo que falte para compilar (`build-tools` que pida Expo) y, si no hay ninguna imagen de sistema, `system-images;android-35;google_apis;x86_64`. Acepta licencias.
3. `mobile/scripts/emulator.*`: usa el primer AVD existente con API ≥ 30 (la app debe correr en él: `minSdk` lo fija Expo); si no hay ninguno, crea `bodega` (Pixel 7, imagen disponible más reciente). Arranque `-no-snapshot -no-audio -no-boot-anim`, `-no-window` permitido; `adb wait-for-device` + espera a `sys.boot_completed`. Verifica `adb devices`. Si no hay virtualización: intenta imagen `x86` / `arm64-v8a` según CPU; si tampoco, busca dispositivo USB; si nada, pregunta 1.6 y continúa.
4. Runner E2E. Escribe primero `mobile/e2e/run-adb.*` (9.2), que no depende de nada externo, y valida con un flujo trivial (abrir la app de ajustes del emulador y capturar). Después, solo si `wsl -l` muestra una distro (o el SO es macOS/Linux), instala Maestro con el instalador oficial y verifica `maestro --version` **y** que ve el emulador (`maestro test` de ese flujo trivial). Un intento; si falla, Maestro queda como opcional documentado y el runner `adb` es el oficial de esta corrida.
5. Arranca el BFF: `API_DATA_SOURCE=mock ALLOW_DEMO_AUTH=true npm run dev` en segundo plano (o supabase si hay credenciales) y confirma `GET http://localhost:3000/api/auth/me` con `x-demo-role: admin`.
6. Commit: `Add mobile emulator and environment scripts`.

### Fase 1 — Monorepo, `@bodega/core` y Bearer en el BFF

1. `workspaces` en raíz. `packages/core` con `tsconfig` estricto, `jest`, `exports` por subpath.
2. Mueve a `core` el código puro listado en 4.1 **copiando** primero, luego convirtiendo el original web en shim `export * from "@bodega/core/<x>"`. Los tests originales siguen donde están y deben pasar. Tipos de `src/modules/*/types.ts`: mueve solo los que son puros (sin imports de React/Next); los demás se re-exportan desde `core` copiando su forma.
3. Bearer: modifica `route-client.ts` (y `server-client.ts` si `getAuthProfileFromSession` lo usa) **y** `profile.server.ts` (`getUser(token)`) según la decisión 3. Tests: `route-client.test.ts` (con y sin header), `profile.server.test.ts` (con Bearer, `getUser` recibe el token y `getUser()` a secas no se llama) y un test de ruta existente ejecutado con `Authorization` en vez de cookie. Si hay credenciales de Supabase, prueba manual: `curl -H "Authorization: Bearer <token de signInWithPassword>" localhost:3000/api/auth/me` devuelve el perfil; anota el resultado en `progress.md`. Documenta en `docs/backend-api-agent-guide.md` §Auth.
4. `npm run typecheck && npm run lint && npm test && npm run build` en raíz. Verde o plan B 4.2.
5. Commits: `Add packages/core workspace`, `Re-export shared pure code from @bodega/core`, `Accept Bearer tokens in BFF Supabase clients`.

### Fase 2 — App base

1. `npx create-expo-app mobile` (plantilla TypeScript con Expo Router) o equivalente en la versión instalada. Configura NativeWind, TanStack Query, MSW para tests, Jest RNTL, ESLint alineado con la raíz, `tsconfig` con paths `@/` → `mobile/src` y `@bodega/core`.
2. `app.config.ts`: nombre, `applicationId`, `scheme bodegahub`, permisos (cámara), `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`, `EXPO_PUBLIC_ALLOW_DEMO_AUTH`. `.env.example`.
3. Iconos y splash: genera `icon.png` (1024²), `adaptive-icon.png`, `splash.png` con un ícono simple de bodega en el color primario de los tokens (script SVG→PNG con `sharp`). Nada de placeholders de Expo en release.
4. `src/api/apiClient.ts`: `fetch` con base URL, `Authorization: Bearer`, headers demo si dev, parseo de `ApiErrorPayload` igual que `apiFetch.ts`, 401 → `signOut` + navegación a login, timeout 20 s, reintento 1× en errores de red **solo para GET** (nunca POST/PATCH/DELETE).
5. `src/auth/`: `session.ts` (supabase-js con adaptador de almacenamiento cifrado de §3, `autoRefreshToken`, `persistSession`, `detectSessionInUrl: false`, `startAutoRefresh`/`stopAutoRefresh` según `AppState`), `useAuth` (`/api/auth/me` cacheado, `permissions`, `storeId`, `role`, `isActive`), `useCan(permission)`, `roleTabs.ts`.
6. `app/_layout.tsx`: providers + splash hasta restaurar sesión → redirige a `(auth)/login`, `(store)` o `(platform)`.
7. Login: email/password, error en español, loading, "recordar" implícito por SecureStore. Modo dev: 5 toques en el logo abren `dev/` para elegir rol demo.
8. `(store)/_layout.tsx` y `(platform)/_layout.tsx`: tabs según `roleTabs` + permisos; `ScreenHeader` con tasa del día (`/api/exchange-rates/current`) y `OfflineBanner`.
9. `src/ui/*`: todos los componentes de la sección 6 con stories mínimas en tests (render por variante) — sin Storybook.
10. `src/offline/`: persister de TanStack Query (MMKV/AsyncStorage, `maxAge` 24 h), `useNetworkStatus`, `mutationGuard` (lanza error en español si offline).
11. E2E `e2e/flows/00-login.yaml`: abre app → login demo admin → ve tabs. Captura.
12. Commits por bloque.

### Fase 3 — Catálogo ⇉ (Coder A: productos+categorías; Coder B: inventario+contactos)

Implementa según la sección 5 con los hooks/endpoints de `modules-catalog.md`. Cada pantalla: skeleton, vacío, error, 403, offline. Cámara para barcode en "agregar código" y en búsqueda de producto. Foto de producto: cámara/galería → recorte 4:3 (`expo-image-manipulator`) → `POST /image-upload-url` → PUT firmado → `HEAD` pública → `POST /image` (confirm), idéntico a la web **incluido el atajo mock**: si `uploadUrl` contiene `mock-upload.local`, se saltan el PUT y el `HEAD` (así lo hace `src/modules/products/services/uploadProductImage.ts`); sin eso el flujo 11 no puede pasar en modo mock. Tests unitarios de hooks y componentes clave. E2E: `10-products-list-search.yaml`, `11-product-create-with-photo.yaml` (foto simulada desde galería del emulador: empuja una imagen con `adb push` antes), `12-inventory-adjustment.yaml`, `13-contact-create.yaml`.

### Fase 4 — POS y caja ⇉ (Coder C: POS; Coder D: caja)

Reglas: idénticas a `src/modules/sales/sale-create` y `src/modules/cash`. Gate de caja obligatorio. Validación de stock antes de confirmar. Pagos mixtos con las validaciones de `paymentMethods.ts` (PM: banco+teléfono+referencia 4 dígitos; transferencia: banco+número). Recibo: HTML → `expo-print` → `expo-sharing`. Escáner: `expo-camera` con `barcodeScannerSettings`, debounce 800 ms por código, sonido/haptic, lookup exacto por barcode → agrega al carrito; si no existe → sheet "no encontrado" con opción de buscar. Lector físico: `TextInput` oculto que captura Enter. Contador regresivo de la sesión con `cashSessionDeadline` de `core`; al vencer, bloquea ventas y muestra el panel. Carrito persistido en MMKV en cada cambio y restaurado al abrir el POS (se limpia solo tras venta confirmada o vaciado explícito). Confirmar venta: botón deshabilitado desde el primer tap hasta la respuesta; `POST /api/sales` **no se reintenta** (el backend no tiene clave de idempotencia); ante error de red el mensaje es "No se pudo confirmar. Revisa en Ventas si la venta quedó registrada antes de reintentar." y el carrito se conserva. Tests unitarios del carrito (totales REF/Bs, descuento, IVA), del borrador persistido, del gate y del cierre. E2E: `20-cash-open.yaml`, `21-pos-sale-cash-ves.yaml`, `22-pos-sale-mixed-usd-pm.yaml`, `23-pos-scan-barcode.yaml` (inyecta el código por el input oculto), `24-cash-close.yaml`, `25-pos-blocked-without-session.yaml`.

### Fase 5 — Ventas, pagos y compras ⇉ (Coder E: ventas+pagos; Coder F: compras)

Listas con scroll infinito y filtros en sheet; detalles con acciones en sheet y confirmación destructiva; registrar pago desde detalle (venta y compra); anular/devolver con permiso; compras en 3 pasos con modo unidad/empaque y presets. E2E: `30-sales-list-detail-receipt.yaml`, `31-register-payment-from-sale.yaml`, `32-cancel-sale.yaml`, `40-purchase-create-pack-mode.yaml`, `41-purchase-receive-and-pay.yaml`.

### Fase 6 — Baúl, reportes y configuración ⇉ (Coder G: baúl+configuración; Coder H: reportes)

Baúl: 3 saldos + movimientos + 3 operaciones (admin). Reportes: selector de reporte + rango + resultado en tarjetas/tabla; gráfico simple donde la web tiene uno; "Compartir PDF" por reporte. Configuración completa según sección 5. E2E: `50-vault-deposit-withdraw.yaml`, `51-vault-transfer-closures.yaml`, `60-report-daily-close-share-pdf.yaml`, `70-settings-theme-rate-users.yaml`.

### Fase 7 — Platform (superadmin)

Dashboard multitienda con selector de alcance (una/varias/todas), tiendas lista/detalle, usuarios lista/detalle, reportes multitienda. E2E: `80-superadmin-dashboard-scope.yaml`, `81-superadmin-stores-users.yaml`.

### Fase 8 — Asistente (condicional) y offline básico

Si existe `/api/chat`: pantalla de chat con streaming (`fetch` + `ReadableStream` o SSE según lo que el SDK exponga en RN; verificar que el stream del AI SDK se puede consumir en RN — si no, usar `expo/fetch`), chips por rol, bloque "Fuente". Offline: verifica que Inicio, Productos, Ventas y Contactos muestran la última cache con el banner al desactivar red (`adb shell svc wifi disable && svc data disable`), y que POS bloquea confirmar con mensaje claro. E2E: `90-offline-read-cache.yaml`, `91-assistant-chat.yaml` (si aplica).

### Fase 9 — Rendimiento, accesibilidad y release

1. Rendimiento: arranque en frío < 3 s en el emulador **con el APK release** (mide con `adb shell am start -W`; el bundle debug no cuenta); listas con FlashList y `estimatedItemSize`; imágenes con `expo-image` y cache; sin re-renders por cambio de tasa (memo); bundle sin librerías no usadas (`npx expo-doctor`, `npx depcheck`).
2. Accesibilidad: labels, roles, orden de foco, contraste con tokens en ambos temas; tamaño de fuente del sistema a 130 % sin cortes en POS y detalle de venta (captura).
3. Seguridad: sesión solo en SecureStore; logout limpia SecureStore + cache de Query; nada sensible en logs de release; `usesCleartextTraffic` solo en debug; permisos mínimos en `AndroidManifest`.
4. Release: `expo prebuild --platform android --clean`; keystore con `keytool` en `mobile/android/keystores/release.keystore` (gitignored) y `credentials.md` (gitignored) con alias/contraseñas generadas; `gradle.properties` local para firmar; `./gradlew assembleRelease` → `mobile/android/app/build/outputs/apk/release/app-release.apk`. Instala el APK release en el emulador y corre los flujos E2E críticos (login, POS, cierre de caja) **contra el release**. `expo prebuild --platform ios` debe completar sin error de configuración (no se compila).
5. `eas.json` con perfiles y `eas.json` documentado; no ejecutes builds EAS (requieren cuenta).
6. Commits: `Optimize lists and startup`, `Add release signing and EAS config`.

### Fase 10 — Ciclo de verificación (sección 9)

### Fase 11 — Documentación y entrega

- `docs/mobile-app.md`: setup (SDK, emulador, `.env`), arquitectura, mapa de tabs, cómo correr tests y E2E, cómo generar el release, decisiones y exclusiones, diseño de la cola offline post-GTM.
- `docs/modules-catalog.md`: columna/sección "Móvil" por módulo con estado (Paridad/Adaptado/Reducido/Excluido) y pantallas.
- `docs/backend-api-agent-guide.md`: autenticación Bearer.
- `docs/README.md`: enlaces. `README.md` raíz: sección "App móvil" con 4 comandos.
- Push de la rama. Reporte final (sección 13).

---

## 8. Agentes

| Agente | Cuándo | Recibe | Devuelve (≤ 15 líneas) |
|--------|--------|--------|------------------------|
| **Orquestador** (sesión principal) | Siempre | Este documento | Coordina, decide, integra, corre el ciclo 9, escribe el reporte |
| **Arquitecto** | Fase 1–2 | Sección 3–4 + firmas del repo | Estructura creada, decisiones de versiones, notas en `mobile/.notes/` |
| **Coder A–H** | Fases 3–7 ⇉ | Una fase/módulo: sección 5 fila, endpoints de `modules-catalog.md`, componentes `ui/` disponibles | Pantallas + hooks + tests + flujo E2E del módulo + captura |
| **Tester** | Fin de cada fase y ciclo 9 | Rama | typecheck/lint/jest en `mobile`, `core`, raíz; fallos con causa raíz en 1 línea |
| **Navegante** | Fin de cada fase y ciclo 9 | Flujos E2E de la fase | Ejecuta el runner oficial de la corrida (Maestro o `run-adb`), capturas en `mobile/e2e/screenshots/<flujo>/`, pasos fallidos |
| **Caos** | Ciclo 9 | Sección 11 + emulador | Reproducido sí/no, evidencia, severidad |
| **Reparador** | Tras Tester/Navegante/Caos con fallos | Lista de fallos | Fix mínimo + test de regresión + commit |
| **Auditor** | Última vuelta del ciclo 9 | `git diff main...HEAD` + APK | Seguridad (token, secretos, permisos, cleartext), calidad (patrones, `any`, código muerto, deps), paridad con sección 5, checklist 12; hallazgos con severidad |
| **Revisor UX** | Ciclo 9 | Todas las capturas | Inconsistencias visuales, textos en inglés, estados faltantes, botones < 44 pt, contraste; lista con archivo y captura |

Reglas: los agentes no piden ayuda al humano ni entre sí; ante un bloqueo devuelven una línea y el Orquestador decide. Coders paralelos trabajan en carpetas disjuntas y no tocan `ui/` ni `api/` sin pasar por el Orquestador (que serializa esos cambios). El Orquestador nunca acepta "no se pudo probar en emulador".

---

## 9. Ciclo de calidad (hasta 2 pasadas limpias consecutivas)

**9.1 Estático.** Raíz: `npm run typecheck && npm run lint && npm test && npm run build`. `packages/core`: typecheck + jest. `mobile/`: typecheck + lint + jest con cobertura ≥ 70 % en `modules/` y `ui/`. `npx expo-doctor` sin errores.

**9.2 E2E en emulador.** Emulador arriba + BFF mock arriba + app debug instalada (`npx expo run:android`). Ejecuta **todos** los flujos `mobile/e2e/flows/*.yaml` con el runner elegido en Fase 0.4; cada flujo termina con captura. El runner `mobile/e2e/run-adb.*` interpreta el **mismo YAML** (subconjunto: `launchApp`, `tapOn` por `testID`/texto, `inputText`, `assertVisible`, `assertNotVisible`, `scroll`, `back`, `takeScreenshot`) con `adb shell input tap/text/keyevent`, localiza elementos por `uiautomator dump` + `content-desc`/`text` (los `testID` de RN salen como `resource-id` en Android; asegúrate de que el `accessibilityLabel` o el `testID` aparezca en el dump), y captura con `adb exec-out screencap -p`. Todos los flujos deben pasar en debug; los críticos (00, 20–24, 30, 31) también contra el APK release.

**9.3 Matriz de dispositivos.** Repite los flujos críticos en un segundo AVD `bodega-small` (pantalla 5", API 30, densidad baja) para verificar layouts y compatibilidad de API mínima (`minSdkVersion` que Expo fije; documenta). Tema oscuro en al menos los flujos 00, 21, 30, 60. Fuente del sistema 130 % en 21 y 30.

**9.4 Caos.** Sección 11 completa. Alta/Media bloquean.

**9.5 Auditoría + Revisor UX.** Hallazgos altos y medios se reparan; bajos al reporte.

**9.6 Reparación.** Fix mínimo + regresión + commit `Fix: <qué>`. Volver a 9.1.

Salida: 9.1–9.5 sin fallos altos/medios en dos pasadas seguidas.

---

## 10. Flujos E2E obligatorios (YAML estilo Maestro en `mobile/e2e/flows/`, ejecutados por Maestro o por `run-adb`)

Cada flujo usa `testID`s estables (`login-email`, `pos-search`, `pos-cart-button`, `cart-confirm`, `payment-method-<x>`, `cash-open-submit`, etc.) definidos en un único `mobile/src/testIds.ts`. Lista mínima (los nombres son los de las fases): `00-login`, `01-logout-and-session-restore`, `02-role-tabs-vendedor`, `03-role-tabs-superadmin`, `10–13` catálogo, `20–25` caja/POS, `30–32` ventas/pagos, `40–41` compras, `50–51` baúl, `60` reportes+PDF, `70` configuración, `80–81` platform, `90` offline, `91` asistente (condicional), `99-release-smoke` (login → venta → cierre en APK release).

Cada flujo: precondiciones (rol demo, datos mock), pasos, aserciones visibles (`assertVisible` con textos en español exactos), captura final. Los flujos deben ser deterministas: no existe endpoint de reset en el BFF, así que el runner reinicia el proceso `next dev` (mock en memoria) antes de cada corrida completa y espera a que `GET /api/auth/me` responda. Si el reinicio supera 30 s por flujo y estorba, añade `POST /api/dev/reset-mock` protegido por `ALLOW_DEMO_AUTH=true` y `API_DATA_SOURCE=mock` (404 en cualquier otro caso), con test.

---

## 11. Casos de caos

| # | Caso | Esperado | Severidad |
|---|------|----------|-----------|
| 11.1 | Token expirado a mitad de sesión (forzar `access_token` inválido) | Refresh silencioso; si el refresh falla → login sin crash y sin perder el carrito guardado en borrador local | Alta |
| 11.2 | BFF devuelve 500 en una lista | `ErrorState` con reintentar; sin pantalla en blanco | Alta |
| 11.3 | Red cae durante confirmación de venta | Error claro con el texto de Fase 4; el carrito se conserva; la app **no reenvía sola** (el backend no tiene idempotencia); al reintentar manualmente tras una venta que sí se registró, el vendedor la ve en Ventas. Post-GTM: `clientRequestId` en `POST /api/sales` (parche SQL) | Alta |
| 11.4 | Doble tap en "Confirmar venta" / "Cerrar caja" / "Registrar pago" | Una sola operación | Alta |
| 11.5 | Vendedor intenta URL/deeplink de pantalla admin (`bodegahub://vault`) | 403 en pantalla, sin crash | Alta |
| 11.6 | Respuesta con campos nulos/faltantes (mock alterado) | Render defensivo, sin `undefined is not an object` | Alta |
| 11.7 | Escáner recibe 20 códigos en 2 s | Debounce; no se agregan duplicados por rebote; cantidad correcta | Media |
| 11.8 | Carrito con 100 líneas y producto con 10.000 unidades | Totales correctos con `roundMoney`; UI fluida | Media |
| 11.9 | Sesión de caja vence mientras el checkout está abierto | Bloquea confirmar y muestra panel; el carrito no se pierde | Alta |
| 11.10 | Rotación de pantalla en POS y en formulario de compra | Estado conservado (o rotación bloqueada a portrait, documentado) | Media |
| 11.11 | App en background 30 min y vuelve | Restaura sesión, refresca datos, contador de caja correcto | Media |
| 11.12 | Sin permiso de cámara | Escáner muestra explicación y botón a ajustes; POS sigue usable | Media |
| 11.13 | Imagen de 12 MP desde galería | Se recorta/comprime antes de subir (< 1 MB); sin OOM | Media |
| 11.14 | Tasa del día no disponible (endpoint 502) | POS muestra REF y avisa que no hay Bs; no bloquea si el backend lo permite, o explica el bloqueo | Media |
| 11.15 | Fuente del sistema 200 % | Sin textos cortados en login, POS, cierre de caja | Baja |
| 11.16 | Memoria: navegar 50 pantallas ida y vuelta | Sin crecimiento sostenido (revisa con `adb shell dumpsys meminfo`) | Baja |
| 11.17 | APK release en AVD API 30 | Instala y corre `99-release-smoke` | Alta |

---

## 12. Definición de hecho (GTM)

Marca cada punto solo con evidencia (comando, archivo, captura).

- [ ] Raíz: `typecheck`, `lint`, `test`, `build` en verde; web sin regresiones; Bearer con tests (incluido `getUser(token)`), y verificado contra Supabase real si hubo credenciales (si no, dicho explícitamente en el reporte).
- [ ] Hito GTM mínimo cerrado, pusheado y reportado antes de las fases 5–8.
- [ ] `mobile/.notes/progress.md` versionado y al día.
- [ ] `packages/core` con tests; web y móvil lo consumen; sin duplicación de lógica de negocio.
- [ ] `mobile/`: typecheck, lint, jest ≥ 70 % en `modules/` y `ui/`, `expo-doctor` limpio.
- [ ] Todos los módulos de la sección 5 en estado Paridad/Adaptado/Reducido implementados; exclusiones documentadas.
- [ ] Tabs por rol correctos para los 5 roles (capturas).
- [ ] POS completo: gate de caja, escáner de cámara y lector físico, pagos mixtos con validaciones, recibo PDF compartible.
- [ ] Todos los flujos E2E de la sección 10 pasan en debug con el runner oficial de la corrida (Maestro o `run-adb`); críticos pasan en release y en `bodega-small`; oscuro y fuente 130 % verificados.
- [ ] Sección 11 sin fallos altos/medios.
- [ ] Auditoría y Revisor UX sin hallazgos altos/medios.
- [ ] Offline básico verificado (cache + banner + bloqueo de mutaciones).
- [ ] APK release firmado generado, instalado y probado; `eas.json` y `prebuild ios` sin errores.
- [ ] Iconos/splash propios; nombre y `applicationId` correctos; sin cleartext en release.
- [ ] Docs: `docs/mobile-app.md`, `modules-catalog.md`, `backend-api-agent-guide.md`, `README.md`, `.env.example`.
- [ ] Rama `feat/mobile-app` pusheada, sin merge, sin secretos.

---

## 13. Reporte final (única salida al humano, ≤ 50 líneas)

```text
BODEGAHUB MOBILE — LISTO PARA REVISIÓN
Rama: feat/mobile-app (N commits) · Expo SDK X · RN Y · minSdk Z
APK release: mobile/android/app/build/outputs/apk/release/app-release.apk (M MB)
Tests: core A/A · mobile B/B (cobertura C %) · web intacta
E2E (runner: maestro|adb): K/K flujos debug · críticos en release ✓ · bodega-small ✓ · oscuro ✓ · fuente 130 % ✓
Auth real (Supabase): verificada ✓ | no verificada (sin credenciales)
Caos: N/17 · Auditoría: 0 altos, 0 medios, P bajos · UX: Q bajos
Módulos: Paridad [..] · Adaptado [..] · Reducido [..] · Excluido [..]

Para desplegar:
1. Backend: mergear el cambio Bearer (ya en la rama) y desplegar en Vercel.
2. Mobile: EXPO_PUBLIC_API_BASE_URL=https://bodega-hub.vercel.app + Supabase URL/anon en mobile/.env; regenerar APK o usar EAS (eas.json listo).
3. Keystore en mobile/android/keystores/ (no versionado): guardarlo fuera del equipo.

Decisiones tomadas sin consultar: (≤ 6 líneas)
Exclusiones y post-GTM: (≤ 6 líneas)
Hallazgos bajos pendientes: (≤ 8 líneas)
No verificado y por qué: (≤ 3 líneas)
```
