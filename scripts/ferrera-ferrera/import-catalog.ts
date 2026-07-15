/**
 * Importa catalogo.json de Ferrera Ferrera al ERP vía API.
 *
 * Ejecutar:
 *   npx tsx scripts/ferrera-ferrera/import-catalog.ts
 *   npx tsx scripts/ferrera-ferrera/import-catalog.ts --dry-run
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiClient, loadDotEnv, unwrapList } from "../e2e-bodegon/client";

type JsonRecord = Record<string, unknown>;

type CatalogItem = {
  categoria: string;
  codigo_proveedor?: string | null;
  costo_unitario_detal_ref: number;
  modo_compra?: "pack" | "unit";
  nombre_producto: string;
  omitir?: boolean;
  precio_empaque_mayor_ref?: number;
  precio_lista_ref?: number;
  sku_propuesto: string;
  tipo_empaque: string;
  unidades_por_empaque: number;
};

type CatalogFile = {
  items: CatalogItem[];
  proveedor: {
    direccion: string;
    nombre: string;
    notas?: string;
    rif?: string;
  };
};

type ProductGroup = {
  category: string;
  items: CatalogItem[];
  name: string;
  sku: string;
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  "Alimentos Básicos": ["Alimentos Básicos", "Alimentos Basicos"],
  Bebidas: ["Bebidas"],
  "Chucherías": ["Chucherías", "Chucherias"],
  "Higiene Personal": ["Higiene Personal"],
  "Limpieza del Hogar": ["Limpieza del Hogar"],
};

function recordId(payload: JsonRecord | null): string {
  return String((payload?.data as JsonRecord | undefined)?.id ?? "");
}

function normalizeCategoryKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getPackPriceRef(item: CatalogItem) {
  return item.precio_empaque_mayor_ref ?? item.precio_lista_ref ?? 0;
}

function isPackItem(item: CatalogItem) {
  return item.modo_compra !== "unit" && item.unidades_por_empaque > 1;
}

function buildPackLabel(item: CatalogItem) {
  if (!isPackItem(item)) {
    return "Unidad";
  }
  const type = item.tipo_empaque.replace("Caja/Paquete", "Paquete");
  return `${type} ${item.unidades_por_empaque} und`;
}

function formatPriceNote(item: CatalogItem) {
  const packPrice = getPackPriceRef(item);
  if (!isPackItem(item)) {
    return `${packPrice.toFixed(2)} ref / unidad`;
  }
  return `${packPrice.toFixed(2)} ref / ${buildPackLabel(item).toLowerCase()}`;
}

function groupCatalogItems(items: CatalogItem[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();

  for (const item of items) {
    if (item.omitir) continue;

    const existing = groups.get(item.sku_propuesto);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(item.sku_propuesto, {
      category: item.categoria,
      items: [item],
      name: item.nombre_producto,
      sku: item.sku_propuesto,
    });
  }

  return [...groups.values()];
}

function pickDefaultItem(items: CatalogItem[]) {
  const packItems = items.filter(isPackItem);
  if (packItems.length === 0) return items[0];
  return [...packItems].sort((a, b) => b.unidades_por_empaque - a.unidades_por_empaque)[0];
}

async function findCategoryId(client: ApiClient, categoryName: string): Promise<string> {
  const aliases = CATEGORY_ALIASES[categoryName] ?? [categoryName];
  const targetKey = normalizeCategoryKey(categoryName);

  for (const alias of aliases) {
    const list = await client.request(
      `/api/categories?search=${encodeURIComponent(alias)}&limit=50&isActive=true`,
    );
    const items = unwrapList(list) as JsonRecord[];
    const match = items.find((item) => normalizeCategoryKey(String(item.name)) === targetKey);
    if (match?.id) return String(match.id);
  }

  const created = await client.request("/api/categories", {
    body: JSON.stringify({ name: categoryName }),
    method: "POST",
  });

  if (!created.ok) {
    throw new Error(`No se pudo crear categoría ${categoryName}: ${JSON.stringify(created.body?.error)}`);
  }

  return recordId(created.body);
}

async function findOrCreateSupplier(client: ApiClient, supplier: CatalogFile["proveedor"]) {
  const search = await client.request(
    `/api/contacts?search=${encodeURIComponent(supplier.nombre)}&type=proveedor&limit=10`,
  );
  const items = unwrapList(search) as JsonRecord[];
  const match = items.find((item) => String(item.name) === supplier.nombre);

  if (match?.id) return String(match.id);

  const created = await client.request("/api/contacts", {
    body: JSON.stringify({
      address: supplier.direccion,
      name: supplier.nombre,
      notes: supplier.notas,
      taxId: supplier.rif,
      type: "proveedor",
    }),
    method: "POST",
  });

  if (!created.ok) {
    throw new Error(`No se pudo crear proveedor: ${JSON.stringify(created.body?.error)}`);
  }

  return recordId(created.body);
}

async function findProductBySku(client: ApiClient, sku: string) {
  const res = await client.request(`/api/products?search=${encodeURIComponent(sku)}&limit=20`);
  const items = unwrapList(res) as JsonRecord[];
  return items.find((item) => String(item.sku) === sku);
}

async function ensureProduct(
  client: ApiClient,
  group: ProductGroup,
  categoryId: string,
  dryRun: boolean,
) {
  const defaultItem = pickDefaultItem(group.items);
  const existing = await findProductBySku(client, group.sku);

  if (existing?.id) {
    return { created: false, productId: String(existing.id) };
  }

  if (dryRun) {
    return { created: true, productId: `dry-run-${group.sku}` };
  }

  const created = await client.request("/api/products", {
    body: JSON.stringify({
      categoryId,
      currentCostRef: defaultItem.costo_unitario_detal_ref,
      name: group.name,
      salePriceRef: 0,
      sku: group.sku,
    }),
    method: "POST",
  });

  if (!created.ok) {
    throw new Error(`Producto ${group.sku}: ${JSON.stringify(created.body?.error)}`);
  }

  return { created: true, productId: recordId(created.body) };
}

async function ensureSupplierLink(
  client: ApiClient,
  supplierId: string,
  productId: string,
  group: ProductGroup,
  dryRun: boolean,
) {
  if (dryRun) return `dry-run-sp-${group.sku}`;

  const search = await client.request(
    `/api/supplier-products?supplierId=${supplierId}&productId=${productId}&limit=5`,
  );
  const links = unwrapList(search) as JsonRecord[];
  const defaultItem = pickDefaultItem(group.items);
  let supplierProductId = links[0]?.id ? String(links[0].id) : "";

  const supplierSku = defaultItem.codigo_proveedor ?? group.sku;

  if (!supplierProductId) {
    const linked = await client.request("/api/supplier-products", {
      body: JSON.stringify({
        lastCostRef: defaultItem.costo_unitario_detal_ref,
        notes: formatPriceNote(defaultItem),
        productId,
        supplierId,
        supplierSku,
      }),
      method: "POST",
    });

    if (!linked.ok) {
      throw new Error(`Vínculo ${group.sku}: ${JSON.stringify(linked.body?.error)}`);
    }

    supplierProductId = recordId(linked.body);
  } else {
    await client.request(`/api/supplier-products/${supplierProductId}/prices`, {
      body: JSON.stringify({
        newCostRef: defaultItem.costo_unitario_detal_ref,
        notes: formatPriceNote(defaultItem),
        origin: "cotizacion",
      }),
      method: "POST",
    });
  }

  return supplierProductId;
}

async function ensurePackUnits(
  client: ApiClient,
  supplierProductId: string,
  group: ProductGroup,
  dryRun: boolean,
) {
  const packItems = group.items.filter(isPackItem);

  if (packItems.length === 0 || dryRun) return;

  const packList = await client.request(`/api/supplier-products/${supplierProductId}/pack-units`);
  const existing = unwrapList(packList) as JsonRecord[];
  const defaultItem = pickDefaultItem(group.items);

  for (const item of packItems) {
    const label = buildPackLabel(item);
    const already = existing.find(
      (pack) =>
        String(pack.label) === label &&
        Number(pack.unitsPerPack) === item.unidades_por_empaque,
    );

    if (already) continue;

    const created = await client.request(`/api/supplier-products/${supplierProductId}/pack-units`, {
      body: JSON.stringify({
        isDefault: item.unidades_por_empaque === defaultItem.unidades_por_empaque,
        label,
        unitsPerPack: item.unidades_por_empaque,
      }),
      method: "POST",
    });

    if (!created.ok) {
      throw new Error(`Empaque ${group.sku} (${label}): ${JSON.stringify(created.body?.error)}`);
    }
  }
}

async function main() {
  loadDotEnv();

  const dryRun = process.argv.includes("--dry-run");
  const useFullCatalog = process.argv.includes("--all");
  const catalogPath = join(
    __dirname,
    useFullCatalog ? "catalogo.json" : "catalogo_packs.json",
  );
  const catalog = JSON.parse(readFileSync(catalogPath, "utf-8")) as CatalogFile;
  const groups = groupCatalogItems(catalog.items);

  const email = process.env.SEED_API_EMAIL ?? process.env.SMOKE_API_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_API_PASSWORD ?? process.env.SMOKE_API_PASSWORD ?? "Admin123!";
  const client = new ApiClient(process.env.SEED_API_BASE_URL ?? "http://localhost:3000");

  console.log(`Import Ferrera Ferrera — ${groups.length} productos (${catalog.items.length} líneas)`);
  console.log(`Fuente: ${useFullCatalog ? "catalogo.json (completo)" : "catalogo_packs.json (solo mayor)"}`);
  console.log(`Base URL: ${client.baseUrl}`);
  console.log(dryRun ? "Modo: dry-run" : "Modo: importación real");
  console.log("");

  if (!dryRun) {
    const login = await client.request("/api/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    });

    if (!login.ok) {
      console.error("Login falló. Ejecuta npm run dev y verifica .env.local");
      console.error(JSON.stringify(login.body?.error ?? login.body));
      process.exit(1);
    }
  }

  const categoryIds = new Map<string, string>();
  const uniqueCategories = [...new Set(groups.map((group) => group.category))];

  for (const categoryName of uniqueCategories) {
    const id = dryRun ? `dry-run-cat-${categoryName}` : await findCategoryId(client, categoryName);
    categoryIds.set(categoryName, id);
    console.log(`Categoría ${categoryName} → ${id}`);
  }

  const supplierId = dryRun
    ? "dry-run-supplier"
    : await findOrCreateSupplier(client, catalog.proveedor);
  console.log(`Proveedor ${catalog.proveedor.nombre} → ${supplierId}`);
  console.log("");

  let createdProducts = 0;
  let linked = 0;
  const errors: string[] = [];

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const categoryId = categoryIds.get(group.category);

    if (!categoryId) {
      errors.push(`${group.sku}: categoría desconocida ${group.category}`);
      continue;
    }

    try {
      const product = await ensureProduct(client, group, categoryId, dryRun);
      if (product.created) createdProducts++;

      const supplierProductId = await ensureSupplierLink(
        client,
        supplierId,
        product.productId,
        group,
        dryRun,
      );
      await ensurePackUnits(client, supplierProductId, group, dryRun);
      linked++;

      if ((index + 1) % 50 === 0 || index === groups.length - 1) {
        console.log(`Progreso: ${index + 1}/${groups.length}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${group.sku}: ${message}`);
      console.error(`FAIL ${group.sku} — ${message}`);
    }
  }

  console.log("");
  console.log(`Productos nuevos: ${createdProducts}`);
  console.log(`Vínculos procesados: ${linked}/${groups.length}`);

  if (errors.length > 0) {
    console.log(`Errores: ${errors.length}`);
    errors.slice(0, 10).forEach((entry) => console.log(`  - ${entry}`));
    process.exit(1);
  }

  console.log("Listo. Revisa Productos, Contactos y Compras con Ferrera Ferrera.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
