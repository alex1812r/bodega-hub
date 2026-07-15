# Usuarios de desarrollo (seed)

Credenciales y roles de los usuarios creados por `[supabase/seed.sql](../supabase/seed.sql)`. Solo para entornos **dev/staging**. No usar estas contraseñas en producción.

Matriz de permisos por rol: `[auth-permissions.md](auth-permissions.md)`. Índice de docs: `[README.md](README.md)`.

## Requisito

Los usuarios existen en Supabase **solo después** de ejecutar el seed. Ver `[supabase-setup.md](supabase-setup.md)`.

## Contraseña compartida


| Campo            | Valor       |
| ---------------- | ----------- |
| Password (todos) | `Admin123!` |


## Usuarios


| Nombre                  | Email                            | Rol        | Etiqueta UI   | UUID                                   | Activo |
| ----------------------- | -------------------------------- | ---------- | ------------- | -------------------------------------- | ------ |
| Admin Demo              | `admin@example.com`              | `admin`    | Administrador | `11111111-1111-4111-8111-111111111111` | Sí     |
| Vendedor Demo           | `vendedor@example.com`           | `vendedor` | Vendedor      | `22222222-2222-4222-8222-222222222222` | Sí     |
| Vendedor Contactos Demo | `vendedor.contactos@example.com` | `vendedor` | Vendedor      | `55555555-5555-4555-8555-555555555555` | Sí     |
| Almacen Demo            | `almacen@example.com`            | `almacen`  | Almacen       | `33333333-3333-4333-8333-333333333333` | Sí     |
| Contador Demo           | `contador@example.com`           | `contador` | Contador      | `44444444-4444-4444-8444-444444444444` | Sí     |


## Qué puede hacer cada rol

Resumen funcional. La matriz completa de permisos está en `[auth-permissions.md](auth-permissions.md)` y en `src/shared/auth/permissions.ts`.

### `admin` — Administrador

- Acceso total al ERP.
- Configuración (`settings.view`), gestión de usuarios (`users.manage`) y todos los módulos operativos.

### `vendedor` — Vendedor

- Dashboard, ventas (ver y crear), productos (solo ver), contactos (solo ver), pagos (solo ver).
- No compras, inventario, reportes ni configuración.
- Sin crear/editar contactos ni registrar pagos (solo lectura en esos módulos).

**Usuario híbrido de prueba:** `vendedor.contactos@example.com` tiene el rol `vendedor` más `contacts.manage` concedido (puede crear/editar contactos).

### `almacen` — Almacén

- Dashboard, compras (ver y crear), inventario (ver y gestionar), productos (ver y gestionar).
- No ventas, pagos, reportes ni configuración.

### `contador` — Contador

- Dashboard, ventas y compras (solo ver), contactos (ver), pagos (ver y gestionar), reportes.
- No crear ventas/compras, inventario ni configuración.

## Overrides por usuario (seed)


| Email                            | `granted_permissions` | `denied_permissions` |
| -------------------------------- | --------------------- | -------------------- |
| `admin@example.com`              | —                     | —                    |
| `vendedor@example.com`           | —                     | —                    |
| `vendedor.contactos@example.com` | `contacts.manage`     | —                    |
| `almacen@example.com`            | —                     | —                    |
| `contador@example.com`           | —                     | —                    |


Fórmula de permisos efectivos:

```text
permisos efectivos = permisos del rol + granted - denied
```

## Login de prueba

Con la app en dev (`npm run dev`) y `API_DATA_SOURCE=supabase`:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin123!"}' \
  -c cookies.txt

curl http://localhost:3000/api/auth/me -b cookies.txt
```

También puedes usar `scripts/smoke-api.ts` con `SMOKE_API_EMAIL` y `SMOKE_API_PASSWORD` (ver `[backend-api-agent-guide.md](backend-api-agent-guide.md)`).

## Otros datos del seed

Además de usuarios, el seed crea:


| Recurso          | Detalle                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `app_settings`   | Negocio "Control Ventas ERP", IVA 16%, prefijo `FAC`, stock bajo 5 |
| `categories`     | Categoría "General" (`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)       |
| `exchange_rates` | Tasa 45.5 VES, fuente BCV                                          |


No incluye productos, contactos, ventas ni compras.

## Seguridad

- Cambiar o eliminar estos usuarios antes de exponer el proyecto.
- En producción: `ALLOW_DEMO_AUTH=false` y no commitear contraseñas reales.
- Este archivo documenta credenciales de demo a propósito; no reutilizar el mismo password en entornos reales.

