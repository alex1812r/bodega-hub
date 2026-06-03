# Supabase setup — Control Ventas ERP

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

## 6. Produccion

- `API_DATA_SOURCE=supabase`
- `ALLOW_DEMO_AUTH=false` (obligatorio)
- No commitear `.env` ni claves reales.
