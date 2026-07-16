# Usuarios de desarrollo (seed)

Credenciales y roles de los usuarios creados por [`supabase/seed.sql`](../supabase/seed.sql) y el patch [`20260716c-seed-superadmin.sql`](../supabase/patches/20260716c-seed-superadmin.sql). Solo para entornos **dev/staging**. No usar estas contraseñas en producción.

Matriz de permisos por rol: [`auth-permissions.md`](auth-permissions.md). Multitienda: [`multi-store-options.md`](multi-store-options.md).

## Requisito

Los usuarios existen en Supabase **solo después** de ejecutar el seed (o el patch `20260716c` en un proyecto ya migrado). Ver [`supabase-setup.md`](supabase-setup.md).

## Contraseña compartida

| Campo | Valor |
|-------|-------|
| Password (todos) | `Admin123!` |

## Usuarios

| Nombre | Email | Rol | Ámbito | UUID | Activo |
|--------|-------|-----|--------|------|--------|
| Superadmin Demo | `superadmin@example.com` | `superadmin` | Plataforma (`store_id` null) | `66666666-6666-4666-8666-666666666666` | Sí |
| Admin Demo | `admin@example.com` | `admin` | Tienda default | `11111111-1111-4111-8111-111111111111` | Sí |
| Vendedor Demo | `vendedor@example.com` | `vendedor` | Tienda default | `22222222-2222-4222-8222-222222222222` | Sí |
| Vendedor Contactos Demo | `vendedor.contactos@example.com` | `vendedor` | Tienda default | `55555555-5555-4555-8555-555555555555` | Sí |
| Almacen Demo | `almacen@example.com` | `almacen` | Tienda default | `33333333-3333-4333-8333-333333333333` | Sí |
| Contador Demo | `contador@example.com` | `contador` | Tienda default | `44444444-4444-4444-8444-444444444444` | Sí |

Tienda default: `00000000-0000-4000-8000-000000000001` (`slug = default`).

## Estado tras multitienda

| Usuario | Qué hacer |
|---------|-----------|
| `admin@example.com` / `vendedor@…` | **Se quedan** como usuarios de la tienda existente. No los conviertas en superadmin. |
| `superadmin@example.com` | Usuario **nuevo** solo para `/platform/*` (dashboard, tiendas, usuarios, reportes). |

Si el proyecto ya tenía seed antes del multitienda, ejecuta en SQL Editor:

```text
supabase/patches/20260716c-seed-superadmin.sql
```

Eso crea el superadmin y reafirma que admin/vendedor siguen en la tienda default.

## Qué puede hacer cada rol

### `superadmin` — Plataforma

- Solo backoffice: listar/crear/pausar tiendas y asignar admin inicial.
- **No** opera el ERP (productos, ventas, etc.).

### `admin` — Administrador de tienda

- Acceso total al ERP de **su** tienda.
- Configuración y gestión de usuarios de la tienda.

### `vendedor` — Vendedor

- Dashboard, ventas (ver y crear), productos (solo ver), contactos (solo ver), pagos (solo ver).

**Usuario híbrido:** `vendedor.contactos@example.com` tiene además `contacts.manage`.

### `almacen` — Almacén

- Compras, inventario y productos (gestión).

### `contador` — Contador

- Pagos, reportes y lectura contable.

## Overrides por usuario (seed)

| Email | `granted_permissions` | `denied_permissions` |
|-------|----------------------|----------------------|
| `superadmin@example.com` | — | — |
| `admin@example.com` | — | — |
| `vendedor@example.com` | — | — |
| `vendedor.contactos@example.com` | `contacts.manage` | — |
| `almacen@example.com` | — | — |
| `contador@example.com` | — | — |

## Login de prueba

```bash
# Plataforma
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@example.com","password":"Admin123!"}' \
  -c cookies-sa.txt

# Tienda (ERP)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}' \
  -c cookies-admin.txt
```

## Seguridad

- Cambiar o eliminar estos usuarios antes de exponer el proyecto.
- En producción: `ALLOW_DEMO_AUTH=false` y no reutilizar estas contraseñas.
