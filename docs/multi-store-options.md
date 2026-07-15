# Opciones: múltiples tiendas / negocios

Documento de exploración (julio 2026). **No es un plan de implementación.** Define caminos posibles para que un mismo dueño administre varios negocios desde esta app.

## Contexto y restricciones

| Premisa | Decisión |
|---------|----------|
| Uso | Proyecto personal: varios negocios bajo el mismo dueño |
| Membresías usuario↔tienda | **Fuera de alcance** por ahora |
| Roles tipo “admin por tienda + equipo” | No requerido ahora |
| Superadmin / selector de negocio | Sí: la persona dueña debe poder entrar a cada negocio y administrarlo |
| Estado actual del ERP | Single-tenant: un conjunto de datos global, roles `admin` / `vendedor` / `almacen` / `contador` |

Hoy no existe `store_id` / `business_id`. Productos, contactos, ventas, compras, pagos, inventario, tasas y settings son compartidos en una sola “instancia lógica”.

---

## Qué problema se quiere resolver

Poder:

1. Tener **varios negocios** (ej. bodegón A, ferretería B, snack C).
2. **Aislar** catálogo, stock, clientes, caja y reportes por negocio (recomendado para negocios no emparentados).
3. Como dueño, **cambiar de negocio** y ver solo datos de ese contexto.
4. Opcionalmente, una vista “todos mis negocios” (dashboard agregado o listado).

Sin:

- Invitaciones de usuarios por tienda.
- Un vendedor que trabaja en dos locales con login único.
- Facturación SaaS multi-cliente (otros dueños pagando suscripción).

---

## Comparativa rápida de enfoques

| # | Enfoque | Aislamiento | Complejidad | Encaje personal multi-negocio |
|---|---------|-------------|-------------|-------------------------------|
| A | Shared DB + `business_id` | Lógico (filas) | Media–alta | **Recomendado** |
| B | Schema Postgres por negocio | Fuerte | Alta | Solo si hay requisitos legales extremos |
| C | Proyecto Supabase por negocio | Muy fuerte | Muy alta (ops) | No conviene para un solo dueño |
| D | “Copia” de deploy / `.env` por negocio | Fuerte | Baja en código, alta en operación | Útil solo temporalmente |
| E | Soft multi-negocio (prefijos / tags) | Débil | Baja | **No recomendado** (fuga de datos fácil) |

---

## Opción A — Shared DB + `business_id` (recomendada)

Una sola base Supabase. Una tabla `businesses` (o `stores`). Casi todas las tablas de negocio llevan `business_id`.

### Modelo mental

```text
auth.users (vos)
    └── profiles (rol global: admin / superadmin)
            └── session: business_id activo (cookie / claim / header)

businesses
    ├── products, categories, contacts, ...
    ├── sales, purchases, payments, inventory_movements
    └── exchange_rates / app_settings (por negocio o con defaults)
```

### Roles (sin membresías)

Para tu caso personal bastan:

| Rol | Comportamiento |
|-----|----------------|
| `superadmin` o `owner` | Lista todos los negocios; puede crear/activar negocios; elige cuál está activo |
| `admin` (opcional) | Si más adelante hay ayuda, queda scoped; **ahora** el dueño puede ser siempre owner |

Sin tabla `store_memberships`: el dueño ve todos los `businesses` porque es owner de la plataforma (o because `businesses.owner_user_id = auth.uid()`).

### Ventajas

- Un solo deploy, un solo login.
- Superadmin / vista cruzada natural (sumar ventas de todos los negocios).
- Migración desde el schema actual: crear un negocio “default”, backfill `business_id`, luego permitir el segundo.
- Storage: `product-images/{businessId}/{productId}/cover.webp`.

### Desventajas

- Migración amplia: índices únicos pasan a `(business_id, sku)`, RLS y RPC deben filtrar.
- Bug de filtrado = riesgo de mezclar datos entre negocios (mitigado con RLS).

### Decisiones de producto dentro de A

| Tema | Variante A1 (aislamiento total) | Variante A2 (compartir selectivo) |
|------|----------------------------------|-----------------------------------|
| Productos / categorías | Por negocio | Catálogo maestro compartido + stock por negocio |
| Contactos | Por negocio | Contactos compartidos |
| Tasa REF | Por negocio | Una tasa global |
| Settings | Por negocio | Globales + overrides |

Para negocios **distintos** (bodegón vs ferretería), **A1** es la más segura y simple de razonar.

### UI mínima

1. Tras login: si hay 1 negocio → entrar directo; si hay N → selector.
2. Shell: chip “Negocio actual” + cambiar.
3. Settings: alta de negocio (nombre, slug, activo).
4. Todas las queries API reciben el negocio activo (cookie o header validado).

---

## Opción B — Schema Postgres por negocio

`business_bodegon`, `business_ferreteria`, mismas tablas en cada schema.

| Pros | Contras |
|------|---------|
| Aislamiento fuerte a nivel SQL | Contener RPCs, migraciones y RLS N veces |
| Menos riesgo de leak por query olvidada | Superadmin cross-negocio muy torpe |
| | Supabase Auth/RLS y tooling son más dolorosos |

**Cuándo:** compliance o auditoría que exija separación física de datos. **No** el camino natural de un proyecto personal.

---

## Opción C — Proyecto / instancia Supabase por negocio

Cada negocio = URL, anon key, service role distintos.

| Pros | Contras |
|------|---------|
| Aislamiento máximo | Cambiar de negocio = cambiar entorno o app |
| Fallo de un proyecto no tumba otros | N seeds, N patches, N backups |
| | “Ver todos mis negocios” requiere un meta-panel aparte |

**Cuándo:** negocios operados casi como productos separados. Para un solo dueño en una sola app, overhead alto.

---

## Opción D — Varias apps / env por negocio (workaround)

Misma codebase, varios deploys o varios `.env` apuntando a DBs distintas.

| Pros | Contras |
|------|---------|
| Casi cero cambio de schema actual | No hay selector en la misma sesión |
| Útil para probar “dos bodegones” ya | Duplicás usuarios, auth y mantenimiento |

Puede servir como **puente temporal** mientras no se migra a A.

---

## Opción E — Tags / prefijos sin `business_id` (evitar)

Ej. SKU prefijado `BOD-` / `FER-` y filtros de UI.

| Riesgo |
|--------|
| Un listado sin filtro mezcla inventario |
| FK y reportes no garantizan aislamiento |
| Deuda técnica que luego cuesta más que A |

---

## Recomendación para este repo

**Ir a la Opción A (shared DB + `business_id`), variante A1: aislamiento total por negocio, sin membresías.**

Motivos alineados a tu uso:

1. Un login, muchos negocios.
2. Catálogos e inventarios independientes (negocios no relacionados).
3. Dueño = quien crea y selecciona negocios (`owner_user_id` o rol platform).
4. Misma stack actual (BFF Next + Supabase + RLS), evolucionando lo que ya existe.
5. Deja abierta fase 2 (membresías / roles por tienda) sin rehacer el modelo.

### Esqueleto de datos (borrador conceptual)

```sql
-- Conceptual; no ejecutar aún
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- En products, contacts, sales, ...:
-- business_id uuid not null references public.businesses(id)
-- unique (business_id, sku)
```

Sesión activa: cookie `business_id` o claim tras `POST /api/businesses/select`.

### Qué habría que tocar (cuando se implemente)

1. Patch SQL: `businesses` + `business_id` + backfill a un negocio default.
2. RLS / RPC con filtro por negocio activo.
3. Auth/`/api/auth/me`: lista de negocios + negocio activo.
4. Shell: selector de negocio.
5. Seeds, mocks, e2e bodegón parametrizados por negocio.
6. Storage paths con prefijo de negocio.

---

## Fuera de alcance (fase posterior)

- Tabla `store_memberships` y “admin por tienda” con equipo.
- Catálogo compartido entre negocios de una misma cadena.
- SaaS multi-dueño (otros clientes con sus propios negocios).
- Billing / límites por plan.

---

## Checklist de decisión (antes de implementar)

- [ ] ¿Cada negocio tiene su propia tasa REF?
- [ ] ¿Se puede borrar / desactivar un negocio sin borrar histórico?
- [ ] ¿El dashboard del dueño muestra KPIs cruzados o solo del negocio activo?
- [ ] ¿El slug público importa (URLs `/b/bodegon/...`) o solo selector interno?
- [ ] ¿Migrar mocks y e2e al mismo modelo desde el día 1?

---

## Relación con docs actuales

| Doc | Relación |
|-----|----------|
| [`database-design.md`](database-design.md) | Hoy single-tenant; A modifica el modelo relacional |
| [`auth-permissions.md`](auth-permissions.md) | Falta rol/contexto de negocio activo |
| [`supabase-schema-audit.md`](supabase-schema-audit.md) | RLS “authenticated read all” no sirve para multi-negocio |
| [`plan-erp.md`](plan-erp.md) | Visión producto; este archivo añade eje multi-negocio |

Cuando se elija implementar, conviene un plan de migración aparte (epic) basado en **Opción A / A1**, sin membresías.
