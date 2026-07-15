/**
 * Carga catálogo de investigación de campo vía API REST.
 *
 * Prerrequisitos:
 *   1. `npm run dev` en http://localhost:3000
 *   2. `.env.local` con API_DATA_SOURCE=supabase y claves Supabase
 *   3. Usuario con products.manage y contacts.manage (admin@example.com)
 *
 * Ejecutar:
 *   npx tsx scripts/seed-field-research/run.ts
 *
 * Alternativa sin API: ejecutar supabase/seed-field-research-jul2026.sql en SQL Editor.
 */

import { loadDotEnv, ApiClient, unwrapList } from "../e2e-bodegon/client";
import {
  FIELD_RESEARCH_CATEGORIES,
  FIELD_RESEARCH_PRODUCTS,
  FIELD_RESEARCH_SUPPLIERS,
} from "./data";

type JsonRecord = Record<string, unknown>;

function recordId(payload: JsonRecord | null): string {
  const data = payload?.data as JsonRecord | undefined;
  return String(data?.id ?? "");
}

function formatPackNote(packPriceRef: number, packLabel: string) {
  return `${packPriceRef.toFixed(2)} ref / ${packLabel.toLowerCase()}`;
}

async function findCategoryId(client: ApiClient, name: string): Promise<string> {
  const list = await client.request(`/api/categories?search=${encodeURIComponent(name)}&limit=50`);
  const items = unwrapList(list) as JsonRecord[];
  const match = items.find((item) => String(item.name).toLowerCase() === name.toLowerCase());
  return match ? String(match.id) : "";
}

async function main() {
  loadDotEnv();

  const email = process.env.SEED_API_EMAIL ?? process.env.SMOKE_API_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_API_PASSWORD ?? process.env.SMOKE_API_PASSWORD ?? "Admin123!";
  const client = new ApiClient(process.env.SEED_API_BASE_URL ?? "http://localhost:3000");

  console.log("Seed investigación de campo — vía API");
  console.log(`Base URL: ${client.baseUrl}`);
  console.log(`Usuario: ${email}`);
  console.log("");

  const login = await client.request("/api/auth/login", {
    body: JSON.stringify({ email, password }),
    method: "POST",
  });

  if (!login.ok) {
    console.error("Login falló. ¿Está corriendo npm run dev con Supabase configurado?");
    console.error(JSON.stringify(login.body?.error ?? login.body));
    process.exit(1);
  }

  const categoryIds = new Map<string, string>();

  for (const category of FIELD_RESEARCH_CATEGORIES) {
    let id = await findCategoryId(client, category.name);

    if (!id) {
      const created = await client.request("/api/categories", {
        body: JSON.stringify({
          description: category.description,
          name: category.name,
        }),
        method: "POST",
      });

      if (!created.ok) {
        console.error(`No se pudo crear categoría ${category.name}`, created.body?.error);
        process.exit(1);
      }

      id = recordId(created.body);
    }

    categoryIds.set(category.name, id);
    console.log(`Categoría: ${category.name} → ${id}`);
  }

  const supplierIds = new Map<string, string>();

  for (const [key, supplier] of Object.entries(FIELD_RESEARCH_SUPPLIERS)) {
    const search = await client.request(
      `/api/contacts?search=${encodeURIComponent(supplier.name)}&type=proveedor&limit=10`,
    );
    const items = unwrapList(search) as JsonRecord[];
    let id = items.find((item) => String(item.name) === supplier.name)?.id as string | undefined;

    if (!id) {
      const created = await client.request("/api/contacts", {
        body: JSON.stringify({
          address: supplier.address,
          name: supplier.name,
          notes: supplier.notes,
          type: supplier.type,
        }),
        method: "POST",
      });

      if (!created.ok) {
        console.error(`No se pudo crear proveedor ${supplier.name}`, created.body?.error);
        process.exit(1);
      }

      id = recordId(created.body);
    }

    supplierIds.set(key, id);
    console.log(`Proveedor: ${supplier.name} → ${id}`);
  }

  for (const product of FIELD_RESEARCH_PRODUCTS) {
    const categoryId = categoryIds.get(product.categoryName);

    const existing = await client.request(
      `/api/products?search=${encodeURIComponent(product.sku)}&limit=5`,
    );
    const existingItems = unwrapList(existing) as JsonRecord[];
    let productId = existingItems.find((item) => String(item.sku) === product.sku)?.id as
      | string
      | undefined;

    if (!productId) {
      const created = await client.request("/api/products", {
        body: JSON.stringify({
          categoryId,
          currentCostRef: product.unitCostRef,
          name: product.name,
          salePriceRef: 0,
          sku: product.sku,
        }),
        method: "POST",
      });

      if (!created.ok) {
        console.error(`No se pudo crear producto ${product.sku}`, created.body?.error);
        process.exit(1);
      }

      productId = recordId(created.body);
    }

    const supplierId = supplierIds.get(product.supplierKey);
    if (!supplierId || !productId) continue;

    const linkSearch = await client.request(
      `/api/supplier-products?supplierId=${supplierId}&productId=${productId}&limit=5`,
    );
    const linkItems = unwrapList(linkSearch) as JsonRecord[];
    let supplierProductId = linkItems[0]?.id as string | undefined;

    if (!supplierProductId) {
      const linked = await client.request("/api/supplier-products", {
        body: JSON.stringify({
          lastCostRef: product.unitCostRef,
          notes: formatPackNote(product.packPriceRef, product.packLabel),
          productId,
          supplierId,
          supplierSku: product.sku,
        }),
        method: "POST",
      });

      if (!linked.ok) {
        console.error(`No se pudo vincular ${product.sku}`, linked.body?.error);
        process.exit(1);
      }

      supplierProductId = recordId(linked.body);
    } else {
      await client.request(`/api/supplier-products/${supplierProductId}/prices`, {
        body: JSON.stringify({
          newCostRef: product.unitCostRef,
          notes: formatPackNote(product.packPriceRef, product.packLabel),
          origin: "cotizacion",
        }),
        method: "POST",
      });
    }

    const packList = await client.request(`/api/supplier-products/${supplierProductId}/pack-units`);
    const packs = unwrapList(packList) as JsonRecord[];

    if (packs.length === 0) {
      await client.request(`/api/supplier-products/${supplierProductId}/pack-units`, {
        body: JSON.stringify({
          isDefault: true,
          label: product.packLabel,
          unitsPerPack: product.packUnits,
        }),
        method: "POST",
      });
    }

    console.log(
      `OK ${product.sku} (${product.name}) — ${product.unitCostRef} ref/und, ${formatPackNote(product.packPriceRef, product.packLabel)}`,
    );
  }

  console.log("");
  console.log("Listo. Revisa Productos, Contactos y Compras → crear compra.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
