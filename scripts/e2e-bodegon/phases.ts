import type { ApiClient } from "./client";
import { unwrapId } from "./client";
import type { E2eManifest } from "./manifest";
import {
  CATEGORIES,
  CONTACT_BOTH,
  CUSTOMERS,
  INVENTORY_INITIAL_KEYS,
  INVENTORY_INITIAL_QTY,
  PRODUCTS,
  SUPPLIER_PRODUCT_LINKS,
  SUPPLIERS,
  USERS,
  e2eSuffix,
} from "./data";

type SaleLike = { id: string; totalVes?: number; status?: string };
type PurchaseLike = { id: string; totalVes?: number; status?: string };

function recordId(obj: unknown): string {
  const id = unwrapId(obj);
  if (!id) throw new Error("Missing id in API response");
  return id;
}

export async function phase1Auth(client: ApiClient) {
  console.log("\n=== Fase 1 — Autenticación ===");
  const login = await client.step("1", "POST /api/auth/login (admin)", () =>
    client.login(USERS.admin.email, USERS.admin.password),
  );
  await client.step("1", "GET /api/auth/me (admin)", () => client.request("/api/auth/me"));
  await client.step("1", "POST /api/auth/logout", () => client.logout());

  await client.step("1", "POST /api/auth/login (vendedor)", () =>
    client.login(USERS.vendedor.email, USERS.vendedor.password),
  );
  await client.step("1", "GET /api/auth/me (vendedor)", () => client.request("/api/auth/me"));
  await client.logout();

  const unauth = await client.step("1", "GET /api/products sin sesión", () => client.request("/api/products"), {
    expectStatus: [401, 403],
    allowFail: process.env.ALLOW_DEMO_AUTH === "true",
  });
  if (process.env.ALLOW_DEMO_AUTH === "true" && unauth.ok) {
    console.log("       (ALLOW_DEMO_AUTH=true: sin cookie puede responder 200 con demo)");
  }

  await client.login(USERS.admin.email, USERS.admin.password);
  if (!login.ok) throw new Error("Admin login failed — check seed and credentials");
}

export async function phase2Settings(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 2 — Settings y tasas ===");
  await client.step("2", "GET /api/settings", () => client.request("/api/settings"));
  await client.step("2", "PATCH /api/settings", () =>
    client.request("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        businessName: "Bodegón La Esquina",
        lowStockThreshold: 8,
        invoicePrefix: "BOD",
      }),
    }),
  );
  await client.step("2", "GET /api/exchange-rates/current", () =>
    client.request("/api/exchange-rates/current"),
  );

  for (const rate of [48.0, 52.0]) {
    const res = await client.step("2", `POST /api/exchange-rates (${rate})`, () =>
      client.request("/api/exchange-rates", {
        method: "POST",
        body: JSON.stringify({ rateVes: rate, source: "Manual E2E" }),
      }),
    );
    const id = recordId(client.data(res));
    manifest.exchangeRateIds.push(id);
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await client.step("2", "GET /api/exchange-rates historial", () =>
    client.request(`/api/exchange-rates?from=${monthAgo}&to=${today}&limit=10`),
  );
}

export async function phase3Categories(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 3 — Categorías ===");
  for (const cat of CATEGORIES) {
    const res = await client.step("3", `POST category ${cat.key}`, () =>
      client.request("/api/categories", {
        method: "POST",
        body: JSON.stringify({
          name: `${cat.name}${e2eSuffix()}`,
          description: cat.description,
        }),
      }),
    );
    if (res.ok) {
      manifest.categoryIds[cat.key] = recordId(client.data(res));
    }
  }

  await client.step("3", "GET /api/categories", () => client.request("/api/categories?limit=20"));
  const firstKey = CATEGORIES[0].key;
  const catId = manifest.categoryIds[firstKey];
  if (catId) {
    await client.step("3", "GET /api/categories/[id]", () => client.request(`/api/categories/${catId}`));
    await client.step("3", "PATCH /api/categories/[id]", () =>
      client.request(`/api/categories/${catId}`, {
        method: "PATCH",
        body: JSON.stringify({ description: "Categoría actualizada E2E" }),
      }),
    );
  }

  await client.step("3", "POST categoría duplicada (409)", () =>
    client.request("/api/categories", {
      method: "POST",
      body: JSON.stringify({
        name: `${CATEGORIES[0].name}${e2eSuffix()}`,
        description: "dup",
      }),
    }),
    { expectStatus: [409, 400], allowFail: false },
  );

  const discardKey = "prueba_dup";
  if (manifest.categoryIds[discardKey]) {
    manifest.discardCategoryId = manifest.categoryIds[discardKey];
    await client.step("3", "DELETE /api/categories/[id]", () =>
      client.request(`/api/categories/${manifest.discardCategoryId}`, { method: "DELETE" }),
    );
  }
}

export async function phase4Products(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 4 — Productos ===");

  await client.step(
    "4",
    "GET /api/products/import/template",
    () => client.requestBinary("/api/products/import/template"),
    { requireOkResponse: true },
  );

  for (const product of PRODUCTS) {
    const categoryId = manifest.categoryIds[product.categoryKey];
    const res = await client.step("4", `POST product ${product.key}`, () =>
      client.request("/api/products", {
        method: "POST",
        body: JSON.stringify({
          sku: `${product.sku}${e2eSuffix()}`,
          name: product.name,
          categoryId,
          salePriceRef: product.salePriceRef,
          currentCostRef: product.currentCostRef,
          minStock: product.minStock,
          currentStock: 0,
        }),
      }),
      { expectStatus: [201, 409] },
    );
    if (res.status === 201) {
      manifest.productIds[product.key] = recordId(client.data(res));
    }
  }

  await client.step("4", "GET /api/products?search=Arroz", () =>
    client.request("/api/products?search=Arroz&limit=10"),
  );

  const arrozId = manifest.productIds.arroz;
  if (arrozId) {
    const catId = manifest.categoryIds.despensa_granos;
    await client.step("4", "GET /api/products?categoryId", () =>
      client.request(`/api/products?categoryId=${catId}&isActive=true&limit=20`),
    );
    await client.step("4", "GET /api/products/[id]", () => client.request(`/api/products/${arrozId}`));
    await client.step("4", "PATCH /api/products/[id]", () =>
      client.request(`/api/products/${arrozId}`, {
        method: "PATCH",
        body: JSON.stringify({ minStock: 25, salePriceRef: 1.9 }),
      }),
    );
  }

  await client.step("4", "POST SKU duplicado (409)", () =>
    client.request("/api/products", {
      method: "POST",
      body: JSON.stringify({
        sku: `BOD-DGR-001${e2eSuffix()}`,
        name: "Arroz duplicado",
        salePriceRef: 2,
      }),
    }),
    { expectStatus: 409 },
  );

  if (manifest.productIds.discard) {
    manifest.discardProductId = manifest.productIds.discard;
    await client.step("4", "DELETE /api/products/[id]", () =>
      client.request(`/api/products/${manifest.discardProductId}`, { method: "DELETE" }),
    );
  }
}

export async function phase5Contacts(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 5 — Contactos ===");
  for (const s of SUPPLIERS) {
    const res = await client.step("5", `POST supplier ${s.key}`, () =>
      client.request("/api/contacts", {
        method: "POST",
        body: JSON.stringify({
          name: s.name,
          type: s.type,
          phone: s.phone,
          email: s.email,
          taxId: s.taxId ? `${s.taxId}${e2eSuffix()}` : undefined,
          address: s.address,
        }),
      }),
    );
    manifest.contactIds[s.key] = recordId(client.data(res));
  }

  for (const c of CUSTOMERS) {
    const res = await client.step("5", `POST customer ${c.key}`, () =>
      client.request("/api/contacts", {
        method: "POST",
        body: JSON.stringify({
          name: c.name,
          type: c.type,
          phone: c.phone,
          taxId: c.taxId ? `${c.taxId}${e2eSuffix()}` : undefined,
        }),
      }),
    );
    manifest.contactIds[c.key] = recordId(client.data(res));
  }

  const bothRes = await client.step("5", "POST contacto ambos", () =>
    client.request("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: CONTACT_BOTH.name,
        type: CONTACT_BOTH.type,
        phone: CONTACT_BOTH.phone,
        taxId: `${CONTACT_BOTH.taxId}${e2eSuffix()}`,
      }),
    }),
  );
  manifest.contactIds[CONTACT_BOTH.key] = recordId(client.data(bothRes));

  await client.step("5", "GET /api/contacts?type=proveedor", () =>
    client.request("/api/contacts?type=proveedor&limit=20"),
  );
  await client.step("5", "GET /api/contacts?search=María", () =>
    client.request("/api/contacts?search=María&limit=10"),
  );

  const mariaId = manifest.contactIds.cli_maria;
  if (mariaId) {
    await client.step("5", "PATCH /api/contacts/[id]", () =>
      client.request(`/api/contacts/${mariaId}`, {
        method: "PATCH",
        body: JSON.stringify({ address: "Urbanización Los Olivos, casa 12" }),
      }),
    );
    await client.step("5", "GET /api/contacts/[id]/activity", () =>
      client.request(`/api/contacts/${mariaId}/activity?limit=10`),
    );
  }

  await client.step("5", "POST taxId duplicado (409)", () =>
    client.request("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: "Cliente duplicado tax",
        type: "cliente",
        taxId: `V-12345678${e2eSuffix()}`,
      }),
    }),
    { expectStatus: [409, 400],
    },
  );
}

export async function phase6SupplierProducts(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 6 — Proveedor-producto ===");
  for (const link of SUPPLIER_PRODUCT_LINKS) {
    const productId = manifest.productIds[link.productKey];
    const supplierId = manifest.contactIds[link.supplierKey];
    if (!productId || !supplierId) continue;

    const res = await client.step("6", `POST supplier-product ${link.productKey}`, () =>
      client.request("/api/supplier-products", {
        method: "POST",
        body: JSON.stringify({
          productId,
          supplierId,
          supplierSku: link.supplierSku,
          lastCostRef: link.lastCostRef,
        }),
      }),
    );
    if (res.ok) manifest.supplierProductIds.push(recordId(client.data(res)));
  }

  await client.step("6", "GET /api/supplier-products", () =>
    client.request("/api/supplier-products?limit=20"),
  );

  const spId = manifest.supplierProductIds[0];
  if (spId) {
    await client.step("6", "POST /api/supplier-products/[id]/prices", () =>
      client.request(`/api/supplier-products/${spId}/prices`, {
        method: "POST",
        body: JSON.stringify({
          newCostRef: 2.55,
          origin: "cotizacion",
          notes: "Relevamiento E2E",
        }),
      }),
    );

    await client.step("6", "GET /api/supplier-products/[id]/price-history", () =>
      client.request(`/api/supplier-products/${spId}/price-history?limit=10`),
    );

    await client.step("6", "PATCH /api/supplier-products/[id]", () =>
      client.request(`/api/supplier-products/${spId}`, {
        method: "PATCH",
        body: JSON.stringify({ supplierSku: "SNK-OREO-V2", notes: "SKU actualizado E2E" }),
      }),
    );

    await client.step("6", "PATCH /api/supplier-products/[id]/deactivate", () =>
      client.request(`/api/supplier-products/${spId}/deactivate`, {
        method: "PATCH",
      }),
    );

    await client.step("6", "GET /api/supplier-products?isActive=true", () =>
      client.request("/api/supplier-products?isActive=true&limit=50"),
    );
  }

  const firstLink = SUPPLIER_PRODUCT_LINKS[0];
  const duplicateProductId = manifest.productIds[firstLink.productKey];
  const duplicateSupplierId = manifest.contactIds[firstLink.supplierKey];
  if (duplicateProductId && duplicateSupplierId) {
    await client.step("6", "POST supplier-product duplicado (409)", () =>
      client.request("/api/supplier-products", {
        method: "POST",
        body: JSON.stringify({
          productId: duplicateProductId,
          supplierId: duplicateSupplierId,
          supplierSku: "SNK-DUP",
          lastCostRef: 1,
        }),
      }),
      { expectStatus: [409] },
    );
  }

  const oreoId = manifest.productIds.oreo;
  const provSnacks = manifest.contactIds.prov_snacks;
  if (oreoId) {
    await client.step("6", "GET /api/products/[id]/suppliers", () =>
      client.request(`/api/products/${oreoId}/suppliers?limit=10`),
    );
  }
  if (provSnacks) {
    await client.step("6", "GET /api/suppliers/[id]/products", () =>
      client.request(`/api/suppliers/${provSnacks}/products?limit=10`),
    );
  }

  const clienteId = manifest.contactIds.cli_maria;
  const productId = manifest.productIds.coca;
  if (clienteId && productId) {
    await client.step("6", "POST supplier-product cliente inválido", () =>
      client.request("/api/supplier-products", {
        method: "POST",
        body: JSON.stringify({ productId, supplierId: clienteId, lastCostRef: 1 }),
      }),
      { expectStatus: [400, 403, 409, 500] },
    );
  }
}

export async function phase7Inventory(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 7 — Inventario inicial ===");
  for (const key of INVENTORY_INITIAL_KEYS) {
    const productId = manifest.productIds[key];
    const qty = INVENTORY_INITIAL_QTY[key] ?? 50;
    if (!productId) continue;
    await client.step("7", `POST inventario inicial ${key}`, () =>
      client.request("/api/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({
          productId,
          quantityDelta: qty,
          type: "inventario_inicial",
          reason: "Carga inicial bodegón E2E",
        }),
      }),
    );
  }

  await client.step("7", "GET /api/inventory", () => client.request("/api/inventory?limit=30"));
  await client.step("7", "GET /api/inventory?lowStock=true", () =>
    client.request("/api/inventory?lowStock=true&limit=20"),
  );

  const arrozId = manifest.productIds.arroz;
  if (arrozId) {
    await client.step("7", "GET /api/inventory/movements", () =>
      client.request(`/api/inventory/movements?productId=${arrozId}&limit=10`),
    );
    await client.step("7", "GET /api/inventory/stock-card", () =>
      client.request(`/api/inventory/stock-card?productId=${arrozId}&limit=20`),
    );
    await client.step("7", "Ajuste negativo excesivo (400)", () =>
      client.request("/api/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({
          productId: arrozId,
          quantityDelta: -99999,
          type: "ajuste_salida",
          reason: "Test stock insuficiente",
        }),
      }),
      { expectStatus: [400, 409] },
    );
  }
}

async function loginAs(client: ApiClient, role: keyof typeof USERS) {
  await client.logout();
  const res = await client.login(USERS[role].email, USERS[role].password, role);
  if (!res.ok) throw new Error(`Login ${role} failed`);
}

function rateContext(manifest: E2eManifest) {
  return {
    exchangeRateId: manifest.exchangeRateIds.at(-1),
    refRateVes: 52,
  };
}

export async function phase8Purchases(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 8 — Compras ===");
  await loginAs(client, "almacen");

  const rateCtx = rateContext(manifest);
  const despensaId = manifest.contactIds.prov_despensa;
  const itemsDespensa = ["arroz", "pasta", "harina", "aceite"]
    .map((key) => {
      const productId = manifest.productIds[key];
      if (!productId) return null;
      const p = PRODUCTS.find((x) => x.key === key)!;
      return {
        productId,
        quantity: 50,
        unitCostRef: p.currentCostRef,
      };
    })
    .filter(Boolean);

  if (despensaId && itemsDespensa.length) {
    const res = await client.step("8", "POST compra recibida despensa", () =>
      client.request("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: despensaId,
          status: "recibido",
          items: itemsDespensa,
          taxRef: 0,
          discountRef: 0,
          ...rateCtx,
          notes: "Compra despensa mayorista E2E",
        }),
      }),
    );
    manifest.purchaseIds.despensa_recibida = recordId(client.data(res));
  }

  const heladosId = manifest.contactIds.prov_helados;
  const itemsPedido = ["paleta", "helado_pote"]
    .map((key) => {
      const productId = manifest.productIds[key];
      const p = PRODUCTS.find((x) => x.key === key)!;
      return productId
        ? { productId, quantity: 30, unitCostRef: p.currentCostRef }
        : null;
    })
    .filter(Boolean);

  if (heladosId && itemsPedido.length) {
    const res = await client.step("8", "POST compra pedido helados", () =>
      client.request("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: heladosId,
          status: "pedido",
          items: itemsPedido,
          ...rateCtx,
        }),
      }),
    );
    manifest.purchaseIds.helados_pedido = recordId(client.data(res));
  }

  await client.step("8", "GET /api/purchases", () => client.request("/api/purchases?limit=15"));
  const pedidoId = manifest.purchaseIds.helados_pedido;
  if (pedidoId) {
    await client.step("8", "GET /api/purchases/[id]", () => client.request(`/api/purchases/${pedidoId}`));
    await client.step("8", "PATCH /api/purchases/[id]/receive", () =>
      client.request(`/api/purchases/${pedidoId}/receive`, { method: "PATCH" }),
    );
    if (heladosId) {
      await client.logout();
      await client.login(USERS.admin.email, USERS.admin.password, "admin");
      await client.step("8", "GET contact purchases", () =>
        client.request(`/api/contacts/${heladosId}/purchases?limit=10`),
      );
      await loginAs(client, "almacen");
    }
  }

  const refrescosId = manifest.contactIds.prov_refrescos;
  const cocaId = manifest.productIds.coca;
  if (refrescosId && cocaId) {
    const cancelRes = await client.step("8", "POST compra para cancelar", () =>
      client.request("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: refrescosId,
          status: "pedido",
          items: [{ productId: cocaId, quantity: 5, unitCostRef: 1.6 }],
          ...rateCtx,
        }),
      }),
    );
    const cancelId = cancelRes.ok ? recordId(client.data(cancelRes)) : undefined;
    if (cancelId) {
      await client.step("8", "PATCH /api/purchases/[id]/cancel", () =>
        client.request(`/api/purchases/${cancelId}/cancel`, { method: "PATCH" }),
      );
    }
  }

  const snacksId = manifest.contactIds.prov_snacks;
  const papasId = manifest.productIds.papas;
  if (snacksId && papasId) {
    const retRes = await client.step("8", "POST compra para devolver", () =>
      client.request("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: snacksId,
          status: "recibido",
          items: [{ productId: papasId, quantity: 10, unitCostRef: 1.5 }],
          ...rateCtx,
        }),
      }),
    );
    const retId = retRes.ok ? recordId(client.data(retRes)) : undefined;
    if (retId) {
      await client.step("8", "POST /api/purchases/[id]/return", () =>
        client.request(`/api/purchases/${retId}/return`, { method: "POST" }),
      );
    }
  }

  await client.logout();
  await client.step("8", "POST compra como vendedor (403)", async () => {
    await client.login(USERS.vendedor.email, USERS.vendedor.password);
    return client.request("/api/purchases", {
      method: "POST",
      body: JSON.stringify({
        supplierId: despensaId,
        items: [{ productId: manifest.productIds.arroz, quantity: 1, unitCostRef: 1 }],
        ...rateCtx,
      }),
    });
  }, { expectStatus: [403, 500], allowFail: true });

  await client.login(USERS.admin.email, USERS.admin.password);
}

export async function phase9PurchasePayments(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 9 — Pagos de compras ===");
  await loginAs(client, "admin");

  const createPurchaseForPayment = async (key: string) => {
    const supplierId = manifest.contactIds.prov_refrescos;
    const productId = manifest.productIds.malta ?? manifest.productIds.coca;
    if (!supplierId || !productId) return;
    const res = await client.step("9", `POST compra base pago ${key}`, () =>
      client.request("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId,
          status: "recibido",
          items: [{ productId, quantity: 12, unitCostRef: 1.3 }],
          notes: `Compra para pago ${key}`,
          ...rateContext(manifest),
        }),
      }),
    );
    if (res.ok) {
      const data = client.data<PurchaseLike>(res);
      const id = recordId(data);
      manifest.purchaseIds[`pay_${key}`] = id;
      return { id, totalVes: data?.totalVes ?? 8000 };
    }
  };

  const payTargets: Array<{
    key: string;
    method: string;
    body: (purchaseId: string, amount: number) => object;
  }> = [
    {
      key: "efectivo_ves",
      method: "efectivo_ves",
      body: (purchaseId, amount) => ({
        purchaseId,
        amount,
        method: "efectivo_ves",
        currency: "VES",
      }),
    },
    {
      key: "efectivo_usd",
      method: "efectivo_usd",
      body: (purchaseId, amount) => ({
        purchaseId,
        amount: Math.min(amount / 50, 50),
        method: "efectivo_usd",
        currency: "USD",
      }),
    },
    {
      key: "pago_movil",
      method: "pago_movil",
      body: (purchaseId, amount) => ({
        purchaseId,
        amount: amount * 0.5,
        method: "pago_movil",
        currency: "VES",
        bankName: "Banesco",
        phone: "04141234567",
        referenceCode: "1234",
      }),
    },
    {
      key: "transferencia",
      method: "transferencia",
      body: (purchaseId, amount) => ({
        purchaseId,
        amount: amount * 0.3,
        method: "transferencia",
        currency: "VES",
        bankName: "Mercantil",
        referenceCode: "TRF-E2E-001",
      }),
    },
    {
      key: "punto_venta",
      method: "punto_venta",
      body: (purchaseId, amount) => ({
        purchaseId,
        amount: amount * 0.2,
        method: "punto_venta",
        currency: "VES",
        referenceCode: "POS-9988",
      }),
    },
  ];

  for (const pt of payTargets) {
    await createPurchaseForPayment(pt.key);
  }

  await loginAs(client, "contador");

  const purchaseTotals: Record<string, number> = {};
  for (const pt of payTargets) {
    const pid = manifest.purchaseIds[`pay_${pt.key}`];
    if (!pid) continue;
    const detail = await client.request(`/api/purchases/${pid}`);
    purchaseTotals[pt.key] = client.data<PurchaseLike>(detail)?.totalVes ?? 8000;
  }

  for (const pt of payTargets) {
    const created = manifest.purchaseIds[`pay_${pt.key}`]
      ? { id: manifest.purchaseIds[`pay_${pt.key}`], totalVes: purchaseTotals[pt.key] ?? 8000 }
      : undefined;
    if (!created) continue;
    const res = await client.step("9", `POST pago compra ${pt.method}`, () =>
      client.request("/api/payments", {
        method: "POST",
        body: JSON.stringify(pt.body(created.id, created.totalVes)),
      }),
    );
    if (res.ok) {
      const paymentId = recordId(client.data(res));
      manifest.paymentIds.push(paymentId);
      if (pt.key === "efectivo_ves") {
        manifest.purchaseIds.pay_patch_target = paymentId;
      }
    }
  }

  const pid = manifest.purchaseIds.pay_efectivo_ves;
  if (pid) {
    await client.step("9", "GET /api/payments?purchaseId", () =>
      client.request(`/api/payments?purchaseId=${pid}&limit=10`),
    );
  }

  const payId = manifest.purchaseIds.pay_patch_target ?? manifest.paymentIds.at(-1);
  if (payId) {
    await client.step("9", "GET /api/payments/[id]", () => client.request(`/api/payments/${payId}`));
    await client.logout();
    await client.login(USERS.admin.email, USERS.admin.password, "admin");
    await client.step("9", "PATCH /api/payments/[id] (admin/RLS)", () =>
      client.request(`/api/payments/${payId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: "Pago verificado E2E", bankName: "Banesco" }),
      }),
      { expectStatus: [200, 404] },
    );
    await loginAs(client, "contador");
  }

  const provId = manifest.contactIds.prov_refrescos;
  if (provId) {
    await client.step("9", "GET contact payments", () =>
      client.request(`/api/contacts/${provId}/payments?limit=10`),
    );
  }

  await client.step("9", "POST pago_movil sin teléfono (400)", () =>
    client.request("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        purchaseId: pid,
        amount: 100,
        method: "pago_movil",
        bankName: "Banesco",
        referenceCode: "5678",
      }),
    }),
    { expectStatus: 400 },
  );

  await client.login(USERS.admin.email, USERS.admin.password);
}

export async function phase10Sales(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 10 — Ventas ===");
  await loginAs(client, "vendedor");

  const rateRes = await client.request("/api/exchange-rates/current");
  const rateData = client.data<{ id?: string; rateVes?: number }>(rateRes);
  const exchangeRateId = rateData?.id ?? manifest.exchangeRateIds.at(-1);
  const refRateVes = rateData?.rateVes ?? 52;

  const mariaId = manifest.contactIds.cli_maria;
  const itemsSnack = ["oreo", "coca", "chicle"]
    .map((key) => {
      const productId = manifest.productIds[key];
      const p = PRODUCTS.find((x) => x.key === key)!;
      return productId ? { productId, quantity: 3, unitPriceRef: p.salePriceRef } : null;
    })
    .filter(Boolean);

  if (mariaId && itemsSnack.length) {
    const res = await client.step("10", "POST venta chucherías/refrescos", () =>
      client.request("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          customerId: mariaId,
          items: itemsSnack,
          taxRef: 0,
          discountRef: 0,
          exchangeRateId,
          refRateVes,
          notes: "Venta bodegón E2E",
        }),
      }),
    );
    manifest.saleIds.snacks = recordId(client.data(res));
  }

  const joseId = manifest.contactIds.cli_jose;
  const itemsDespensa = ["arroz", "aceite"]
    .map((key) => {
      const productId = manifest.productIds[key];
      const p = PRODUCTS.find((x) => x.key === key)!;
      return productId ? { productId, quantity: 2, unitPriceRef: p.salePriceRef } : null;
    })
    .filter(Boolean);

  if (joseId && itemsDespensa.length) {
    const res = await client.step("10", "POST venta despensa", () =>
      client.request("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          customerId: joseId,
          items: itemsDespensa,
          exchangeRateId,
          refRateVes,
        }),
      }),
    );
    manifest.saleIds.despensa = recordId(client.data(res));
  }

  const arrozId = manifest.productIds.arroz;
  if (mariaId && arrozId) {
    await client.step("10", "POST venta stock insuficiente", () =>
      client.request("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          customerId: mariaId,
          items: [{ productId: arrozId, quantity: 999999, unitPriceRef: 1.8 }],
          ...rateContext(manifest),
        }),
      }),
      { expectStatus: [400, 409, 500] },
    );
  }

  await client.step("10", "GET /api/sales", () => client.request("/api/sales?limit=15"));
  const saleId = manifest.saleIds.snacks;
  if (saleId) {
    await client.step("10", "GET /api/sales/[id]", () => client.request(`/api/sales/${saleId}`));
    await client.logout();
    await client.login(USERS.admin.email, USERS.admin.password);
    await client.step("10", "PATCH /api/sales/[id] notas (admin/RLS)", () =>
      client.request(`/api/sales/${saleId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: "Cliente frecuente — E2E" }),
      }),
      { expectStatus: [200, 404] },
    );
    await client.login(USERS.vendedor.email, USERS.vendedor.password);
    await client.step("10", "GET /api/sales/[id]/receipt", () =>
      client.request(`/api/sales/${saleId}/receipt`),
    );
    if (mariaId) {
      await client.step("10", "GET contact sales", () =>
        client.request(`/api/contacts/${mariaId}/sales?limit=10`),
      );
    }
  }

  await client.logout();
  await client.step("10", "POST venta como almacen (403)", async () => {
    await client.login(USERS.almacen.email, USERS.almacen.password);
    return client.request("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        customerId: mariaId,
        items: [{ productId: manifest.productIds.chicle, quantity: 1 }],
        ...rateContext(manifest),
      }),
    });
  }, { expectStatus: 403 });

  await client.login(USERS.vendedor.email, USERS.vendedor.password);
}

export async function phase11SalePayments(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 11 — Pagos de ventas ===");

  const createSale = async (key: string, customerKey: string, productKeys: string[]) => {
    const customerId = manifest.contactIds[customerKey];
    const items = productKeys
      .map((pk) => {
        const productId = manifest.productIds[pk];
        const p = PRODUCTS.find((x) => x.key === pk)!;
        return productId ? { productId, quantity: 2, unitPriceRef: p.salePriceRef } : null;
      })
      .filter(Boolean);
    if (!customerId || !items.length) return;
    const res = await client.request("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        customerId,
        items,
        ...rateContext(manifest),
      }),
    });
    if (!res.ok) return;
    const data = client.data<SaleLike>(res);
    manifest.saleIds[`pay_${key}`] = data!.id;
    return { id: data!.id, totalVes: data!.totalVes ?? 3000 };
  };

  await loginAs(client, "vendedor");
  const saleA = await createSale("a", "cli_ana", ["papas"]);
  const saleB = await createSale("b", "cli_luis", ["leche", "queso"]);
  const saleC = await createSale("c", "cli_carmen", ["harina"]);
  const saleD = await createSale("d", "cli_pedro", ["detergente"]);

  await loginAs(client, "contador");

  if (saleA) {
    await client.step("11", "Pago venta efectivo_ves total", () =>
      client.request("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          saleId: saleA.id,
          amount: saleA.totalVes,
          method: "efectivo_ves",
          currency: "VES",
        }),
      }),
    );
  }

  if (saleB) {
    await client.step("11", "Pago venta pago_movil parcial", () =>
      client.request("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          saleId: saleB.id,
          amount: saleB.totalVes * 0.4,
          method: "pago_movil",
          currency: "VES",
          bankName: "Provincial",
          phone: "04241234567",
          referenceCode: "4321",
        }),
      }),
    );
    await client.step("11", "Pago venta transferencia resto", () =>
      client.request("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          saleId: saleB.id,
          amount: saleB.totalVes * 0.6,
          method: "transferencia",
          currency: "VES",
          bankName: "BNC",
          referenceCode: "TRF-VENTA-B",
        }),
      }),
    );
  }

  if (saleC) {
    const res = await client.step("11", "Pago venta efectivo_usd", () =>
      client.request("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          saleId: saleC.id,
          amount: 5,
          method: "efectivo_usd",
          currency: "USD",
        }),
      }),
    );
    if (res.ok) manifest.paymentIds.push(recordId(client.data(res)));
  }

  if (saleD) {
    await client.step("11", "Pago venta punto_venta", () =>
      client.request("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          saleId: saleD.id,
          amount: saleD.totalVes,
          method: "punto_venta",
          currency: "VES",
          referenceCode: "POS-1234",
        }),
      }),
    );
  }

  const sid = manifest.saleIds.pay_a ?? manifest.saleIds.snacks;
  if (sid) {
    await client.step("11", "GET /api/payments?saleId", () =>
      client.request(`/api/payments?saleId=${sid}&limit=10`),
    );
    const saleCheck = await client.request(`/api/sales/${sid}`);
    const sale = client.data<SaleLike>(saleCheck);
    console.log(`       Venta ${sid} status: ${sale?.status ?? "?"}`);
  }

  await client.step("11", "GET /api/payments?direction=entrada", () =>
    client.request("/api/payments?direction=entrada&limit=20"),
  );

  await client.login(USERS.admin.email, USERS.admin.password);
}

export async function phase12Exceptions(client: ApiClient, manifest: E2eManifest) {
  const rateCtx = rateContext(manifest);
  console.log("\n=== Fase 12 — Excepciones ===");
  const mariaId = manifest.contactIds.cli_maria;
  const chicleId = manifest.productIds.chicle;
  if (mariaId && chicleId) {
    const res = await client.request("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        customerId: mariaId,
        items: [{ productId: chicleId, quantity: 5, unitPriceRef: 1.2 }],
        ...rateCtx,
      }),
    });
    const cancelSaleId = res.ok ? recordId(client.data(res)) : undefined;
    if (cancelSaleId) {
      await client.step("12", "PATCH /api/sales/[id]/cancel", () =>
        client.request(`/api/sales/${cancelSaleId}/cancel`, { method: "PATCH" }),
      );
    }
  }

  const anaId = manifest.contactIds.cli_ana;
  const oreoId = manifest.productIds.oreo;
  if (anaId && oreoId) {
    const saleRes = await client.request("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        customerId: anaId,
        items: [{ productId: oreoId, quantity: 4, unitPriceRef: 3.5 }],
        ...rateCtx,
      }),
    });
    const returnSaleId = saleRes.ok ? recordId(client.data(saleRes)) : undefined;
    if (returnSaleId) {
      await client.step("12", "POST /api/sales/[id]/return", () =>
        client.request(`/api/sales/${returnSaleId}/return`, { method: "POST" }),
      );
    }
  }

  if (oreoId) {
    await client.step("12", "Ajuste devolucion_cliente", () =>
      client.request("/api/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({
          productId: oreoId,
          quantityDelta: 2,
          type: "devolucion_cliente",
          reason: "Devolución E2E",
        }),
      }),
    );
    await client.step("12", "GET movements post-return", () =>
      client.request(`/api/inventory/movements?productId=${oreoId}&limit=15`),
    );
  }
}

export async function phase13Prices(client: ApiClient, manifest: E2eManifest) {
  const rateCtx = rateContext(manifest);
  console.log("\n=== Fase 13 — Precios ===");
  const oreoId = manifest.productIds.oreo;
  const arrozId = manifest.productIds.arroz;
  if (oreoId) {
    await client.step("13", "POST /api/products/[id]/price", () =>
      client.request(`/api/products/${oreoId}/price`, {
        method: "POST",
        body: JSON.stringify({ salePriceRef: 3.8 }),
      }),
    );
    await client.step("13", "GET price-history", () =>
      client.request(`/api/products/${oreoId}/price-history?limit=10`),
    );
  }
  if (arrozId && manifest.contactIds.cli_roberto) {
    await client.step("13", "Venta post-reprecio", () =>
      client.request("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          customerId: manifest.contactIds.cli_roberto,
          items: [{ productId: arrozId, quantity: 1, unitPriceRef: 1.9 }],
          ...rateCtx,
        }),
      }),
    );
  }
}

export async function phase14Analytics(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 14 — Dashboard y reportes ===");
  await loginAs(client, "contador");

  const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  for (const path of [
    "/api/dashboard/summary",
    `/api/dashboard/metrics?from=${from}&to=${to}`,
    "/api/dashboard/recent-sales?limit=10",
    "/api/dashboard/low-stock?limit=10",
  ]) {
    await client.step("14", `GET ${path.split("?")[0]}`, () => client.request(path));
  }

  for (const path of [
    `/api/reports/daily-sales?from=${from}&to=${to}&limit=15`,
    `/api/reports/gross-profit?from=${from}&to=${to}`,
    "/api/reports/product-profitability?limit=15",
    "/api/reports/low-stock?limit=15",
    "/api/reports/customer-purchases?limit=15",
    "/api/reports/supplier-purchases?limit=15",
    `/api/reports/top-products?from=${from}&to=${to}&limit=10`,
    `/api/reports/top-customers?from=${from}&to=${to}&limit=10`,
    `/api/reports/purchases?from=${from}&to=${to}&limit=15`,
  ]) {
    await client.step("14", `GET ${path.split("?")[0]}`, () => client.request(path));
  }

  const arrozId = manifest.productIds.arroz;
  if (arrozId) {
    await client.step("14", "GET /api/reports/stock-card", () =>
      client.request(`/api/reports/stock-card?productId=${arrozId}&limit=20`),
    );
  }

  await client.login(USERS.admin.email, USERS.admin.password);
}

export async function phase15Users(client: ApiClient, manifest: E2eManifest) {
  console.log("\n=== Fase 15 — Usuarios y permisos ===");
  await loginAs(client, "admin");

  await client.step("15", "GET /api/users", () => client.request("/api/users?limit=10"));

  await client.step("15", "PATCH /api/users/[id] vendedor grants", () =>
    client.request(`/api/users/${manifest.vendedorUserId}`, {
      method: "PATCH",
      body: JSON.stringify({
        grantedPermissions: ["contacts.manage"],
      }),
    }),
  );

  await loginAs(client, "vendedor");
  client.demoUserId = "user-seller";
  await client.step("15", "POST contacto como vendedor con grant", () =>
    client.request("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        name: "Cliente extra E2E",
        type: "cliente",
        phone: "04249998877",
      }),
    }),
  );

  await client.step("15", "GET /api/users como vendedor (403)", () => client.request("/api/users"), {
    expectStatus: 403,
  });

  await client.login(USERS.admin.email, USERS.admin.password);
}
