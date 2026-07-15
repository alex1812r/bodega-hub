# Chocomayor — importación de lista de precios

## Flujo

1. `raw_data.txt` — texto extraído del PDF
2. `node anailizar-agrupar.js` → `catalogo_packs.json` (solo empaques múltiples)
3. `npx tsx scripts/chocomayor/import-catalog.ts` — carga masiva al ERP

## Importar al ERP

**Requisitos:** `npm run dev`, `.env.local` con Supabase, usuario admin.

```bash
npx tsx scripts/chocomayor/import-catalog.ts
```

Simular sin escribir:

```bash
npx tsx scripts/chocomayor/import-catalog.ts --dry-run
```

## Qué hace el import

- Crea o reutiliza categorías (Chucherías, Bebidas, Limpieza del Hogar, …)
- Crea contacto proveedor **Chocomayor**
- Por cada SKU en `catalogo_packs.json`:
  - Alta de producto (precio venta 0, costo unitario del catálogo)
  - Vínculo proveedor ↔ producto con cotización
  - Empaques (`Paquete 12 und`, `Caja 24 und`, …)
- Omite ítems con `"omitir": true`
- Agrupa SKUs duplicados (mismo producto, distintos empaques) en un solo producto con varios empaques

## Regenerar catálogo

```bash
cd scripts/chocomayor
node anailizar-agrupar.js
```
