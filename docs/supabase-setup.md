# Supabase setup — BodegaHub

Guia minima para levantar la base de datos de desarrollo y probar auth real contra `/api/auth/*`.

## 1. Crear proyecto Supabase

1. Crea un proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2. Copia `.env.local.example` a `.env.local` y completa:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (solo servidor, nunca en el cliente)
3. Opcional en dev local:
   - `API_DATA_SOURCE=supabase`
   - `ALLOW_DEMO_AUTH=true` (habilita `x-demo-role` en tests y dev)

## 2. Aplicar schema

En **SQL Editor** del dashboard, ejecuta el contenido completo de:

```text
supabase/supabase-schema.sql
```

No hay carpeta `supabase/migrations`; el schema es un archivo monolítico. Ver [`database-design.md`](database-design.md) y [`modules-catalog.md`](modules-catalog.md).

Verifica que existan tablas `profiles`, `app_settings`, RPC (`create_sale`, etc.) y politicas RLS.

## 2.1 Aplicar patches pendientes (obligatorio si el proyecto ya tenia schema)

Si el proyecto **ya** ejecuto `supabase-schema.sql` antes y luego el codigo agrego features, aplica los patches incrementales.

**Forma recomendada (todo junto):**

1. Abre [Supabase Dashboard](https://supabase.com/dashboard) → tu proyecto → **SQL Editor**.
2. Pega el contenido de [`supabase/patches/apply-all-pending.sql`](../supabase/patches/apply-all-pending.sql).
3. **Run**.
4. Pega [`supabase/patches/verify-patches.sql`](../supabase/patches/verify-patches.sql) y confirma que todas las filas tienen `ok = true`.

Orden individual (si prefieres uno por uno):

| Orden | Archivo | Que agrega |
|-------|---------|------------|
| 1 | `20260705-supplier-product-pack-cost.sql` | `last_pack_cost_ref` + RPC precio empaque |
| 2 | `20260706-product-barcode.sql` | `products.barcode` + indice unico |
| 3 | `20260707-product-images-storage.sql` | bucket `product-images` + policy lectura |
| 4a | `20260716a-user-role-superadmin.sql` | Enum `user_role.superadmin` (**corrida aparte**) |
| 4b | `20260716-multi-store.sql` | `stores`, `store_id`, RLS por tienda |
| 4c | `20260716b-multi-store-views.sql` | Vistas con `store_id` (dashboard/reportes) |
| 4d | `20260716c-seed-superadmin.sql` | Usuario `superadmin@example.com` (admin/vendedor intactos) |

**Importante:** el patch 4b/4c **no** están embebidos en `apply-all-pending.sql`. Ejecuta **4a → 4b → 4c** en Runs separados del SQL Editor (PostgreSQL no permite usar un enum nuevo en la misma transacción donde se agregó).

Los patches son **idempotentes** (se pueden re-ejecutar). Requieren que el schema base y RPCs auxiliares (`append_supplier_product_price_history`, `current_user_role`) ya existan.

Si tu URL `NEXT_PUBLIC_SUPABASE_URL` no resuelve o el proyecto esta paused/deleted, reactivalo o actualiza `.env` antes de seguir.

### 2.2 Smoke test post-patches

Con la app en `npm run dev` y patches aplicados:

```bash
npm run smoke:patches
```

Cubre por API: login, create/lookup barcode, signed upload URL de imagen, reactivar producto/categoría, listado supplier-products (campo pack). Resultado en `scripts/smoke-post-patches-last-run.json` (gitignored).

**Checklist UI manual** (el script no cubre crop/canvas):

1. **Barcode** — Productos → crear/editar con código de barras → en POS o compras, escanear/Enter y que agregue al carrito.
2. **Imagen** — Formulario producto → subir imagen → crop 4:3 → opcional “quitar fondo” → guardar y ver preview en detalle.
3. **Empaque / pack cost** — Contacto proveedor → producto proveedor → registrar precio de empaque (o compra con pack) y confirmar que aparece en UI.

## 3. Ejecutar seed

Ejecuta en el mismo SQL Editor:

```text
supabase/seed.sql
```

Esto crea usuarios Auth, filas en `profiles`, `app_settings`, una categoria y una tasa de cambio con UUID fijos.

**Password de todos los usuarios seed:** `Admin123!`

Referencia completa (credenciales, roles y permisos): [`dev-seed-users.md`](dev-seed-users.md).

| Rol       | Email                  | UUID                                   |
| --------- | ---------------------- | -------------------------------------- |
| admin     | admin@example.com      | `11111111-1111-4111-8111-111111111111` |
| vendedor  | vendedor@example.com   | `22222222-2222-4222-8222-222222222222` |
| vendedor + contactos | vendedor.contactos@example.com | `55555555-5555-4555-8555-555555555555` |
| almacen   | almacen@example.com    | `33333333-3333-4333-8333-333333333333` |
| contador  | contador@example.com   | `44444444-4444-4444-8444-444444444444` |

## 4. Probar auth real

Con la app en dev (`npm run dev`):

```bash
# Login (cookies se guardan en el cliente)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}' \
  -c cookies.txt

# Perfil autenticado
curl http://localhost:3000/api/auth/me -b cookies.txt

# Logout
curl -X POST http://localhost:3000/api/auth/logout -b cookies.txt
```

Respuesta esperada de `/api/auth/me`: `{ data: { user, role, permissions, grantedPermissions, deniedPermissions, ... } }`.

## 5. Tests unitarios

Los tests Jest usan por defecto:

- `API_DATA_SOURCE=mock` (via `NODE_ENV=test`)
- `ALLOW_DEMO_AUTH=true` para headers `x-demo-role` / `x-demo-user-id`

No necesitas Supabase corriendo para `npm test` salvo pruebas de integracion manuales.

## 6. Vaciar datos (conservar usuarios y categorías)

Para borrar productos, contactos, ventas, compras y demás datos operativos **sin tocar usuarios** (`auth.users`, `profiles`) **ni categorías**, ejecuta en el SQL Editor:

```text
supabase/reset-data.sql
```

Opcional: ejecutar de nuevo la parte de `app_settings` y tasa BCV en `supabase/seed.sql` (los usuarios usan `on conflict do nothing`).

## 7. Catálogo de investigación de campo (jul/2026)

Proveedores, productos y vínculos con precios de cotización anotados en campo:

```text
supabase/seed-field-research-jul2026.sql
```

Incluye **Bodega de bebida** (6 bebidas) y **Tienda Congolos** (6 chucherías), categorías `Bebidas` / `Chucherias`, SKU derivados del nombre (ej. `glup-2lt`), empaques predeterminados (caja 6 / paquete 12) y costo unitario calculado del precio por empaque.

Alternativa vía API (con `npm run dev` y `.env.local`):

```bash
npx tsx scripts/seed-field-research/run.ts
```

## 8. Produccion

- `API_DATA_SOURCE=supabase`
- `ALLOW_DEMO_AUTH=false` (obligatorio)
- No commitear `.env` ni claves reales.
