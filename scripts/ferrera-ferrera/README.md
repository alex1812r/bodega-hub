# Ferrera Ferrera — importación de lista de precios

## Flujo

1. `raw-data.txt` — export del listado (Item, Codigo, Description, Existencia, Precio2)
2. `node analizar-lista.js` → `catalogo.json` (todos los productos)
3. `node analizar-agrupar.js` → `catalogo_packs.json` (**solo empaques al mayor** — el que interesa para compras)
4. `npx tsx import-catalog.ts` — carga masiva al ERP (usa `catalogo_packs.json` por defecto)

## Generar JSON

```bash
cd scripts/ferrera-ferrera

# Catálogo completo (unidad + empaque)
node analizar-lista.js

# Solo mayor: cajas, paquetes, bolsas, etc. (modo pack)
node analizar-agrupar.js
```

| Archivo | Contenido |
|---------|-----------|
| `catalogo.json` | 1032 productos — unidad y empaque |
| `catalogo_packs.json` | ~610 productos — **solo venta al mayor** |

## Importar al ERP

**Requisitos:** `npm run dev`, `.env.local` con Supabase.

```bash
# Mayorista (recomendado — igual que Chocomayor)
npx tsx scripts/ferrera-ferrera/import-catalog.ts

# Catálogo completo (incluye unidades sueltas)
npx tsx scripts/ferrera-ferrera/import-catalog.ts --all
```

Simular:

```bash
npx tsx scripts/ferrera-ferrera/import-catalog.ts --dry-run
```

## Proveedor

| Campo | Valor |
|-------|-------|
| Nombre | COMERCIALIZADORA FERRERA FERRERA, C.A. |
| Dirección | AV. LOS CARMENES CON 3ERA TRANSVERSAL LOCAL 42 N° 1-2 |
| RIF | J-30960611-5 |

## Notas de parseo

- **Precio2** (última columna) = precio mayorista en REF
- **Existencia** = stock del proveedor (referencia, no se importa a inventario)
- SKU: slug del nombre + código proveedor (`arroz-mary-esmeralda-900grs-001045`)
- Empaques: `24X900GRS`, `12UNDX600cc`, `1PAQX8`, etc.
- Reutiliza utilidades de `scripts/chocomayor/` (nombres, categorías)
