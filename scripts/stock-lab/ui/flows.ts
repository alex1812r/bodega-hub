/**
 * Flujos de la suite UI del laboratorio de stock (STK-404, plan stock-integrity
 * §8.3, hipótesis H8/H9): maneja la app real con Playwright, lee el estado
 * antes/después por SQL y compara lo que la UI DICE con lo que hay en la BASE.
 *
 * Aquí viven la fontanería (login por formulario, instantáneas SQL, alta de
 * datos por API) y los 10 flujos. La lógica pura está en helpers.ts.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Client } from "pg";
import type { Browser, BrowserContext, CDPSession, Locator, Page, Request } from "playwright";
import * as XLSX from "xlsx";

import { unwrapList, type ApiClient, type ApiResponse, type JsonRecord } from "../../e2e-bodegon/client";
import { LAB_PASSWORD, LAB_USERS, describeError, fetchRegisters, type LabRoleKey } from "../agents/base";
import {
  IMPORT_SHEET_NAME,
  adjustmentTypeProblems,
  buildImportRows,
  buildImportSheetAoa,
  diffNumberMaps,
  diffSnapshots,
  flowId,
  judgeLostResponse,
  judgeRejectionMessage,
  judgeUiVsDb,
  packUnits,
  parseStockInt,
  shotFileName,
  sumMovements,
  sumSaleItems,
  summarizeSalePosts,
  type CaseScope,
  type DbDiff,
  type DbSnapshot,
  type PosView,
  type RejectionMessageInput,
  type UiClaim,
  type UiResult,
  type UiStep,
  type Verdict,
} from "./helpers";

// ---------------------------------------------------------------------------
// Contexto del laboratorio
// ---------------------------------------------------------------------------

export type Lab = {
  run: string;
  /** `<run>-<nonce>`: hace únicos los SKU aunque se repita el run id. */
  tag: string;
  baseUrl: string;
  shotsDir: string;
  browser: Browser;
  db: Client;
  admin: ApiClient;
  seller: ApiClient;
  sellerKey: LabRoleKey;
  categoryId: string;
  categoryName: string;
  supplierId: string;
  supplierName: string;
  customerId: string;
  onResult: (result: UiResult) => void;
};

export type LabProduct = { id: string; sku: string; name: string; price: number };

const NAV_TIMEOUT = 30_000;
const UI_TIMEOUT = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return (error.stack ?? error.message).split("\n").slice(0, 6).join(" ⏎ ");
  return String(error);
}

function dataOf(res: ApiResponse): JsonRecord {
  const data = res.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Respuesta sin data (${res.status}): ${describeError(res)}`);
  }
  return data as JsonRecord;
}

async function api(client: ApiClient, method: string, path: string, body?: unknown): Promise<ApiResponse> {
  return client.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function apiOk(client: ApiClient, method: string, path: string, body?: unknown): Promise<JsonRecord> {
  const res = await api(client, method, path, body);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${describeError(res)}`);
  return dataOf(res);
}

// ---------------------------------------------------------------------------
// SQL: instantáneas y reconciliación
// ---------------------------------------------------------------------------

export async function snapshot(db: Client, productIds: readonly string[]): Promise<DbSnapshot> {
  const ids = [...productIds];
  const stockRows = await db.query<{ id: string; current_stock: string }>(
    "select id, current_stock from public.products where id = any($1::uuid[])",
    [ids],
  );
  const movements = await db.query(
    `select id, product_id, type::text as type, quantity_delta, stock_after, sale_id, purchase_id, conversion_id
       from public.stock_movements where product_id = any($1::uuid[]) order by seq, id`,
    [ids],
  );
  const saleItems = await db.query(
    "select id, sale_id, product_id, quantity from public.sale_items where product_id = any($1::uuid[]) order by id",
    [ids],
  );
  const saleIds = [...new Set(saleItems.rows.map((row) => String(row.sale_id)))];
  const sales = await db.query(
    `select id, invoice_number, status::text as status, client_request_id::text as client_request_id
       from public.sales where id = any($1::uuid[]) order by invoice_number, id`,
    [saleIds],
  );
  const purchases = await db.query(
    `select distinct pu.id, pu.purchase_number, pu.status::text as status
       from public.purchases pu join public.purchase_items pi on pi.purchase_id = pu.id
      where pi.product_id = any($1::uuid[]) order by pu.purchase_number`,
    [ids],
  );
  const purchaseIds = purchases.rows.map((row) => String(row.id));
  const payments = await db.query(
    `select id, sale_id, purchase_id, status::text as status from public.payments
      where sale_id = any($1::uuid[]) or purchase_id = any($2::uuid[]) order by id`,
    [saleIds, purchaseIds],
  );
  const stock: Record<string, number> = {};
  for (const row of stockRows.rows) stock[row.id] = Number(row.current_stock);
  return {
    stock,
    movements: movements.rows.map((row) => ({
      id: String(row.id),
      product_id: String(row.product_id),
      type: String(row.type),
      quantity_delta: Number(row.quantity_delta),
      stock_after: Number(row.stock_after),
      sale_id: row.sale_id ? String(row.sale_id) : null,
      purchase_id: row.purchase_id ? String(row.purchase_id) : null,
      conversion_id: row.conversion_id ? String(row.conversion_id) : null,
    })),
    sales: sales.rows.map((row) => ({
      id: String(row.id),
      invoice_number: String(row.invoice_number),
      status: String(row.status),
      client_request_id: row.client_request_id ? String(row.client_request_id) : null,
    })),
    saleItems: saleItems.rows.map((row) => ({
      id: String(row.id),
      sale_id: String(row.sale_id),
      product_id: String(row.product_id),
      quantity: Number(row.quantity),
    })),
    payments: payments.rows.map((row) => ({
      id: String(row.id),
      sale_id: row.sale_id ? String(row.sale_id) : null,
      purchase_id: row.purchase_id ? String(row.purchase_id) : null,
      status: String(row.status),
    })),
    purchases: purchases.rows.map((row) => ({
      id: String(row.id),
      purchase_number: String(row.purchase_number),
      status: String(row.status),
    })),
  };
}

async function countView(db: Client, sql: string, params: unknown[]): Promise<number> {
  try {
    const res = await db.query<{ n: string }>(sql, params);
    return Number(res.rows[0]?.n ?? 0);
  } catch {
    return -1; // vista ausente: no confundir con 0
  }
}

export async function reconcile(db: Client, productIds: readonly string[] | null): Promise<Record<string, number>> {
  const filter = productIds ? "and product_id = any($1::uuid[])" : "";
  const params = productIds ? [[...productIds]] : [];
  return {
    stock_reconciliation: await countView(
      db,
      `select count(*) as n from public.stock_reconciliation where diff <> 0 ${filter}`,
      params,
    ),
    stock_chain_breaks: await countView(
      db,
      `select count(*) as n from public.stock_chain_breaks where true ${filter}`,
      params,
    ),
  };
}

async function productIdsBySku(db: Client, skus: readonly string[]): Promise<Record<string, string>> {
  const res = await db.query<{ id: string; sku: string }>(
    "select id, lower(sku) as sku from public.products where lower(sku) = any($1::text[])",
    [skus.map((sku) => sku.toLowerCase())],
  );
  const out: Record<string, string> = {};
  for (const row of res.rows) out[row.sku] = row.id;
  return out;
}

// ---------------------------------------------------------------------------
// Datos propios por API (prefijo U404-<run>-)
// ---------------------------------------------------------------------------

type PackConversionInput = { unitsPerPack: number; unitKey: string };

async function createProduct(
  lab: Lab,
  key: string,
  opts: { stock: number; price?: number; pack?: PackConversionInput; supplier?: "linked" | "linked_with_pack_x12" },
): Promise<LabProduct & { unit?: LabProduct }> {
  const price = opts.price ?? 1;
  const sku = `U404-${lab.tag}-${key}`;
  const name = `U404 ${lab.tag} ${key}`;
  const body: JsonRecord = {
    sku,
    name,
    salePriceRef: price,
    currentCostRef: Number((price * 0.6).toFixed(2)),
    categoryId: lab.categoryId,
    minStock: 0,
    currentStock: 0,
  };
  let unitName = "";
  if (opts.pack) {
    unitName = `U404 ${lab.tag} ${opts.pack.unitKey}`;
    body.packConversion = {
      enabled: true,
      mode: "create_unit",
      unitsPerPack: opts.pack.unitsPerPack,
      unitProduct: {
        salePriceRef: 0.2,
        name: unitName,
        sku: `U404-${lab.tag}-${opts.pack.unitKey}`,
        currentCostRef: 0.1,
        barcode: null,
      },
    };
  }
  const created = await apiOk(lab.admin, "POST", "/api/products", body);
  const id = String(created.id);
  if (opts.stock > 0) {
    await apiOk(lab.admin, "POST", "/api/inventory/adjustments", {
      productId: id,
      quantityDelta: opts.stock,
      type: "inventario_inicial",
      reason: `STK-404 ${lab.run}`,
    });
  }
  const product: LabProduct & { unit?: LabProduct } = { id, sku: sku.toLowerCase(), name, price };
  if (opts.supplier) {
    // El formulario de compra solo ofrece productos del catálogo del proveedor.
    const link = await apiOk(lab.admin, "POST", "/api/supplier-products", {
      productId: id,
      supplierId: lab.supplierId,
      supplierSku: `P-${key}`,
      lastCostRef: 1,
      lastCostVes: 1,
      notes: `STK-404 ${lab.run}`,
    });
    if (opts.supplier === "linked_with_pack_x12") {
      await apiOk(lab.admin, "POST", `/api/supplier-products/${String(link.id)}/pack-units`, {
        label: "Bulto x12",
        unitsPerPack: 12,
        isDefault: false,
      });
    }
  }
  if (opts.pack) {
    const detail = await apiOk(lab.admin, "GET", `/api/products/${id}`);
    const conversion = detail.packConversion as JsonRecord | undefined;
    const unitRaw = (conversion?.unitProduct ?? conversion?.linkedProduct) as JsonRecord | undefined;
    const unitId = String(unitRaw?.id ?? conversion?.unitProductId ?? "");
    if (!unitId) throw new Error(`createProduct(${key}): no se pudo leer la unidad del par empaque.`);
    product.unit = {
      id: unitId,
      sku: `u404-${lab.tag}-${opts.pack.unitKey}`.toLowerCase(),
      name: unitName,
      price: 0.2,
    };
  }
  return product;
}

async function currentRate(lab: Lab): Promise<{ id: string; rateVes: number }> {
  const rate = await apiOk(lab.seller, "GET", "/api/exchange-rates/current");
  return { id: String(rate.id), rateVes: Number(rate.rateVes) };
}

/** Venta `pendiente_pago` por API: sin pagos, con su `clientRequestId` (obligatoria en `POST /api/sales`). */
async function apiUnpaidSale(lab: Lab, product: LabProduct, quantity: number): Promise<{ id: string; invoice: string }> {
  const rate = await currentRate(lab);
  const sale = await apiOk(lab.seller, "POST", "/api/sales", {
    clientRequestId: randomUUID(),
    customerId: lab.customerId,
    exchangeRateId: rate.id,
    refRateVes: rate.rateVes,
    items: [{ productId: product.id, quantity }],
    taxRef: 0,
    discountRef: 0,
    notes: `STK-404 ${lab.run}`,
  });
  return { id: String(sale.id), invoice: String(sale.invoiceNumber) };
}

/** Datos compartidos del run: sesión de caja abierta, categoría, proveedor, cliente por defecto. */
export async function prepareLab(base: Omit<Lab, "categoryId" | "categoryName" | "supplierId" | "supplierName" | "customerId">): Promise<Lab> {
  const sellerLogin = await base.seller.login(LAB_USERS[base.sellerKey].email, LAB_PASSWORD);
  if (!sellerLogin.ok) throw new Error(`login ${base.sellerKey} → ${sellerLogin.status}: ${describeError(sellerLogin)}`);
  const sellerId = String((dataOf(sellerLogin).user as JsonRecord).id);
  const adminLogin = await base.admin.login(LAB_USERS.admin.email, LAB_PASSWORD);
  if (!adminLogin.ok) throw new Error(`login admin → ${adminLogin.status}: ${describeError(adminLogin)}`);

  // Caja: asegurar sesión abierta del vendedor; nunca se cierra.
  const session = await api(base.seller, "GET", "/api/cash/session");
  if (!session.ok) throw new Error(`GET /api/cash/session → ${session.status}: ${describeError(session)}`);
  if (!session.body?.data) {
    const register = (await fetchRegisters(base.seller)).find((item) => item.assignedUserId === sellerId);
    if (!register) throw new Error(`El usuario ${base.sellerKey} no tiene caja asignada.`);
    await apiOk(base.seller, "POST", "/api/cash/session/open", {
      registerId: register.id,
      openingVes: 0,
      openingRef: 0,
    });
  }

  const categories = unwrapList(await api(base.admin, "GET", "/api/categories?limit=100")) as JsonRecord[];
  const category = categories.find((item) => item.isActive !== false);
  if (!category) throw new Error("La tienda lab no tiene categorías.");

  const contacts = unwrapList(await api(base.admin, "GET", "/api/contacts?limit=100")) as JsonRecord[];
  const supplier = contacts.find((item) => item.type === "proveedor" && item.isActive !== false);
  if (!supplier) throw new Error("La tienda lab no tiene proveedores.");
  const customers = unwrapList(await api(base.seller, "GET", "/api/contacts?type=cliente&limit=100")) as JsonRecord[];
  const customer = customers.find((item) => item.isPosDefault === true) ?? customers[0];
  if (!customer) throw new Error("La tienda lab no tiene cliente por defecto.");

  return {
    ...base,
    categoryId: String(category.id),
    categoryName: String(category.name),
    supplierId: String(supplier.id),
    supplierName: String(supplier.name),
    customerId: String(customer.id),
  };
}

// ---------------------------------------------------------------------------
// Registro de un caso
// ---------------------------------------------------------------------------

class CaseRec {
  readonly steps: UiStep[] = [];
  readonly says: string[] = [];
  readonly evidence: string[] = [];
  readonly contexts: BrowserContext[] = [];
  readonly pages: Page[] = [];
  readonly productIds = new Set<string>();
  readonly notes = new Set<string>();
  expected: Record<string, unknown> = {};
  actual: Record<string, unknown> = {};
  verdict: Verdict | null = null;
  detail = "";
  private shots = 0;

  constructor(
    readonly lab: Lab,
    readonly id: string,
  ) {}

  track(...products: (LabProduct | string)[]): void {
    for (const product of products) this.productIds.add(typeof product === "string" ? product : product.id);
  }

  step(op: string, extra: Omit<UiStep, "op"> = {}): void {
    this.steps.push({ op, ...extra });
  }

  /** Transcribe texto literal de la pantalla. */
  say(where: string, text: string | null | undefined): void {
    const clean = (text ?? "").replace(/\s+/g, " ").trim();
    this.says.push(`${where}: «${clean.slice(0, 500)}»`);
  }

  async shot(page: Page, step: string): Promise<string> {
    this.shots += 1;
    const file = join(this.lab.shotsDir, shotFileName(this.id.replace(".", "-"), this.shots, step));
    await page.screenshot({ path: file, fullPage: false, timeout: 15_000 });
    this.evidence.push(file);
    return file;
  }

  set(verdict: Verdict, detail = ""): void {
    this.verdict = verdict;
    this.detail = detail;
  }

  /** Observación lateral de UX: no cambia el veredicto, se añade al detalle. */
  note(text: string): void {
    this.notes.add(text);
  }

  /** Contexto de navegador nuevo + login REAL por el formulario de la app. */
  async open(role: LabRoleKey): Promise<Page> {
    const context = await this.lab.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-VE" });
    context.setDefaultTimeout(UI_TIMEOUT);
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
    this.contexts.push(context);
    const page = await context.newPage();
    this.pages.push(page);
    const started = Date.now();
    await page.goto(`${this.lab.baseUrl}/login`);
    await page.getByLabel("Correo").fill(LAB_USERS[role].email);
    await page.getByLabel("Clave").fill(LAB_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesion" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: NAV_TIMEOUT });
    this.step("UI login /login", { as: role, ms: Date.now() - started, note: new URL(page.url()).pathname });
    return page;
  }

  async goto(page: Page, path: string): Promise<void> {
    await page.goto(`${this.lab.baseUrl}${path}`);
    if (new URL(page.url()).pathname.startsWith("/login")) {
      throw new Error(`La navegación a ${path} acabó en /login (sesión perdida).`);
    }
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => undefined);
  }
}

/** `scope` por defecto `plan`: el caso decide el veredicto de su flujo (ver CaseScope). */
type CaseMeta = { n: number; sub?: string; title: string; hypothesis: string[]; scope?: CaseScope };

/** Ejecuta un caso aislado: su error no detiene los demás (`error` ≠ `fail`). */
async function runCase(lab: Lab, meta: CaseMeta, body: (rec: CaseRec) => Promise<void>): Promise<void> {
  const id = meta.sub ? `${flowId(meta.n)}.${meta.sub}` : flowId(meta.n);
  const rec = new CaseRec(lab, id);
  try {
    await body(rec);
    if (rec.verdict === null) throw new Error("El caso terminó sin veredicto.");
  } catch (error) {
    rec.set("error", errorText(error));
    for (const page of rec.pages) {
      if (page.isClosed()) continue;
      await rec.shot(page, "error").catch(() => undefined);
      try {
        const aria = await page.locator("body").ariaSnapshot({ timeout: 5_000 });
        const file = join(lab.shotsDir, `${id.replace(".", "-")}-error.aria.txt`);
        writeFileSync(file, `${page.url()}\n${aria}`, "utf8");
        rec.evidence.push(file);
      } catch {
        // la página ya no responde: basta con la traza
      }
    }
  } finally {
    for (const page of rec.pages) {
      if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    }
    for (const context of rec.contexts) await context.close().catch(() => undefined);
  }
  const ids = [...rec.productIds];
  let scoped: Record<string, number> = {};
  let global: Record<string, number> = {};
  try {
    scoped = ids.length > 0 ? await reconcile(lab.db, ids) : {};
    global = await reconcile(lab.db, null);
  } catch {
    // la base dejó de responder: el veredicto del caso ya está decidido
  }
  lab.onResult({
    ts: new Date().toISOString(),
    suite: "ui",
    id,
    scope: meta.scope ?? "plan",
    title: meta.title,
    hypothesis: meta.hypothesis,
    steps: rec.steps,
    ui_says: rec.says,
    expected: rec.expected,
    actual: rec.actual,
    reconcile_scoped: scoped,
    reconcile_global: global,
    verdict: rec.verdict ?? "error",
    detail: [rec.detail, rec.notes.size > 0 ? `Notas UX: ${[...rec.notes].join("; ")}.` : ""].filter(Boolean).join(" "),
    evidence: rec.evidence,
  });
}

// ---------------------------------------------------------------------------
// Lectura genérica de pantalla
// ---------------------------------------------------------------------------

/** Texto visible de alertas, diálogos y avisos (no hay toasts en la app: todo es inline). */
async function screenTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const nodes = document.querySelectorAll(
      '[role="alert"],[role="status"],[role="dialog"],[role="alertdialog"],[role="note"]',
    );
    nodes.forEach((node) => {
      const element = node as HTMLElement;
      if (element.offsetParent === null && getComputedStyle(element).position !== "fixed") return;
      // Los <select> vuelcan todas sus opciones en innerText: se ocultan al leer.
      const selects = Array.from(element.querySelectorAll("select"));
      selects.forEach((select) => {
        select.style.display = "none";
      });
      const text = (element.innerText ?? "").replace(/\s+/g, " ").trim();
      selects.forEach((select) => {
        select.style.display = "";
      });
      if (text) out.push(`[${element.getAttribute("role")}] ${text}`);
    });
    return out;
  });
}

/** Texto de un diálogo sin el volcado de opciones de sus <select> (solo la elegida). */
async function dialogText(dialog: Locator): Promise<string> {
  return dialog.evaluate((element) => {
    const selects = Array.from(element.querySelectorAll("select"));
    const chosen = selects.map((select) => select.selectedOptions[0]?.text ?? "");
    selects.forEach((select) => {
      select.style.display = "none";
    });
    const text = ((element as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
    selects.forEach((select) => {
      select.style.display = "";
    });
    return chosen.length > 0 ? `${text} [selectores: ${chosen.join(" | ")}]` : text;
  });
}

/** Texto y caja de un mensaje TAL COMO ESTÁ: `boundingBox` no desplaza la página. */
type SeenMessage = Pick<RejectionMessageInput, "text" | "box" | "viewport">;

async function measureMessage(page: Page, message: Locator): Promise<SeenMessage> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  if ((await message.count()) === 0) return { text: null, box: null, viewport };
  const target = message.first();
  return { text: (await target.innerText()).replace(/\s+/g, " ").trim(), box: await target.boundingBox(), viewport };
}

async function sayScreen(rec: CaseRec, page: Page, where: string): Promise<string[]> {
  const texts = await screenTexts(page);
  if (texts.length === 0) rec.say(where, "(sin alertas ni diálogos visibles)");
  for (const text of texts) rec.say(where, text);
  return texts;
}

type TableData = { headers: string[]; rows: string[][] };

async function readTable(page: Page): Promise<TableData> {
  const table = page.locator("main table").first();
  await table.waitFor({ state: "visible", timeout: UI_TIMEOUT });
  // Sin funciones con nombre dentro de evaluate: tsx (esbuild keepNames) inyecta
  // `__name`, que no existe en el navegador.
  return table.evaluate((element) => ({
    headers: Array.from(element.querySelectorAll("thead th")).map((node) =>
      ((node as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim(),
    ),
    rows: Array.from(element.querySelectorAll("tbody tr")).map((row) =>
      Array.from(row.querySelectorAll("td")).map((node) =>
        ((node as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim(),
      ),
    ),
  }));
}

function column(table: TableData, header: RegExp): number {
  return table.headers.findIndex((text) => header.test(text));
}

type UiMovement = { type: string; quantity: number | null; stockAfter: number | null; raw: string };

/**
 * Abre /inventory/movements (admin), filtra por el producto con el selector
 * de la pantalla y devuelve las filas que la UI muestra para él.
 */
async function uiMovements(rec: CaseRec, page: Page, product: LabProduct, shotName: string): Promise<UiMovement[]> {
  await rec.goto(page, "/inventory/movements");
  const select = page.getByLabel("Producto", { exact: true });
  await select.waitFor({ state: "visible" });
  await select.locator("option").nth(1).waitFor({ state: "attached", timeout: NAV_TIMEOUT });
  const option = select.locator("option", { hasText: product.name });
  let filteredBy = "selector Producto";
  if ((await option.count()) > 0) {
    await select.selectOption({ label: (await option.first().innerText()).trim() });
  } else {
    // El selector solo lista una página de productos: se anota y se usa el filtro por URL.
    filteredBy = "URL ?productId= (el producto NO aparece en el selector Producto)";
    rec.say("/inventory/movements selector Producto", `no lista «${product.name}» (${await select.locator("option").count()} opciones)`);
    rec.note("el filtro «Producto» de /inventory/movements solo carga 100 productos: los demás solo se alcanzan por el enlace Kardex (?productId=)");
    await rec.goto(page, `/inventory/movements?productId=${product.id}`);
  }
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => undefined);
  await page.waitForTimeout(600);
  const table = await readTable(page);
  const iSku = column(table, /^SKU/i);
  const iType = column(table, /^Tipo/i);
  const iQty = column(table, /^Cant/i);
  const iStock = column(table, /^Stock final/i);
  const rows = table.rows
    .filter((row) => (row[iSku] ?? "").toLowerCase() === product.sku)
    .map((row) => ({
      type: row[iType] ?? "",
      quantity: parseStockInt(row[iQty]),
      stockAfter: parseStockInt(row[iStock]),
      raw: row.slice(0, -1).join(" | "),
    }));
  rec.step("UI /inventory/movements", { as: "admin", note: `${filteredBy}; ${rows.length} filas de ${product.sku}` });
  if (rows.length === 0) rec.say(`/inventory/movements ${product.sku}`, "(ninguna fila para este producto)");
  for (const row of rows) rec.say(`/inventory/movements ${product.sku}`, row.raw);
  await rec.shot(page, shotName);
  return rows;
}

/** Stock que muestra el detalle del producto (tarjeta «Stock actual»). */
async function uiProductStock(rec: CaseRec, page: Page, product: LabProduct, shotName: string): Promise<number | null> {
  await rec.goto(page, `/products/${product.id}`);
  await page.getByRole("heading", { name: product.name }).waitFor({ state: "visible" });
  const card = page.locator("section,div").filter({ has: page.getByRole("heading", { name: "Stock actual" }) }).last();
  const text = (await card.innerText()).replace(/\s+/g, " ").trim();
  rec.say(`/products/${product.sku} Stock actual`, text);
  await rec.shot(page, shotName);
  const match = /Stock actual\s*(-?[\d.,]+)\s*unidad/i.exec(text);
  return parseStockInt(match?.[1]);
}

// ---------------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------------

type SaleNet = { bodies: (string | null)[]; statuses: number[]; failures: string[] };

function watchSalePosts(page: Page): SaleNet {
  const net: SaleNet = { bodies: [], statuses: [], failures: [] };
  const isSalePost = (request: Request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/sales";
  page.on("request", (request) => {
    if (isSalePost(request)) net.bodies.push(request.postData());
  });
  page.on("response", (response) => {
    if (isSalePost(response.request())) net.statuses.push(response.status());
  });
  page.on("requestfailed", (request) => {
    if (isSalePost(request)) net.failures.push(request.failure()?.errorText ?? "failed");
  });
  return net;
}

function processButton(page: Page): Locator {
  return page.getByRole("button", { name: /Procesar venta|Procesando/ });
}

function cartPanel(page: Page): Locator {
  return page.locator("aside").filter({ has: page.getByRole("heading", { name: "Carrito" }) });
}

function cartLine(page: Page, product: LabProduct): Locator {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Aumentar cantidad" }) })
    .filter({ hasText: product.name });
}

async function openPos(rec: CaseRec, page: Page): Promise<void> {
  await rec.goto(page, "/sales/create");
  const search = page.getByRole("searchbox", { name: "Buscar productos" });
  const closed = page.getByRole("heading", { name: /Caja cerrada|Sin caja asignada/ });
  await search.or(closed).first().waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  if (await closed.isVisible()) {
    throw new Error(`El POS no deja vender: «${await closed.innerText()}» (la sesión de caja no está abierta).`);
  }
}

/** Busca el producto por nombre y pulsa su tarjeta `clicks` veces. */
async function posAdd(page: Page, product: LabProduct, clicks: number): Promise<void> {
  const search = page.getByRole("searchbox", { name: "Buscar productos" });
  await search.fill(product.name);
  const card = page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: product.name, exact: true }) });
  await card.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  for (let i = 0; i < clicks; i += 1) await card.click();
  await search.fill("");
}

async function posQty(page: Page, product: LabProduct): Promise<number | null> {
  const line = cartLine(page, product);
  if ((await line.count()) === 0) return null;
  const text = await line
    .getByRole("button", { name: "Reducir cantidad" })
    .locator("xpath=following-sibling::span[1]")
    .innerText();
  return parseStockInt(text);
}

async function posCartCount(page: Page): Promise<number> {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Aumentar cantidad" }) })
    .count();
}

/** Elige un método de pago sin datos adicionales (efectivo en bolívares) y devuelve su etiqueta. */
async function posPickCash(page: Page): Promise<string> {
  const group = page.getByRole("group", { name: "Metodo de pago" });
  const buttons = group.getByRole("button");
  const labels = await buttons.allInnerTexts();
  const wanted =
    labels.find((label) => /efectivo/i.test(label) && /(bs|ves|bol)/i.test(label)) ??
    labels.find((label) => /efectivo/i.test(label));
  if (!wanted) throw new Error(`El POS no ofrece efectivo. Métodos: ${labels.join(", ")}`);
  await buttons.filter({ hasText: wanted }).first().click();
  return wanted.trim();
}

type PosOutcome = {
  claim: UiClaim;
  invoice: string | null;
  text: string;
  button: string;
  buttonDisabled: boolean;
  cartLines: number;
  /** El aviso trae el botón «Verificar» (cobro de resultado desconocido). */
  verifyOffered: boolean;
};

function verifyButton(page: Page): Locator {
  return page.getByRole("button", { name: "Verificar", exact: true });
}

function toView(outcome: PosOutcome): PosView {
  return { claim: outcome.claim, text: outcome.text, invoice: outcome.invoice, verifyOffered: outcome.verifyOffered };
}

/** Qué afirma el POS tras pulsar: «Venta registrada», un error, o nada dentro del plazo. */
async function posOutcome(page: Page, timeoutMs: number): Promise<PosOutcome> {
  const success = page.getByText("Venta registrada", { exact: true });
  const failure = cartPanel(page).locator('[role="alert"]').or(page.getByText("Revisa la venta", { exact: true }));
  let claim: UiClaim = "none";
  try {
    await success.or(failure).first().waitFor({ state: "visible", timeout: timeoutMs });
    claim = (await success.isVisible()) ? "success" : "error";
  } catch {
    claim = "none";
  }
  let text = "";
  let invoice: string | null = null;
  if (claim === "success") {
    text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    const match = /Venta registrada\s*Factura\s*([^\s.]+)/.exec(text);
    invoice = match?.[1] ?? null;
    text = /Venta registrada.*?opcion\.?/.exec(text)?.[0] ?? text.slice(0, 200);
  } else if (claim === "error") {
    text = (await failure.first().innerText().catch(() => "")).replace(/\s+/g, " ");
    const alert = cartPanel(page).locator('[role="alert"]');
    if (await alert.isVisible().catch(() => false)) text = (await alert.innerText()).replace(/\s+/g, " ");
  }
  const button = processButton(page);
  const hasButton = (await button.count()) > 0;
  return {
    claim,
    invoice,
    text,
    button: hasButton ? (await button.innerText()).trim() : "(sin botón: pantalla de éxito)",
    buttonDisabled: hasButton ? await button.isDisabled() : false,
    cartLines: await posCartCount(page),
    verifyOffered: claim !== "success" && (await verifyButton(page).isVisible().catch(() => false)),
  };
}

/**
 * Como posOutcome, pero espera antes a que el POS termine lo que tenga en curso
 * (cobro o consulta por clave: el botón dice «Procesando...»), para no leer el
 * aviso de la acción anterior.
 */
async function posSettled(page: Page, timeoutMs: number): Promise<PosOutcome> {
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /Procesando/ }).waitFor({ state: "hidden", timeout: timeoutMs }).catch(() => undefined);
  return posOutcome(page, timeoutMs);
}

function sayOutcome(rec: CaseRec, where: string, outcome: PosOutcome): void {
  rec.say(
    where,
    `UI=${outcome.claim}; texto="${outcome.text}"; botón="${outcome.button}"${outcome.buttonDisabled ? " (deshabilitado)" : ""}; «Verificar»=${outcome.verifyOffered ? "sí" : "no"}; líneas en carrito=${outcome.cartLines}`,
  );
}

/** Vuelve del overlay de éxito al POS (el overlay se cierra solo a los 5 s). */
async function posDismissSuccess(page: Page): Promise<void> {
  const again = page.getByRole("button", { name: "Nueva venta" });
  if (await again.isVisible().catch(() => false)) await again.click().catch(() => undefined);
}

const SLOW_3G = { offline: false, latency: 2000, downloadThroughput: 50_000, uploadThroughput: 50_000 };
const NO_THROTTLE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

async function throttle(page: Page, conditions: typeof SLOW_3G): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", conditions);
  return cdp;
}

function saleExpectations(product: LabProduct, quantity: number) {
  return {
    sales: 1,
    sale_items: 1,
    payments: 1,
    stock_delta: { [product.sku]: -quantity },
    movements: [{ type: "venta", quantity_delta: -quantity }],
  };
}

function saleActual(diff: DbDiff, product: LabProduct) {
  return {
    sales: diff.sales.length,
    sale_ids: diff.sales.map((sale) => `${sale.invoice_number} (${sale.status})`),
    client_request_ids_db: diff.sales.map((sale) => sale.client_request_id),
    sale_items: diff.saleItems.length,
    payments: diff.payments.length,
    stock_delta: { [product.sku]: diff.stockDelta[product.id] ?? 0 },
    movements: diff.movements.map((m) => ({ type: m.type, quantity_delta: m.quantity_delta, stock_after: m.stock_after })),
  };
}

/** Diferencias contra «exactamente una venta de `quantity` unidades». Vacío = sano. */
function singleSaleProblems(diff: DbDiff, product: LabProduct, quantity: number): string[] {
  const problems: string[] = [];
  if (diff.sales.length !== 1) problems.push(`ventas: esperado 1, real ${diff.sales.length}`);
  if (diff.saleItems.length !== 1) problems.push(`sale_items: esperado 1, real ${diff.saleItems.length}`);
  if (diff.payments.length !== 1) problems.push(`pagos: esperado 1, real ${diff.payments.length}`);
  const moves = diff.movements.filter((m) => m.type === "venta");
  if (moves.length !== 1) problems.push(`movimientos venta: esperado 1, real ${moves.length}`);
  if (diff.movements.length !== moves.length) {
    problems.push(`movimientos de otro tipo: ${diff.movements.filter((m) => m.type !== "venta").map((m) => m.type).join(",")}`);
  }
  const delta = diff.stockDelta[product.id] ?? 0;
  if (delta !== -quantity) problems.push(`stock: esperado ${-quantity}, real ${delta}`);
  return problems;
}

// ---------------------------------------------------------------------------
// F1 · POS: vender y verificar movimientos y stock en pantalla
// ---------------------------------------------------------------------------

async function flow01(lab: Lab): Promise<void> {
  await runCase(
    lab,
    { n: 1, title: "POS: venta de 3 líneas → movimiento y stock exactos en UI y base", hypothesis: ["H8"] },
    async (rec) => {
      const a = await createProduct(lab, "F1-ALFA", { stock: 20, price: 1 });
      const b = await createProduct(lab, "F1-BETA", { stock: 20, price: 2 });
      const c = await createProduct(lab, "F1-GAMA", { stock: 20, price: 0.5 });
      const products = [a, b, c];
      rec.track(...products);
      const labels = Object.fromEntries(products.map((p) => [p.id, p.sku]));
      const before = await snapshot(lab.db, products.map((p) => p.id));

      const page = await rec.open(lab.sellerKey);
      const net = watchSalePosts(page);
      await openPos(rec, page);
      // El carrito del POS no tiene campo de cantidad tecleable: solo tarjeta, «+» y «−».
      await posAdd(page, a, 1);
      await cartLine(page, a).getByRole("button", { name: "Aumentar cantidad" }).click();
      await cartLine(page, a).getByRole("button", { name: "Aumentar cantidad" }).click();
      await posAdd(page, b, 2);
      await posAdd(page, c, 1);
      for (let i = 0; i < 4; i += 1) await cartLine(page, c).getByRole("button", { name: "Aumentar cantidad" }).click();
      await cartLine(page, c).getByRole("button", { name: "Reducir cantidad" }).click();
      const typed: Record<string, number> = { [a.id]: 3, [b.id]: 2, [c.id]: 4 };
      const shown: Record<string, number> = {};
      for (const product of products) shown[product.id] = (await posQty(page, product)) ?? 0;
      const hasQtyInput = (await cartPanel(page).locator('input[type="number"]').count()) > 0;
      rec.say("POS carrito", (await cartPanel(page).innerText()).slice(0, 400));
      rec.say("POS carrito campo de cantidad tecleable", hasQtyInput ? "sí" : "no existe (solo botones + y −)");
      const method = await posPickCash(page);
      rec.step("UI POS carrito", { as: lab.sellerKey, note: `método ${method}; a=3 (clic + «+»×2), b=2 (clic×2), c=4 (clic, «+»×4, «−»×1)` });
      await rec.shot(page, "carrito");

      await processButton(page).click();
      const outcome = await posOutcome(page, 30_000);
      await rec.shot(page, "tras-procesar");
      sayOutcome(rec, "POS tras Procesar venta", outcome);
      rec.step("UI clic Procesar venta", { status: net.statuses[0], note: `POST /api/sales enviados=${net.bodies.length}` });

      await sleep(500);
      const diff = diffSnapshots(before, await snapshot(lab.db, products.map((p) => p.id)));
      const sold = sumSaleItems(diff.saleItems);
      const moved = sumMovements(diff.movements, ["venta"]);
      const negTyped = Object.fromEntries(Object.entries(typed).map(([id, q]) => [id, -q]));

      // La UI de inventario (admin: el vendedor no tiene inventory.view).
      const adminPage = await rec.open("admin");
      const uiProblems: string[] = [];
      for (const product of products) {
        const rows = await uiMovements(rec, adminPage, product, `movimientos-${product.sku.slice(-4)}`);
        const sale = rows.filter((row) => /^venta$/i.test(row.type));
        const want = typed[product.id] ?? 0;
        const dbStock = (before.stock[product.id] ?? 0) + (diff.stockDelta[product.id] ?? 0);
        if (sale.length !== 1 || sale[0]?.quantity !== -want || sale[0]?.stockAfter !== dbStock) {
          uiProblems.push(
            `${product.sku}: /inventory/movements muestra ${sale.length} fila(s) Venta (${sale.map((r) => `${r.quantity}→${r.stockAfter}`).join(";")}), esperado 1 de ${-want}→${dbStock}`,
          );
        }
        const uiStock = await uiProductStock(rec, adminPage, product, `detalle-${product.sku.slice(-4)}`);
        if (uiStock !== dbStock) uiProblems.push(`${product.sku}: el detalle muestra stock ${uiStock}, la base ${dbStock}`);
      }

      rec.expected = {
        cart_shown_equals_clicked: typed,
        sales: 1,
        sale_items: negTyped,
        stock_delta: negTyped,
        ui_movements: "1 fila Venta por producto con la cantidad y el stock final de la base",
      };
      rec.actual = {
        cart_shown: shown,
        post_sales: summarizeSalePosts(net.bodies),
        ui_invoice: outcome.invoice,
        db_sales: diff.sales,
        sale_items: sold,
        movements_venta: moved,
        stock_delta: diff.stockDelta,
        payments: diff.payments.length,
        ui_problems: uiProblems,
      };

      const problems = [
        ...diffNumberMaps(typed, shown, labels).map((d) => `carrito ≠ pulsado · ${d}`),
        ...diffNumberMaps(typed, sold, labels).map((d) => `sale_items ≠ carrito · ${d}`),
        ...diffNumberMaps(negTyped, moved, labels).map((d) => `movimientos venta · ${d}`),
        ...diffNumberMaps(negTyped, diff.stockDelta, labels).map((d) => `stock · ${d}`),
        ...uiProblems,
      ];
      const judged = judgeUiVsDb({ what: "venta(s)", uiClaim: outcome.claim, expectedDocs: 1, createdDocs: diff.sales.length });
      if (judged.verdict === "fail") problems.unshift(judged.detail);
      if (outcome.claim === "success" && diff.sales[0] && outcome.invoice !== diff.sales[0].invoice_number) {
        problems.push(`la UI anuncia la factura ${outcome.invoice} y la base tiene ${diff.sales[0].invoice_number}`);
      }
      if (problems.length > 0) rec.set("fail", problems.join(" · "));
      else rec.set("pass", hasQtyInput ? "" : "Nota: el carrito del POS no permite teclear la cantidad; solo «+»/«−» y clics en la tarjeta.");
    },
  );
}

// ---------------------------------------------------------------------------
// F2 · POS con red lenta: doble clic / triple clic + Enter
// ---------------------------------------------------------------------------

async function flow02(lab: Lab): Promise<void> {
  const variants: { sub: string; key: string; scope: CaseScope; title: string; act: (page: Page) => Promise<void> }[] = [
    {
      sub: "double_click",
      key: "F2-DOBLE",
      scope: "plan",
      title: "POS 3G lento: doble clic en Procesar venta → una sola venta",
      act: async (page) => {
        await processButton(page).dblclick();
      },
    },
    {
      // Con entrada real React deshabilita el botón dentro del primer clic y el
      // segundo ya no llega al manejador (STK-408 §2.1). Tres click() en la misma
      // tarea JS sí entran con el botón aún habilitado: ejercitan el candado.
      sub: "same_tick_clicks",
      key: "F2-TICK",
      scope: "extra",
      title: "POS 3G lento: 3 clics en la misma tarea JS (botón aún habilitado) → una sola venta",
      act: async (page) => {
        await processButton(page).evaluate((element) => {
          const button = element as HTMLButtonElement;
          button.click();
          button.click();
          button.click();
        });
      },
    },
    {
      sub: "triple_click_enter",
      key: "F2-TRIPLE",
      scope: "extra",
      title: "POS 3G lento: triple clic + Enter en Procesar venta → una sola venta",
      act: async (page) => {
        await processButton(page).click({ clickCount: 3, delay: 20 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
        await page.keyboard.press("Enter");
        await processButton(page).click({ force: true, timeout: 1_500 }).catch(() => undefined);
      },
    },
  ];
  for (const variant of variants) {
    await runCase(lab, { n: 2, sub: variant.sub, scope: variant.scope, title: variant.title, hypothesis: ["H8"] }, async (rec) => {
      const quantity = 2;
      const product = await createProduct(lab, variant.key, { stock: 20 });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open(lab.sellerKey);
      const net = watchSalePosts(page);
      await openPos(rec, page);
      await posAdd(page, product, quantity);
      await posPickCash(page);
      await rec.shot(page, "carrito");

      const cdp = await throttle(page, SLOW_3G);
      rec.step("CDP Network.emulateNetworkConditions", { note: JSON.stringify(SLOW_3G) });
      try {
        await variant.act(page);
        await page.waitForTimeout(400);
        const during = await posOutcome(page, 1);
        sayOutcome(rec, "POS justo tras los clics (petición en vuelo)", during);
        await rec.shot(page, "en-vuelo");
        const outcome = await posOutcome(page, 60_000);
        await rec.shot(page, "resultado");
        sayOutcome(rec, "POS resultado", outcome);

        await cdp.send("Network.emulateNetworkConditions", NO_THROTTLE);
        await sleep(1_500); // margen para un posible segundo POST tardío
        const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
        const posts = summarizeSalePosts(net.bodies);
        rec.step("UI clics en Procesar venta", { status: net.statuses[0], note: `POST /api/sales enviados=${posts.requests}` });
        rec.expected = saleExpectations(product, quantity);
        rec.actual = { ...saleActual(diff, product), post_sales: posts, post_statuses: net.statuses, ui_claim: outcome.claim, ui_invoice: outcome.invoice };

        const problems = singleSaleProblems(diff, product, quantity);
        const judged = judgeUiVsDb({ what: "venta(s)", uiClaim: outcome.claim, expectedDocs: 1, createdDocs: diff.sales.length });
        if (judged.verdict === "fail") problems.unshift(judged.detail);
        if (outcome.claim === "success" && diff.sales[0] && outcome.invoice !== diff.sales[0].invoice_number) {
          problems.push(`la UI anuncia la factura ${outcome.invoice} y la base tiene ${diff.sales[0].invoice_number}`);
        }
        const info = `POST /api/sales enviados: ${posts.requests} (clientRequestId distintos: ${posts.distinctClientRequestIds}); ventas en base: ${diff.sales.length}.`;
        if (problems.length > 0) rec.set("fail", `${problems.join(" · ")} · ${info}`);
        else if (posts.requests > 1) rec.set("finding", `Una sola venta gracias a la idempotencia del servidor, pero el navegador envió ${posts.requests} POST: el candado del cliente no frenó el doble envío. ${info}`);
        else rec.set("pass", info);
      } finally {
        await cdp.send("Network.emulateNetworkConditions", NO_THROTTLE).catch(() => undefined);
        await cdp.detach().catch(() => undefined);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// F3 · POS: cortar la red alrededor del POST /api/sales
// ---------------------------------------------------------------------------

const SALES_ROUTE = "**/api/sales";
/** `GET /api/sales/by-request/<clave>`: lo que el POS consulta cuando no sabe si el cobro quedó. */
const SALE_LOOKUP_ROUTE = "**/api/sales/by-request/**";

/** Qué hace el cajero con un cobro cuya respuesta se perdió. */
type CashierAction = "none" | "verify" | "reload" | "clear_order" | "leave_and_return";

const CASHIER_ACTION_LABEL: Record<CashierAction, string> = {
  none: "no hace nada (el POS consulta por la clave)",
  verify: "pulsa «Verificar»",
  reload: "recarga, rehace el carrito y pulsa «Procesar venta»",
  clear_order: "pulsa «Limpiar orden»",
  leave_and_return: "sale a /sales, vuelve al POS, rehace el carrito y pulsa «Procesar venta»",
};

async function posReady(page: Page): Promise<void> {
  await page.getByRole("searchbox", { name: "Buscar productos" }).waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => undefined);
}

async function flow03(lab: Lab): Promise<void> {
  const quantity = 2;

  // (i) La petición no llega al servidor: no hay venta; el reintento crea UNA.
  await runCase(
    lab,
    {
      n: 3,
      sub: "i_abort_before_server",
      scope: "extra",
      title: "POS: la petición se corta ANTES de llegar al servidor → reintento → una venta",
      hypothesis: ["H8"],
    },
    async (rec) => {
      const product = await createProduct(lab, "F3-ANTES", { stock: 20 });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open(lab.sellerKey);
      const net = watchSalePosts(page);
      await openPos(rec, page);
      await posAdd(page, product, quantity);
      await posPickCash(page);
      await page.route(SALES_ROUTE, (route) =>
        route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
      );
      rec.step("page.route POST /api/sales → abort(internetdisconnected)");
      await rec.shot(page, "carrito");

      await processButton(page).click();
      const cut = await posSettled(page, 20_000);
      await rec.shot(page, "tras-corte");
      sayOutcome(rec, "POS con la red cortada", cut);
      await sleep(3_000); // ¿reintenta sola?
      const postsAfterCut = net.bodies.length;
      const midDiff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      rec.step("UI clic Procesar venta (red cortada)", {
        note: `POST enviados=${postsAfterCut}; fallos de red=${net.failures.join(",") || "ninguno"}; ventas en base=${midDiff.sales.length}`,
      });

      await page.unroute(SALES_ROUTE).catch(() => undefined);
      let retry: PosOutcome | null = null;
      if (cut.claim !== "success" && (await processButton(page).count()) > 0) {
        await processButton(page).click({ timeout: 10_000 });
        retry = await posSettled(page, 30_000);
        await rec.shot(page, "tras-reintento");
        sayOutcome(rec, "POS al pulsar Procesar venta OTRA VEZ con red", retry);
      }
      await sleep(800);
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const posts = summarizeSalePosts(net.bodies);
      rec.step("UI segundo clic Procesar venta", {
        note: `POST totales=${posts.requests}; clientRequestId distintos=${posts.distinctClientRequestIds}; estados HTTP=${net.statuses.join(",")}`,
      });

      rec.expected = {
        ...saleExpectations(product, quantity),
        ui_with_network_cut: "error o aviso, nunca éxito; el carrito no se vacía",
        auto_retry: 0,
        same_client_request_id_on_retry: true,
      };
      rec.actual = {
        ...saleActual(diff, product),
        ui_with_network_cut: { claim: cut.claim, text: cut.text, cart_lines: cut.cartLines, button: cut.button },
        sales_in_db_while_ui_showed_cut: midDiff.sales.length,
        posts_before_manual_retry: postsAfterCut,
        post_sales: posts,
        post_statuses: net.statuses,
        ui_after_retry: retry ? { claim: retry.claim, text: retry.text, invoice: retry.invoice } : null,
      };

      const info = `Con la red cortada la UI dijo ${cut.claim} («${cut.text}»), carrito con ${cut.cartLines} línea(s), ${postsAfterCut} POST, ${midDiff.sales.length} venta(s) en base; tras reintentar: UI ${retry?.claim ?? "—"}, ${posts.requests} POST con ${posts.distinctClientRequestIds} clientRequestId distinto(s), ${diff.sales.length} venta(s) en base.`;
      const problems = singleSaleProblems(diff, product, quantity);
      if (cut.claim === "success") problems.unshift("Éxito falso: la UI afirmó «Venta registrada» sin que la petición llegara al servidor.");
      if (midDiff.sales.length > 0) problems.push(`la base tiene ${midDiff.sales.length} venta(s) con la petición abortada antes del servidor`);
      if (cut.claim !== "success" && cut.cartLines === 0) problems.push("la UI vació el carrito sin haber confirmado la venta");
      if (postsAfterCut > 1) problems.push(`el cliente reintentó solo (${postsAfterCut} POST antes del segundo clic)`);
      if (retry?.claim !== "success") problems.push(`el reintento con red no acabó en «Venta registrada» (${retry?.claim ?? "sin reintento"}: «${retry?.text ?? ""}»)`);
      else if (diff.sales[0] && retry.invoice !== diff.sales[0].invoice_number) problems.push(`la UI anuncia la factura ${retry.invoice} y la base tiene ${diff.sales[0].invoice_number}`);
      if (problems.length > 0) rec.set("fail", `${problems.join(" · ")} · ${info}`);
      else if (posts.distinctClientRequestIds > 1) rec.set("finding", `Una sola venta, pero el reintento estrenó clave de idempotencia. ${info}`);
      else rec.set("pass", info);
    },
  );

  // La venta se confirma en el servidor y la RESPUESTA se pierde. Con `lookupDown`
  // tampoco responde la consulta por clave: el POS no puede saber si cobró.
  const lostResponseCase = async (spec: {
    sub: string;
    key: string;
    title: string;
    lookupDown: boolean;
    action: CashierAction;
  }) => {
    await runCase(lab, { n: 3, sub: spec.sub, title: spec.title, hypothesis: ["H8"] }, async (rec) => {
      const product = await createProduct(lab, spec.key, { stock: 20 });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open(lab.sellerKey);
      const net = watchSalePosts(page);
      const lookups: string[] = [];
      page.on("requestfinished", (request) => {
        if (/\/api\/sales\/by-request\//.test(request.url())) void request.response().then((response) => lookups.push(String(response?.status() ?? "sin respuesta")));
      });
      page.on("requestfailed", (request) => {
        if (/\/api\/sales\/by-request\//.test(request.url())) lookups.push(request.failure()?.errorText ?? "failed");
      });
      await openPos(rec, page);
      await posAdd(page, product, quantity);
      await posPickCash(page);
      await page.route(SALES_ROUTE, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        rec.step("servidor respondió (respuesta descartada)", { status: response.status() });
        return route.abort("connectionreset");
      });
      rec.step("page.route POST /api/sales → route.fetch() y abort(connectionreset)");
      if (spec.lookupDown) {
        await page.route(SALE_LOOKUP_ROUTE, (route) => route.abort("internetdisconnected"));
        rec.step("page.route GET /api/sales/by-request/* → abort(internetdisconnected)");
      }
      const restoreNetwork = async () => {
        await page.unroute(SALES_ROUTE).catch(() => undefined);
        await page.unroute(SALE_LOOKUP_ROUTE).catch(() => undefined);
        rec.step("red restaurada (page.unroute)");
      };
      await rec.shot(page, "carrito");

      await processButton(page).click();
      const atCut = await posSettled(page, 20_000);
      await rec.shot(page, "tras-corte");
      sayOutcome(rec, "POS justo tras perderse la respuesta", atCut);
      await sleep(3_000); // ¿reintenta sola?
      const postsAtCut = net.bodies.length;
      const mid = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      rec.step("UI clic Procesar venta (respuesta perdida)", {
        note: `POST enviados=${postsAtCut}; fallos de red=${net.failures.join(",") || "ninguno"}; consultas por clave=${lookups.join(",") || "ninguna"}; ventas en base=${mid.sales.length}`,
      });

      const extra: string[] = [];
      let onReturn: PosOutcome | null = null;
      let whileDown: PosOutcome | null = null;
      let final: PosOutcome = atCut;

      /** Con la consulta aún caída, la acción no puede dar el cobro por no hecho. */
      const mustStayUnresolved = (what: string, view: PosOutcome) => {
        whileDown = view;
        if (view.claim === "success") extra.push(`${what} sin red afirmó «Venta registrada» sin poder consultarlo`);
        else if (!view.verifyOffered) extra.push(`${what} sin red quitó el aviso y «Verificar» («${view.text}»)`);
        if (view.cartLines === 0 && view.claim !== "success") extra.push(`${what} sin red vació el carrito con el cobro sin resolver`);
      };
      /** El cajero rehace el mismo carrito y vuelve a cobrar: la acción que duplicaba en fase 4. */
      const rebuildAndCharge = async () => {
        await posAdd(page, product, quantity);
        await posPickCash(page);
        await rec.shot(page, "carrito-rehecho");
        await processButton(page).click({ timeout: 10_000 });
        final = await posSettled(page, 30_000);
      };

      if (spec.action === "verify") {
        await verifyButton(page).click({ timeout: 10_000 });
        const down = await posSettled(page, 15_000);
        sayOutcome(rec, "POS tras «Verificar» con la consulta aún caída", down);
        await rec.shot(page, "verificar-sin-red");
        mustStayUnresolved("«Verificar»", down);
        await restoreNetwork();
        if (await verifyButton(page).isVisible().catch(() => false)) await verifyButton(page).click({ timeout: 10_000 });
        final = await posSettled(page, 30_000);
      } else if (spec.action === "clear_order") {
        const clear = page.getByRole("button", { name: "Limpiar orden" });
        await clear.click({ timeout: 10_000 });
        const down = await posSettled(page, 15_000);
        sayOutcome(rec, "POS tras «Limpiar orden» con la consulta aún caída", down);
        await rec.shot(page, "limpiar-sin-red");
        mustStayUnresolved("«Limpiar orden»", down);
        await restoreNetwork();
        if (await clear.isEnabled().catch(() => false)) await clear.click({ timeout: 10_000 });
        final = await posSettled(page, 30_000);
        // Si la UI no cerró la venta y dejó el carrito limpio, el cajero lo rehace y cobra.
        if (final.claim !== "success" && final.cartLines === 0) await rebuildAndCharge();
      } else if (spec.action === "reload") {
        await page.reload();
        await posReady(page);
        onReturn = await posOutcome(page, 10_000);
        sayOutcome(rec, "POS tras recargar (antes de tocar nada)", onReturn);
        await rec.shot(page, "tras-recargar");
        await restoreNetwork();
        await rebuildAndCharge();
      } else if (spec.action === "leave_and_return") {
        await page.getByRole("link", { name: "Volver a ventas" }).or(page.getByRole("button", { name: "Volver a ventas" })).first().click();
        await page.waitForURL((url) => url.pathname === "/sales", { timeout: NAV_TIMEOUT });
        await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT }).catch(() => undefined);
        await rec.shot(page, "fuera-del-pos");
        // Vuelta por navegación de cliente (sin recargar): el POS se remonta.
        const link = page.locator('main a[href="/sales/create"]').first();
        const how = (await link.count()) > 0 ? "enlace a /sales/create" : "atrás del navegador";
        if ((await link.count()) > 0) await link.click();
        else await page.goBack();
        await page.waitForURL((url) => url.pathname === "/sales/create", { timeout: NAV_TIMEOUT });
        await posReady(page);
        rec.step("UI salir a /sales y volver al POS", { note: how });
        onReturn = await posOutcome(page, 10_000);
        sayOutcome(rec, "POS al volver (antes de tocar nada)", onReturn);
        await rec.shot(page, "al-volver");
        await restoreNetwork();
        await rebuildAndCharge();
      }
      await rec.shot(page, "final");
      sayOutcome(rec, "POS al final, con la red de vuelta", final);
      await sleep(1_500); // margen para un posible POST tardío

      // La base manda: una venta y un juego de movimientos para este carrito.
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const posts = summarizeSalePosts(net.bodies);
      const dbInvoice = diff.sales.length === 1 ? (diff.sales[0]?.invoice_number ?? null) : null;
      rec.step(`UI el cajero ${CASHIER_ACTION_LABEL[spec.action]}`, {
        note: `POST totales=${posts.requests}; clientRequestId distintos=${posts.distinctClientRequestIds}; consultas por clave=${lookups.join(",") || "ninguna"}`,
      });
      rec.expected = {
        ...saleExpectations(product, quantity),
        ui_at_cut: spec.lookupDown
          ? "aviso «La venta pudo haberse registrado…» + botón «Verificar»; el carrito no se da por cobrado"
          : "la UI consulta por la clave y muestra la venta registrada",
        ui_final: "la UI nombra la venta de la base (overlay «Venta registrada» o aviso con su factura); ningún segundo cobro",
        auto_retry: 0,
      };
      rec.actual = {
        ...saleActual(diff, product),
        sales_in_db_at_cut: mid.sales.length,
        posts_at_cut: postsAtCut,
        post_sales: posts,
        lookups,
        ui_at_cut: toView(atCut),
        ui_while_lookup_down: whileDown ? toView(whileDown) : null,
        ui_on_return: onReturn ? toView(onReturn) : null,
        ui_final: toView(final),
      };
      const judged = judgeLostResponse({
        dbProblems: [...singleSaleProblems(diff, product, quantity), ...extra],
        dbInvoice,
        salesAtCut: mid.sales.length,
        postsAtCut,
        atCut: toView(atCut),
        onReturn: onReturn ? toView(onReturn) : null,
        final: toView(final),
      });
      const info = `Tras el corte la UI dijo ${atCut.claim} («${atCut.text}»${atCut.verifyOffered ? " + Verificar" : ""}) con ${mid.sales.length} venta(s) en base y ${postsAtCut} POST; el cajero ${CASHIER_ACTION_LABEL[spec.action]}; al final UI ${final.claim} («${final.text}»), ${posts.requests} POST con ${posts.distinctClientRequestIds} clave(s), ${diff.sales.length} venta(s) y ${diff.movements.length} movimiento(s) en base.`;
      if (judged.verdict === "fail") rec.set("fail", `${judged.detail} · ${info}`);
      else if (posts.requests > 1) rec.set("finding", `Una sola venta gracias a la idempotencia del servidor, pero el POS envió ${posts.requests} POST: no consultó por la clave antes de reenviar. ${info}`);
      else rec.set("pass", info);
    });
  };

  await lostResponseCase({
    sub: "ii_cut_response_after_commit",
    key: "F3-DESPUES",
    title: "POS: respuesta perdida tras el commit → la UI consulta por la clave y muestra la venta",
    lookupDown: false,
    action: "none",
  });
  await lostResponseCase({
    sub: "ii_unknown_then_verify",
    key: "F3-VERIF",
    title: "POS: respuesta perdida y consulta caída → aviso «pudo haberse registrado» + «Verificar» → una venta",
    lookupDown: true,
    action: "verify",
  });
  await lostResponseCase({
    sub: "ii_unknown_then_clear_order",
    key: "F3-LIMPIA",
    title: "POS: respuesta perdida y consulta caída → «Limpiar orden» no da el cobro por no hecho → una venta",
    lookupDown: true,
    action: "clear_order",
  });
  await lostResponseCase({
    sub: "iv_unknown_then_reload",
    key: "F3-RECARGA",
    title: "POS: respuesta perdida y consulta caída → recargar y repetir el carrito → una venta",
    lookupDown: true,
    action: "reload",
  });
  await lostResponseCase({
    sub: "v_unknown_then_leave_and_return",
    key: "F3-SALIR",
    title: "POS: respuesta perdida y consulta caída → salir a /sales, volver y repetir el carrito → una venta",
    lookupDown: true,
    action: "leave_and_return",
  });

  await runCase(
    lab,
    { n: 3, sub: "iii_very_slow_response", scope: "extra", title: "POS: respuesta lentísima (35 s) con la venta ya confirmada", hypothesis: ["H8"] },
    async (rec) => {
      const delayMs = 35_000;
      const product = await createProduct(lab, "F3-LENTA", { stock: 20 });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open(lab.sellerKey);
      const net = watchSalePosts(page);
      await openPos(rec, page);
      await posAdd(page, product, quantity);
      await posPickCash(page);
      await page.route(SALES_ROUTE, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        rec.step("servidor respondió (respuesta retenida)", { status: response.status(), note: `${delayMs} ms` });
        await sleep(delayMs);
        return route.fulfill({ response }).catch(() => undefined);
      });
      await processButton(page).click();
      const observations: Record<string, unknown>[] = [];
      for (const at of [5_000, 20_000]) {
        await page.waitForTimeout(at === 5_000 ? 5_000 : 15_000);
        const state = await posOutcome(page, 1);
        sayOutcome(rec, `POS a los ${at / 1000} s de espera`, state);
        // El cajero impaciente vuelve a pulsar y da Enter.
        await processButton(page).click({ force: true, timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press("Enter").catch(() => undefined);
        const mid = diffSnapshots(before, await snapshot(lab.db, [product.id]));
        observations.push({ at_ms: at, claim: state.claim, button: state.button, disabled: state.buttonDisabled, posts: net.bodies.length, sales_in_db: mid.sales.length });
        await rec.shot(page, `espera-${at / 1000}s`);
      }
      const outcome = await posOutcome(page, delayMs + 15_000);
      await rec.shot(page, "resultado");
      sayOutcome(rec, "POS cuando por fin llega la respuesta", outcome);
      await sleep(800);
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const posts = summarizeSalePosts(net.bodies);
      rec.expected = { ...saleExpectations(product, quantity), ui_while_waiting: "botón bloqueado, sin éxito ni error falsos", auto_retry: 0 };
      rec.actual = { ...saleActual(diff, product), while_waiting: observations, post_sales: posts, post_statuses: net.statuses, ui_claim: outcome.claim, ui_invoice: outcome.invoice };
      const info = `Durante ${delayMs / 1000} s la UI mostró ${observations.map((o) => `${Number(o.at_ms) / 1000}s: ${String(o.claim)}/"${String(o.button)}"${o.disabled ? " deshabilitado" : ""}`).join("; ")}; POST enviados ${posts.requests}; al llegar la respuesta UI ${outcome.claim}; ventas en base ${diff.sales.length}. El cliente no tiene timeout propio (apiFetch sin AbortController).`;
      const problems = singleSaleProblems(diff, product, quantity);
      const judged = judgeUiVsDb({ what: "venta(s)", uiClaim: outcome.claim, expectedDocs: 1, createdDocs: diff.sales.length });
      if (judged.verdict === "fail") problems.unshift(judged.detail);
      if (observations.some((o) => o.claim === "error")) problems.push("la UI mostró error mientras la venta ya estaba confirmada");
      if (problems.length > 0) rec.set("fail", `${problems.join(" · ")} · ${info}`);
      else if (posts.requests > 1) rec.set("finding", `El navegador envió ${posts.requests} POST durante la espera. ${info}`);
      else rec.set("pass", info);
    },
  );
}

// ---------------------------------------------------------------------------
// Compras por UI (F4, F5)
// ---------------------------------------------------------------------------

type UiPurchase = { id: string; number: string; defaultStatus: string; statusChosen: string };

/** Registra por UI una compra `pedido` en modo empaque (Personalizado: bulto × uds). */
async function uiCreatePackPurchase(
  rec: CaseRec,
  page: Page,
  product: LabProduct,
  packCount: number,
  unitsPerPack: number,
  packCostRef: number,
  usePreset = false,
): Promise<UiPurchase> {
  await rec.goto(page, "/purchases/create");
  const supplier = page.getByRole("combobox", { name: /Proveedor/ });
  await supplier.click();
  await supplier.fill(rec.lab.supplierName);
  await page.getByRole("option").filter({ hasText: rec.lab.supplierName }).first().click();

  const search = page.getByRole("combobox", { name: "Buscar productos" }).or(page.getByRole("searchbox", { name: "Buscar productos" })).first();
  await search.click();
  await search.fill(product.name);
  await page.locator("main").getByRole("listitem").getByRole("button").filter({ hasText: product.name }).first().click();

  const mode = page.getByLabel(`Modo de captura de ${product.name}`);
  await mode.waitFor({ state: "visible" });
  rec.say("Compra · opciones de Modo", (await mode.locator("option").allInnerTexts()).join(" / "));
  const modeLabels = (await mode.locator("option").allInnerTexts()).map((text) => text.trim());
  const preset = usePreset ? modeLabels.find((label) => !/^(Unidad|Personalizado)$/i.test(label)) : undefined;
  if (usePreset && !preset) throw new Error(`El modo no ofrece el empaque del proveedor: ${modeLabels.join(" / ")}`);
  await mode.selectOption({ label: preset ?? "Personalizado" });
  rec.say("Compra · modo elegido", preset ?? "Personalizado");
  await page.getByLabel(new RegExp(`^Cantidad de .+ de ${product.name}$`)).fill(String(packCount));
  const perPack = page.getByLabel(new RegExp(`^Unidades por .+ de ${product.name}$`));
  if ((await perPack.count()) > 0 && (await perPack.isEditable())) await perPack.fill(String(unitsPerPack));
  await page.getByRole("group", { name: `Moneda de costo de ${product.name}` }).getByRole("button", { name: "REF" }).click();
  await page.getByLabel(new RegExp(`^Costo por .+ REF de ${product.name}$`)).fill(String(packCostRef));
  rec.say("Compra · línea capturada", (await page.getByRole("row").filter({ hasText: product.name }).first().innerText().catch(() => "")).slice(0, 400));

  const status = page.getByLabel("Estado de la Compra", { exact: true }).and(page.locator("select"));
  const defaultStatus = (await status.locator("option:checked").innerText()).trim();
  rec.say("Compra · estado por defecto del formulario", defaultStatus);
  await status.selectOption({ label: "Pedido (Pendiente por recibir)" });
  const statusChosen = (await status.locator("option:checked").innerText()).trim();
  rec.say("Compra · resumen antes de confirmar", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(-420));
  await rec.shot(page, "compra-formulario");

  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/purchases",
    { timeout: NAV_TIMEOUT },
  );
  await page.getByRole("button", { name: "Confirmar Compra" }).click();
  const response = await created;
  const body = (await response.json().catch(() => null)) as { data?: JsonRecord; error?: JsonRecord } | null;
  rec.step("UI Confirmar Compra → POST /api/purchases", { as: "admin", status: response.status(), response_id: body?.data ? String(body.data.id) : null });
  if (!response.ok() || !body?.data) {
    await sayScreen(rec, page, "Compra · error al confirmar");
    throw new Error(`La UI no pudo crear la compra: ${response.status()} ${JSON.stringify(body?.error ?? body)}`);
  }
  await page.waitForURL((url) => !url.pathname.endsWith("/purchases/create"), { timeout: NAV_TIMEOUT }).catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  rec.say("Compra · pantalla tras confirmar", new URL(page.url()).pathname);
  return { id: String(body.data.id), number: String(body.data.purchaseNumber), defaultStatus, statusChosen };
}

async function uiOpenPurchase(rec: CaseRec, page: Page, purchase: UiPurchase): Promise<void> {
  await rec.goto(page, `/purchases/${purchase.id}`);
  await page.getByRole("button", { name: `Acciones de ${purchase.number}` }).waitFor({ state: "visible", timeout: NAV_TIMEOUT });
}

async function flow04(lab: Lab): Promise<void> {
  const packCount = 3;
  const unitsPerPack = 12;
  const units = packUnits(packCount, unitsPerPack);
  for (const variant of [
    { sub: "receive", key: "F4-BULTO", scope: "plan" as CaseScope, title: "Compra en modo empaque (3 × 12) como pedido → recibir por UI → +36 unidades", double: false },
    { sub: "receive_double_click", key: "F4-DOBLE", scope: "extra" as CaseScope, title: "Compra en modo empaque → doble clic en «Confirmar recepción» → una sola entrada", double: true },
  ]) {
    await runCase(lab, { n: 4, sub: variant.sub, scope: variant.scope, title: variant.title, hypothesis: ["H2", "H8", "H11"] }, async (rec) => {
      const product = await createProduct(lab, variant.key, { stock: 0, price: 2, supplier: variant.double ? "linked_with_pack_x12" : "linked" });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open("admin");
      const purchase = await uiCreatePackPurchase(rec, page, product, packCount, unitsPerPack, 12, variant.double);
      const afterCreate = diffSnapshots(before, await snapshot(lab.db, [product.id]));

      await uiOpenPurchase(rec, page, purchase);
      await rec.shot(page, "pedido-detalle");
      const receives: number[] = [];
      page.on("response", (response) => {
        if (response.request().method() === "PATCH" && /\/api\/purchases\/[^/]+\/receive$/.test(new URL(response.url()).pathname)) {
          receives.push(response.status());
        }
      });
      await page.getByRole("button", { name: `Acciones de ${purchase.number}` }).click();
      await page.getByRole("menuitem", { name: "Recibir pedido" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      rec.say("Diálogo Recibir pedido", await dialog.innerText());
      await rec.shot(page, "dialogo-recibir");
      const confirm = dialog.getByRole("button", { name: /Confirmar recepción|Procesando/ });
      if (variant.double) await confirm.dblclick();
      else await confirm.click();
      await dialog.waitFor({ state: "hidden", timeout: NAV_TIMEOUT }).catch(() => undefined);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(1_000);
      await sayScreen(rec, page, "Detalle tras recibir");
      const header = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 260);
      rec.say("Detalle tras recibir · cabecera", header);
      await rec.shot(page, "recibido-detalle");
      rec.step(`UI ${variant.double ? "doble clic" : "clic"} Confirmar recepción`, { as: "admin", status: receives[0], note: `PATCH receive enviados=${receives.length} (${receives.join(",")})` });

      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const uiRows = await uiMovements(rec, page, product, "movimientos");
      const uiPurchaseRows = uiRows.filter((row) => /^compra$/i.test(row.type));
      const uiStock = await uiProductStock(rec, page, product, "detalle-producto");
      const purchaseRow = diff.purchases[0];
      const moves = diff.movements.filter((m) => m.type === "compra");

      rec.expected = {
        purchases: 1,
        stock_delta_after_create_pedido: 0,
        stock_delta_after_receive: { [product.sku]: units },
        movements: [{ type: "compra", quantity_delta: units }],
        ui: `1 fila Compra +${units} → ${units} y detalle con ${units} unidades`,
      };
      rec.actual = {
        purchases: diff.purchases,
        stock_delta_after_create_pedido: afterCreate.stockDelta[product.id] ?? 0,
        movements_after_create_pedido: afterCreate.movements.length,
        stock_delta_after_receive: { [product.sku]: diff.stockDelta[product.id] ?? 0 },
        movements: diff.movements.map((m) => ({ type: m.type, quantity_delta: m.quantity_delta, stock_after: m.stock_after })),
        receive_requests: receives,
        ui_movements: uiPurchaseRows.map((row) => row.raw),
        ui_stock: uiStock,
      };
      const problems: string[] = [];
      if (diff.purchases.length !== 1) problems.push(`compras: esperado 1, real ${diff.purchases.length}`);
      if ((afterCreate.stockDelta[product.id] ?? 0) !== 0 || afterCreate.movements.length > 0) problems.push("la compra en estado pedido ya movió stock");
      if (purchaseRow && purchaseRow.status !== "recibido") problems.push(`la compra quedó en estado ${purchaseRow.status}`);
      if (moves.length !== 1 || moves[0]?.quantity_delta !== units) problems.push(`movimientos compra: esperado 1 de +${units}, real ${moves.map((m) => m.quantity_delta).join(",") || "ninguno"}`);
      if ((diff.stockDelta[product.id] ?? 0) !== units) problems.push(`stock: esperado +${units}, real ${diff.stockDelta[product.id] ?? 0}`);
      if (uiPurchaseRows.length !== 1 || uiPurchaseRows[0]?.quantity !== units) problems.push(`la UI muestra ${uiPurchaseRows.length} fila(s) Compra (${uiPurchaseRows.map((r) => r.quantity).join(",")})`);
      if (uiStock !== (diff.stockDelta[product.id] ?? 0)) problems.push(`el detalle del producto muestra ${uiStock} y la base ${diff.stockDelta[product.id] ?? 0}`);
      const info = `PATCH receive enviados: ${receives.length} (${receives.join(",")}).`;
      if (problems.length > 0) rec.set("fail", `${problems.join(" · ")} · ${info}`);
      else if (receives.some((status) => status >= 500)) rec.set("finding", `Stock correcto, pero una de las peticiones de recepción devolvió ${receives.join(",")} (500 donde tocaba 400/409). ${info}`);
      else if (receives.length > 1) rec.set("finding", `Stock correcto, pero el doble clic envió ${receives.length} PATCH receive: el botón no bloquea el segundo envío. ${info}`);
      else rec.set("pass", info);
    });
  }
}

async function flow05(lab: Lab): Promise<void> {
  await runCase(
    lab,
    { n: 5, title: "Compra pedido: ¿la UI deja claro que el stock NO entró y falta recibir?", hypothesis: ["H1", "H8"] },
    async (rec) => {
      const product = await createProduct(lab, "F5-PEDIDO", { stock: 0, price: 2, supplier: "linked" });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open("admin");
      const purchase = await uiCreatePackPurchase(rec, page, product, 2, 12, 12);

      // Lista
      await rec.goto(page, "/purchases");
      await page.getByLabel("Búsqueda").fill(purchase.number);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(800);
      const list = await readTable(page);
      const listRow = list.rows.find((row) => row.some((cell) => cell.includes(purchase.number))) ?? [];
      rec.say("Lista /purchases · cabeceras", list.headers.join(" | "));
      rec.say("Lista /purchases · fila de la compra", listRow.join(" | ") || "(no aparece)");
      await rec.shot(page, "lista");

      // Detalle
      await uiOpenPurchase(rec, page, purchase);
      const notes = await screenTexts(page);
      for (const note of notes) rec.say("Detalle de la compra · aviso", note);
      const detailText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      rec.say("Detalle de la compra · texto completo", detailText.slice(0, 500));
      const stockSentences = detailText.match(/[^.·|]*\b(inventario|stock|recib\w*|pendiente\w*)\b[^.·|]*/gi) ?? [];
      rec.say("Detalle · frases con stock/inventario/recibir/pendiente", [...new Set(stockSentences.map((s) => s.trim()))].join(" ‖ ") || "(ninguna)");
      await rec.shot(page, "detalle");
      await page.getByRole("button", { name: `Acciones de ${purchase.number}` }).click();
      const menu = (await page.getByRole("menuitem").allInnerTexts()).map((text) => text.trim());
      rec.say("Detalle · menú Acciones", menu.join(" / "));
      await rec.shot(page, "detalle-acciones");
      if (menu.some((text) => /^Devolver/i.test(text))) {
        rec.note("el menú Acciones de una compra en estado pedido ofrece «Devolver» aunque la mercancía no ha entrado");
      }
      await page.keyboard.press("Escape");

      const uiStock = await uiProductStock(rec, page, product, "detalle-producto");
      const uiRows = await uiMovements(rec, page, product, "movimientos");
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));

      const haystack = `${listRow.join(" ")} ${notes.join(" ")} ${stockSentences.join(" ")}`;
      const explicit = /(no|a[uú]n no|todav[ií]a no)\b[^.]{0,60}(ingres|entr|inventario|stock)|sin (ingresar|recibir)|pendiente (por|de) recibir|por recibir|falta recibir/i.test(haystack);
      const statusOnly = /pedido/i.test(listRow.join(" "));
      rec.expected = {
        stock_delta: { [product.sku]: 0 },
        movements: [],
        ui: "texto, badge o aviso explícito de que el stock no ha entrado y falta recibir",
      };
      rec.actual = {
        form_default_status: purchase.defaultStatus,
        status_chosen: purchase.statusChosen,
        purchase: diff.purchases,
        stock_delta: { [product.sku]: diff.stockDelta[product.id] ?? 0 },
        movements: diff.movements.length,
        ui_product_stock: uiStock,
        ui_movement_rows: uiRows.length,
        list_row: listRow,
        detail_notes: notes,
        actions_menu: menu,
        explicit_not_received_text: explicit,
      };
      if ((diff.stockDelta[product.id] ?? 0) !== 0 || diff.movements.length > 0) {
        rec.set("fail", `La compra en estado pedido movió stock: delta ${diff.stockDelta[product.id] ?? 0}, ${diff.movements.length} movimiento(s).`);
      } else if (uiStock !== 0 || uiRows.length > 0) {
        rec.set("fail", `La base no movió stock pero la UI muestra stock ${uiStock} y ${uiRows.length} movimiento(s).`);
      } else if (!explicit) {
        rec.set(
          "finding",
          `UX (severidad media): la compra pedido no dice de forma explícita que el stock NO entró ni que falta recibir. Lista: «${listRow.join(" | ")}»${statusOnly ? " (solo el estado «Pedido»)" : ""}. Avisos del detalle: «${notes.join(" · ") || "ninguno"}». Acción disponible: «${menu.join(" / ")}». Estado por defecto del formulario: «${purchase.defaultStatus}».`,
        );
      } else {
        rec.set("pass", `La UI lo dice de forma explícita. Lista: «${listRow.join(" | ")}». Avisos: «${notes.join(" · ")}». Estado por defecto del formulario: «${purchase.defaultStatus}».`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// F6 · Ajuste desde inventario
// ---------------------------------------------------------------------------

type AdjustOutcome = { claim: UiClaim; text: string; projected: string; status: number | null; productListed: boolean; typeOptions: string[] };

async function uiAdjust(
  rec: CaseRec,
  page: Page,
  product: LabProduct,
  typeLabel: string,
  quantity: number,
  shotName: string,
): Promise<AdjustOutcome> {
  // Camino real: /inventory → filtrar por SKU → Acciones de la fila → «Registrar ajuste»
  // (lleva a /inventory/movements?productId=…) → botón «Ajustar stock».
  await rec.goto(page, "/inventory");
  await page.getByLabel("Producto o SKU").fill(product.sku);
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  const row = page.getByRole("row").filter({ hasText: product.sku });
  await row.first().waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  rec.say("/inventory · fila del producto", await row.first().innerText());
  await rec.shot(page, `${shotName}-inventario`);
  await row.first().getByRole("button", { name: "Abrir acciones" }).click();
  rec.say("/inventory · acciones de la fila", (await page.getByRole("menuitem").allInnerTexts()).map((t) => t.trim()).join(" / "));
  await page.getByRole("menuitem", { name: "Registrar ajuste" }).click();
  await page.waitForURL((url) => url.pathname === "/inventory/movements", { timeout: NAV_TIMEOUT });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.getByRole("button", { name: "Ajustar stock" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  const select = dialog.getByLabel("Producto", { exact: true });
  await dialog.locator("select option").nth(1).waitFor({ state: "attached", timeout: NAV_TIMEOUT });
  const option = select.locator("option", { hasText: product.name });
  let productListed = true;
  if ((await select.inputValue()) !== product.id) {
    if ((await option.count()) === 0) {
      // El selector solo carga 100 productos: el nuestro no está entre las opciones.
      productListed = false;
      const total = await select.locator("option").count();
      const shownOption = (await select.locator("option:checked").innerText().catch(() => "")).trim();
      rec.say(
        "Ajuste de stock · selector Producto",
        `no lista «${product.name}» (${total} opciones); muestra «${shownOption}» aunque se llegó desde la fila del producto`,
      );
    } else {
      await select.selectOption({ label: (await option.first().innerText()).trim() });
    }
  }
  const typeSelect = dialog.getByLabel("Tipo de movimiento");
  const typeOptions = (await typeSelect.locator("option").allInnerTexts()).map((text) => text.trim());
  rec.say("Ajuste de stock · opciones de «Tipo de movimiento»", typeOptions.join(" / "));
  await typeSelect.selectOption({ label: typeLabel });
  await dialog.getByLabel("Cantidad").fill(String(quantity));
  await dialog.getByLabel("Motivo").fill(`STK-404 ${rec.lab.run}`);
  const projected = await dialogText(dialog);
  const projection = /Después del movimiento:[^A-Z]*/.exec(projected)?.[0]?.trim() ?? "";
  rec.say(`Ajuste ${typeLabel} ${quantity} · proyección`, projection || "(sin proyección)");
  await rec.shot(page, `${shotName}-formulario`);
  const posted = page
    .waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/inventory/adjustments",
      { timeout: 8_000 },
    )
    .catch(() => null);
  const submit = page.getByRole("button", { name: /Registrar movimiento|Registrando/ });
  const submitDisabled = await submit.isDisabled();
  if (submitDisabled) rec.say(`Ajuste ${typeLabel} ${quantity} · botón`, "Registrar movimiento (deshabilitado)");
  else await submit.click();
  const response = submitDisabled ? null : await posted;
  await page.waitForTimeout(700);
  const stillOpen = await dialog.isVisible().catch(() => false);
  let text = "";
  if (stillOpen) {
    text = await dialogText(dialog);
    rec.say(`Ajuste ${typeLabel} ${quantity} · diálogo tras enviar`, text);
  } else {
    rec.say(`Ajuste ${typeLabel} ${quantity} · diálogo tras enviar`, "(el diálogo se cerró sin mensaje)");
  }
  await rec.shot(page, `${shotName}-resultado`);
  rec.step(`UI Ajuste de stock: ${typeLabel} ${quantity}`, { as: "admin", status: response?.status(), note: response ? "" : "no salió ningún POST" });
  if (stillOpen) await page.keyboard.press("Escape");
  return { claim: stillOpen ? "error" : "success", text, projected: projection, status: response?.status() ?? null, productListed, typeOptions };
}

async function flow06(lab: Lab): Promise<void> {
  const steps: { sub: string; title: string; type: string; label: string; qty: number; delta: number }[] = [
    { sub: "entrada", title: "Ajuste de entrada (+5) desde /inventory → movimiento", type: "ajuste_entrada", label: "Ajuste entrada", qty: 5, delta: 5 },
    { sub: "salida", title: "Ajuste de salida (−3) desde /inventory → movimiento", type: "ajuste_salida", label: "Ajuste salida", qty: 3, delta: -3 },
    { sub: "salida_mayor_que_stock", title: "Ajuste de salida mayor que el stock → mensaje y sin movimiento", type: "ajuste_salida", label: "Ajuste salida", qty: 999, delta: 0 },
  ];
  for (const step of steps) {
    await runCase(lab, { n: 6, sub: step.sub, scope: step.delta === 0 ? "extra" : "plan", title: step.title, hypothesis: ["H3", "H8"] }, async (rec) => {
      const product = await createProduct(lab, `F6-${step.sub.toUpperCase().replace(/_/g, "-")}`, { stock: 10 });
      rec.track(product);
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open("admin");
      const outcome = await uiAdjust(rec, page, product, step.label, step.qty, "ajuste");
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const expectMove = step.delta !== 0;
      rec.expected = {
        stock_delta: { [product.sku]: step.delta },
        movements: expectMove ? [{ type: step.type, quantity_delta: step.delta }] : [],
        ui: expectMove ? "cierra el diálogo y la fila aparece en movimientos" : "mensaje de stock insuficiente, sin movimiento",
        type_options: "solo Ajuste entrada, Ajuste salida e Inventario inicial (ninguna devolución)",
      };
      if (!outcome.productListed) {
        rec.note("el selector «Producto» del diálogo «Ajuste de stock» solo carga 100 productos y no muestra el producto elegido desde su fila (el ajuste se envía igualmente con el producto de la URL)");
      }
      const uiRows = await uiMovements(rec, page, product, "movimientos");
      const uiMatch = uiRows.filter((row) => row.type.toLowerCase() === step.label.toLowerCase());
      const uiStock = await uiProductStock(rec, page, product, "detalle-producto");
      const dbStock = (before.stock[product.id] ?? 0) + (diff.stockDelta[product.id] ?? 0);
      rec.actual = {
        ui_claim: outcome.claim,
        ui_text: outcome.text,
        http_status: outcome.status,
        type_options: outcome.typeOptions,
        stock_delta: { [product.sku]: diff.stockDelta[product.id] ?? 0 },
        movements: diff.movements.map((m) => ({ type: m.type, quantity_delta: m.quantity_delta, stock_after: m.stock_after })),
        ui_movements: uiMatch.map((row) => row.raw),
        ui_stock: uiStock,
      };
      const problems: string[] = [];
      const judged = judgeUiVsDb({ what: "movimiento(s)", uiClaim: outcome.claim, expectedDocs: expectMove ? 1 : 0, createdDocs: diff.movements.length });
      if (judged.verdict === "fail") problems.push(judged.detail);
      problems.push(...adjustmentTypeProblems(outcome.typeOptions));
      if ((diff.stockDelta[product.id] ?? 0) !== step.delta) problems.push(`stock: esperado ${step.delta}, real ${diff.stockDelta[product.id] ?? 0}`);
      if (expectMove && (diff.movements[0]?.type !== step.type || diff.movements[0]?.quantity_delta !== step.delta)) problems.push(`movimiento en base: ${JSON.stringify(diff.movements.map((m) => [m.type, m.quantity_delta]))}`);
      if (uiMatch.length !== (expectMove ? 1 : 0) || (expectMove && uiMatch[0]?.quantity !== step.delta)) problems.push(`la UI muestra ${uiMatch.length} fila(s) «${step.label}» (${uiMatch.map((r) => r.quantity).join(",")})`);
      if (uiStock !== dbStock) problems.push(`el detalle muestra stock ${uiStock} y la base ${dbStock}`);
      if (problems.length > 0) rec.set("fail", problems.join(" · "));
      else if (!expectMove && outcome.status !== null && outcome.status >= 500) rec.set("finding", `Sin movimiento, pero el servidor respondió ${outcome.status} (tocaba 400). UI: «${outcome.text}».`);
      else if (!expectMove && !/insuficiente|no hay stock|negativ/i.test(`${outcome.text} ${outcome.projected}`)) rec.set("finding", `Sin movimiento, pero el mensaje no explica que el stock es insuficiente: «${outcome.text}».`);
      else rec.set("pass", expectMove ? "" : `UI: «${outcome.text.slice(0, 300)}» · HTTP ${outcome.status ?? "sin petición"}.`);
    });
  }
}

// ---------------------------------------------------------------------------
// F7 · Conversión desde el detalle del producto empaque
// ---------------------------------------------------------------------------

/** Lo que la UI debe decir cuando no hay empaques que abrir. */
const NO_STOCK_MESSAGE = /insuficiente|no hay|sin stock|solo hay|supera|no alcanza/i;

async function flow07(lab: Lab): Promise<void> {
  const unitsPerPack = 12;
  for (const variant of [
    { sub: "normal", title: "Abrir 2 empaques (x12) desde el detalle → −2 empaque / +24 unidad", key: "F7-CAJA", unitKey: "F7-UNID", stock: 3, packs: 2, ok: true },
    { sub: "sin_stock", title: "Abrir empaque sin stock desde el detalle → mensaje y sin movimientos", key: "F7-VACIA", unitKey: "F7-UVAC", stock: 0, packs: 1, ok: false },
  ]) {
    await runCase(lab, { n: 7, sub: variant.sub, scope: variant.ok ? "plan" : "extra", title: variant.title, hypothesis: ["H5", "H8"] }, async (rec) => {
      const pack = await createProduct(lab, variant.key, { stock: variant.stock, price: 3, pack: { unitsPerPack, unitKey: variant.unitKey } });
      const unit = pack.unit;
      if (!unit) throw new Error("par empaque sin unidad");
      rec.track(pack, unit);
      const ids = [pack.id, unit.id];
      const before = await snapshot(lab.db, ids);
      const page = await rec.open("admin");
      await rec.goto(page, `/products/${pack.id}`);
      const card = page.locator("section,div").filter({ has: page.getByRole("heading", { name: "Conversion empaque" }) }).last();
      rec.say("Detalle empaque · tarjeta Conversion empaque", await card.innerText());
      const trigger = page.getByRole("button", { name: "Abrir empaque" });
      await trigger.waitFor({ state: "visible" });
      await rec.shot(page, "detalle-empaque");
      let claim: UiClaim = "none";
      let text = "";
      let status: number | null = null;
      let nativeMessage = "";
      // null = la acción no se ofreció (botón deshabilitado): no hay mensaje que medir.
      let seen: SeenMessage | null = null;
      if (await trigger.isDisabled()) {
        claim = "error";
        text = "botón «Abrir empaque» deshabilitado";
        rec.say("Detalle empaque · botón", text);
      } else {
        await trigger.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        await dialog.getByLabel("Cantidad de empaques").fill(String(variant.packs));
        await dialog.getByLabel("Motivo").fill(`STK-404 ${lab.run}`).catch(() => undefined);
        rec.say("Diálogo Abrir empaque", await dialog.innerText());
        await rec.shot(page, "dialogo");
        const posted = page
          .waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/inventory/conversions", { timeout: 8_000 })
          .catch(() => null);
        const submit = dialog.getByRole("button", { name: /Abrir empaque|Abriendo|Convirtiendo|Procesando/ });
        if (await submit.isDisabled()) rec.say("Diálogo Abrir empaque · botón", "deshabilitado");
        else await submit.click();
        const response = await posted;
        status = response?.status() ?? null;
        await page.waitForTimeout(800);
        nativeMessage = await dialog.getByLabel("Cantidad de empaques").evaluate((element) => (element as HTMLInputElement).validationMessage).catch(() => "");
        if (nativeMessage) rec.say("Diálogo Abrir empaque · validación nativa del navegador", nativeMessage);
        if (await dialog.isVisible().catch(() => false)) {
          claim = "error";
          text = await dialogText(dialog);
          rec.say("Diálogo Abrir empaque tras enviar", text);
          seen = await measureMessage(page, dialog.getByText(NO_STOCK_MESSAGE));
          rec.say("Diálogo Abrir empaque · mensaje de stock", seen.text ? `«${seen.text}» en ${JSON.stringify(seen.box)}` : "(ninguno)");
        } else {
          claim = "success";
          rec.say("Diálogo Abrir empaque tras enviar", "(se cerró sin mensaje)");
        }
        await rec.shot(page, "resultado");
        if (claim === "error") await page.keyboard.press("Escape");
      }
      rec.step(`UI Abrir empaque × ${variant.packs}`, { as: "admin", status: status ?? undefined, note: status === null ? "no salió ningún POST" : "" });
      const diff = diffSnapshots(before, await snapshot(lab.db, ids));
      const uiPackRows = await uiMovements(rec, page, pack, "movimientos-empaque");
      const uiUnitRows = await uiMovements(rec, page, unit, "movimientos-unidad");
      const uiPackStock = await uiProductStock(rec, page, pack, "stock-empaque");
      const uiUnitStock = await uiProductStock(rec, page, unit, "stock-unidad");
      const wantPack = variant.ok ? -variant.packs : 0;
      const wantUnit = variant.ok ? variant.packs * unitsPerPack : 0;
      const labels = { [pack.id]: pack.sku, [unit.id]: unit.sku };
      rec.expected = {
        stock_delta: { [pack.sku]: wantPack, [unit.sku]: wantUnit },
        movements: variant.ok
          ? [{ type: "conversion_salida", quantity_delta: wantPack }, { type: "conversion_entrada", quantity_delta: wantUnit }]
          : [],
      };
      rec.actual = {
        ui_claim: claim,
        ui_text: text,
        http_status: status,
        ui_message: seen,
        native_validation: nativeMessage,
        stock_delta: { [pack.sku]: diff.stockDelta[pack.id] ?? 0, [unit.sku]: diff.stockDelta[unit.id] ?? 0 },
        movements: diff.movements.map((m) => ({ product: labels[m.product_id], type: m.type, quantity_delta: m.quantity_delta, conversion_id: m.conversion_id })),
        ui_pack_rows: uiPackRows.map((r) => r.raw),
        ui_unit_rows: uiUnitRows.map((r) => r.raw),
        ui_stock: { [pack.sku]: uiPackStock, [unit.sku]: uiUnitStock },
      };
      const problems = diffNumberMaps({ [pack.id]: wantPack, [unit.id]: wantUnit }, diff.stockDelta, labels).map((d) => `stock · ${d}`);
      const judged = judgeUiVsDb({ what: "movimiento(s) de conversión", uiClaim: claim, expectedDocs: variant.ok ? 2 : 0, createdDocs: diff.movements.length });
      if (judged.verdict === "fail") problems.unshift(judged.detail);
      if (variant.ok) {
        const out = diff.movements.find((m) => m.type === "conversion_salida");
        const inn = diff.movements.find((m) => m.type === "conversion_entrada");
        if (out?.quantity_delta !== wantPack || inn?.quantity_delta !== wantUnit || !out?.conversion_id || out.conversion_id !== inn?.conversion_id) {
          problems.push(`movimientos de conversión en base: ${JSON.stringify(diff.movements.map((m) => [m.type, m.quantity_delta, m.conversion_id]))}`);
        }
        if (!uiPackRows.some((r) => /conversi[oó]n salida/i.test(r.type) && r.quantity === wantPack)) problems.push("la UI no muestra la fila «Conversion salida» del empaque");
        if (!uiUnitRows.some((r) => /conversi[oó]n entrada/i.test(r.type) && r.quantity === wantUnit)) problems.push("la UI no muestra la fila «Conversion entrada» de la unidad");
      }
      const dbPack = (before.stock[pack.id] ?? 0) + (diff.stockDelta[pack.id] ?? 0);
      const dbUnit = (before.stock[unit.id] ?? 0) + (diff.stockDelta[unit.id] ?? 0);
      if (uiPackStock !== dbPack || uiUnitStock !== dbUnit) problems.push(`detalle: empaque ${uiPackStock}/${dbPack}, unidad ${uiUnitStock}/${dbUnit} (UI/base)`);
      // STK-607: el motivo se lee en el diálogo, en español y sin la burbuja nativa.
      if (!variant.ok && seen) {
        const message = judgeRejectionMessage({ what: "Abrir empaque sin stock", ...seen, explains: NO_STOCK_MESSAGE, nativeValidation: nativeMessage });
        if (message.verdict === "fail") problems.push(message.detail);
      }
      if (problems.length > 0) rec.set("fail", problems.join(" · "));
      else if (!variant.ok && status !== null && status >= 500) rec.set("finding", `Sin movimientos, pero el servidor respondió ${status} (tocaba 400). UI: «${text}».`);
      else rec.set("pass", variant.ok ? "" : `UI: «${seen?.text ?? text}»${seen?.box ? ` a la vista (y=${Math.round(seen.box.y)} px de ${seen.viewport.height})` : ""} · HTTP ${status ?? "sin petición"}.`);
    });
  }
}

// ---------------------------------------------------------------------------
// F8 · Cancelar venta desde su detalle
// ---------------------------------------------------------------------------

/** El ErrorState de las acciones del detalle de venta: título + motivo del servidor. */
function saleActionError(page: Page): Locator {
  return page.getByText("No pudimos actualizar la venta", { exact: true }).locator("xpath=..");
}

async function uiCancelSale(rec: CaseRec, page: Page, saleId: string, double: boolean): Promise<{ claim: UiClaim; text: string; statuses: number[]; rejection: SeenMessage }> {
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "PATCH" && /\/api\/sales\/[^/]+\/cancel$/.test(new URL(response.url()).pathname)) {
      statuses.push(response.status());
    }
  });
  await rec.goto(page, `/sales/${saleId}`);
  const actions = page.getByRole("button", { name: "Acciones de la venta" });
  await actions.waitFor({ state: "visible", timeout: NAV_TIMEOUT });
  rec.say("Detalle de venta antes de anular", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await rec.shot(page, "venta-detalle");
  await actions.click();
  rec.say("Detalle de venta · menú Acciones", (await page.getByRole("menuitem").allInnerTexts()).map((t) => t.trim()).join(" / "));
  const item = page.getByRole("menuitem", { name: "Anular venta" });
  if ((await item.count()) === 0 || (await item.isDisabled().catch(() => false)) || (await item.getAttribute("aria-disabled")) === "true") {
    await rec.shot(page, "menu-sin-anular");
    return { claim: "error", text: "la opción «Anular venta» no está disponible", statuses, rejection: await measureMessage(page, saleActionError(page)) };
  }
  await item.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  rec.say("Diálogo Confirmar anulacion", await dialog.innerText());
  await rec.shot(page, "dialogo-anular");
  const confirm = dialog.getByRole("button", { name: /Anular venta|Procesando/ });
  if (double) await confirm.dblclick();
  else await confirm.click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1_200);
  const texts = await sayScreen(rec, page, "Detalle de venta tras confirmar la anulación");
  const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  rec.say("Detalle de venta tras anular · cabecera", main.slice(0, 300));
  await rec.shot(page, "tras-anular");
  // El aviso (título + motivo) se mide ANTES de cualquier scroll: es lo que ve el cajero.
  const rejection = await measureMessage(page, saleActionError(page));
  if (rejection.text) {
    rec.say("Detalle de venta · aviso del rechazo", `«${rejection.text}» en ${JSON.stringify(rejection.box)} con ventana ${rejection.viewport.width}×${rejection.viewport.height}`);
    const top = rejection.box?.y ?? -1;
    if (top < 0 || top >= rejection.viewport.height) {
      await saleActionError(page).first().scrollIntoViewIfNeeded();
      await rec.shot(page, "error-fuera-de-la-vista");
    }
  }
  const errorShown = /No pudimos actualizar la venta/i.test(main) || texts.some((t) => /no pudimos|error|no se puede|pagos/i.test(t));
  const cancelledShown = /cancelada|anulada/i.test(main.slice(0, 400));
  const shownError = /No pudimos actualizar la venta.{0,260}/i.exec(main)?.[0]?.trim() ?? texts.join(" · ");
  return { claim: errorShown ? "error" : cancelledShown ? "success" : "none", text: errorShown ? shownError : cancelledShown ? "estado Cancelada" : "", statuses, rejection };
}

async function flow08(lab: Lab): Promise<void> {
  const quantity = 3;
  await runCase(
    lab,
    { n: 8, sub: "unpaid_double_click", title: "Anular venta pendiente de pago desde su detalle (doble clic) → un movimiento inverso", hypothesis: ["H7", "H8"] },
    async (rec) => {
      const product = await createProduct(lab, "F8-PEND", { stock: 10 });
      rec.track(product);
      const sale = await apiUnpaidSale(lab, product, quantity);
      rec.step("API POST /api/sales (sin pagos)", { as: lab.sellerKey, status: 201, response_id: sale.id });
      const before = await snapshot(lab.db, [product.id]);
      const page = await rec.open(lab.sellerKey);
      const outcome = await uiCancelSale(rec, page, sale.id, true);
      rec.step("UI doble clic Anular venta", { as: lab.sellerKey, status: outcome.statuses[0], note: `PATCH cancel enviados=${outcome.statuses.length} (${outcome.statuses.join(",")})` });
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const adminPage = await rec.open("admin");
      const uiRows = await uiMovements(rec, adminPage, product, "movimientos");
      const uiReverse = uiRows.filter((row) => (row.quantity ?? 0) > 0 && !/inventario inicial/i.test(row.type));
      const uiStock = await uiProductStock(rec, adminPage, product, "detalle-producto");
      rec.expected = {
        sale_status: "pendiente_pago→cancelada",
        stock_delta: { [product.sku]: quantity },
        movements: [{ type: "ajuste_entrada|devolucion_cliente", quantity_delta: quantity, sale_id: sale.id }],
        ui: `una fila inversa +${quantity} y stock 10`,
      };
      rec.actual = {
        ui_claim: outcome.claim,
        ui_text: outcome.text,
        cancel_requests: outcome.statuses,
        sale_status: diff.statusChanges[sale.id] ?? "(sin cambio)",
        stock_delta: { [product.sku]: diff.stockDelta[product.id] ?? 0 },
        movements: diff.movements.map((m) => ({ type: m.type, quantity_delta: m.quantity_delta, sale_id: m.sale_id })),
        ui_reverse_rows: uiReverse.map((r) => r.raw),
        ui_stock: uiStock,
      };
      const problems: string[] = [];
      const judged = judgeUiVsDb({ what: "movimiento(s) inverso(s)", uiClaim: outcome.claim, expectedDocs: 1, createdDocs: diff.movements.length });
      if (judged.verdict === "fail") problems.push(judged.detail);
      if (diff.statusChanges[sale.id] !== "pendiente_pago→cancelada") problems.push(`estado de la venta: ${diff.statusChanges[sale.id] ?? "sin cambio"}`);
      if ((diff.stockDelta[product.id] ?? 0) !== quantity) problems.push(`stock: esperado +${quantity}, real ${diff.stockDelta[product.id] ?? 0}`);
      if (diff.movements.length === 1 && (diff.movements[0]?.quantity_delta !== quantity || diff.movements[0]?.sale_id !== sale.id)) problems.push(`movimiento inverso: ${JSON.stringify(diff.movements[0])}`);
      if (uiReverse.length !== 1 || uiReverse[0]?.quantity !== quantity) problems.push(`la UI muestra ${uiReverse.length} fila(s) inversa(s) (${uiReverse.map((r) => `${r.type} ${r.quantity}`).join(";")})`);
      if (uiStock !== 10) problems.push(`el detalle muestra stock ${uiStock}, esperado 10`);
      const info = `PATCH cancel enviados: ${outcome.statuses.length} (${outcome.statuses.join(",")}); tipo del movimiento inverso: ${diff.movements.map((m) => m.type).join(",") || "—"}.`;
      if (problems.length > 0) rec.set("fail", `${problems.join(" · ")} · ${info}`);
      else if (outcome.statuses.some((s) => s >= 500)) rec.set("finding", `Stock correcto, pero una petición de anulación devolvió 5xx. ${info}`);
      else if (outcome.statuses.length > 1) rec.set("finding", `Stock correcto, pero el doble clic envió ${outcome.statuses.length} PATCH cancel: el botón no bloquea el segundo envío. ${info}`);
      else rec.set("pass", info);
    },
  );

  await runCase(
    lab,
    { n: 8, sub: "paid", scope: "extra", title: "Anular venta pagada desde su detalle → rechazo explicado y base intacta", hypothesis: ["H7", "H8"] },
    async (rec) => {
      const product = await createProduct(lab, "F8-PAGADA", { stock: 10 });
      rec.track(product);
      // La venta pagada se hace por el POS real.
      const posPage = await rec.open(lab.sellerKey);
      await openPos(rec, posPage);
      await posAdd(posPage, product, quantity);
      await posPickCash(posPage);
      await processButton(posPage).click();
      const sold = await posOutcome(posPage, 30_000);
      if (sold.claim !== "success") throw new Error(`No se pudo crear la venta pagada por el POS: ${sold.claim} «${sold.text}»`);
      await posDismissSuccess(posPage);
      const before = await snapshot(lab.db, [product.id]);
      const sale = before.sales[0];
      if (!sale) throw new Error("La venta pagada no aparece en la base.");
      rec.step("UI POS venta pagada", { as: lab.sellerKey, response_id: sale.id, note: `${sale.invoice_number} ${sale.status}` });

      const outcome = await uiCancelSale(rec, posPage, sale.id, false);
      rec.step("UI Anular venta (pagada)", { as: lab.sellerKey, status: outcome.statuses[0], note: `PATCH cancel=${outcome.statuses.join(",") || "ninguno"}` });
      const diff = diffSnapshots(before, await snapshot(lab.db, [product.id]));
      const adminPage = await rec.open("admin");
      const uiRows = await uiMovements(rec, adminPage, product, "movimientos");
      const uiStock = await uiProductStock(rec, adminPage, product, "detalle-producto");
      const dbStock = (before.stock[product.id] ?? 0) + (diff.stockDelta[product.id] ?? 0);
      const cancelled = diff.statusChanges[sale.id]?.endsWith("cancelada") ?? false;
      rec.expected = {
        either: [
          "la UI rechaza con un mensaje a la vista sin hacer scroll que explica qué hacer (anular pagos / devolución) y la base no cambia",
          `la venta queda cancelada con un único movimiento inverso +${quantity} y los pagos anulados`,
        ],
      };
      rec.actual = {
        ui_claim: outcome.claim,
        ui_text: outcome.text,
        ui_message: outcome.rejection,
        cancel_requests: outcome.statuses,
        sale_status: diff.statusChanges[sale.id] ?? `(sin cambio: ${sale.status})`,
        payment_status_changes: before.payments.map((p) => diff.statusChanges[p.id] ?? "(sin cambio)"),
        stock_delta: { [product.sku]: diff.stockDelta[product.id] ?? 0 },
        movements: diff.movements.map((m) => ({ type: m.type, quantity_delta: m.quantity_delta, sale_id: m.sale_id })),
        ui_rows: uiRows.map((r) => r.raw),
        ui_stock: uiStock,
      };
      const problems: string[] = [];
      if (uiStock !== dbStock) problems.push(`el detalle muestra stock ${uiStock} y la base ${dbStock}`);
      if (cancelled) {
        if (outcome.claim !== "success") problems.push(`la venta quedó cancelada y la UI dijo ${outcome.claim} («${outcome.text}»)`);
        if (diff.movements.length !== 1 || diff.movements[0]?.quantity_delta !== quantity) problems.push(`movimientos inversos: ${JSON.stringify(diff.movements.map((m) => [m.type, m.quantity_delta]))}`);
        if ((diff.stockDelta[product.id] ?? 0) !== quantity) problems.push(`stock: esperado +${quantity}, real ${diff.stockDelta[product.id] ?? 0}`);
      } else {
        if (outcome.claim === "success") problems.push("la UI muestra la venta como cancelada y en la base no lo está");
        if (diff.movements.length > 0 || (diff.stockDelta[product.id] ?? 0) !== 0) problems.push(`la anulación rechazada movió stock (${diff.stockDelta[product.id] ?? 0})`);
        if (diff.statusChanges[sale.id]) problems.push(`la anulación rechazada cambió el estado de la venta: ${diff.statusChanges[sale.id]}`);
        // STK-607: el rechazo se lee sin desplazarse y dice qué hacer.
        const message = judgeRejectionMessage({ what: "Anular venta pagada", ...outcome.rejection, explains: /pago|devoluci/i });
        if (message.verdict === "fail") problems.push(message.detail);
      }
      const info = `UI: ${outcome.claim} «${outcome.text}»; PATCH cancel: ${outcome.statuses.join(",") || "ninguno"}; venta ${diff.statusChanges[sale.id] ?? sale.status}; movimientos nuevos ${diff.movements.length}.`;
      if (problems.length > 0) rec.set("fail", `${problems.join(" · ")} · ${info}`);
      else if (outcome.statuses.some((s) => s >= 500)) rec.set("finding", `La anulación de una venta pagada respondió 5xx. ${info}`);
      else rec.set("pass", info);
    },
  );
}

// ---------------------------------------------------------------------------
// F9 / F10 · Stock inicial al crear producto (formulario e import Excel) — H9
// ---------------------------------------------------------------------------

async function judgeInitialStock(
  rec: CaseRec,
  page: Page,
  wanted: { sku: string; name: string; stock: number }[],
  uiClaim: UiClaim,
  uiText: string,
): Promise<void> {
  const lab = rec.lab;
  const ids = await productIdsBySku(lab.db, wanted.map((w) => w.sku));
  const found = wanted.filter((w) => ids[w.sku]);
  for (const id of Object.values(ids)) rec.track(id);
  const snap = await snapshot(lab.db, Object.values(ids));
  const perProduct: Record<string, unknown>[] = [];
  const problems: string[] = [];
  const missingMovement: string[] = [];
  for (const item of wanted) {
    const id = ids[item.sku];
    if (!id) {
      perProduct.push({ sku: item.sku, created: false });
      continue;
    }
    const product: LabProduct = { id, sku: item.sku, name: item.name, price: 0 };
    const moves = snap.movements.filter((m) => m.product_id === id);
    const initial = moves.filter((m) => m.type === "inventario_inicial");
    const uiRows = await uiMovements(rec, page, product, `movimientos-${item.sku.slice(-4)}`);
    const uiInitial = uiRows.filter((row) => /inventario inicial/i.test(row.type));
    const uiStock = await uiProductStock(rec, page, product, `detalle-${item.sku.slice(-4)}`);
    const dbStock = snap.stock[id] ?? 0;
    perProduct.push({
      sku: item.sku,
      created: true,
      stock_typed: item.stock,
      db_current_stock: dbStock,
      db_movements: moves.map((m) => ({ type: m.type, quantity_delta: m.quantity_delta, stock_after: m.stock_after })),
      ui_movement_rows: uiRows.map((r) => r.raw),
      ui_stock: uiStock,
    });
    if (dbStock !== item.stock) problems.push(`${item.sku}: current_stock ${dbStock}, tecleado ${item.stock}`);
    if (uiStock !== dbStock) problems.push(`${item.sku}: el detalle muestra ${uiStock} y la base ${dbStock}`);
    if (initial.length !== 1 || initial[0]?.quantity_delta !== item.stock) missingMovement.push(item.sku);
    if (uiInitial.length !== initial.length) problems.push(`${item.sku}: la UI muestra ${uiInitial.length} fila(s) «Inventario inicial» y la base ${initial.length}`);
  }
  rec.expected = {
    products: wanted.length,
    per_product: "current_stock = stock inicial tecleado y un movimiento inventario_inicial por esa cantidad, visible en /inventory/movements",
  };
  rec.actual = { ui_claim: uiClaim, ui_text: uiText, products_created: found.length, per_product: perProduct };
  const judged = judgeUiVsDb({ what: "producto(s)", uiClaim, expectedDocs: wanted.length, createdDocs: found.length });
  if (judged.verdict === "fail") problems.unshift(judged.detail);
  if (missingMovement.length > 0) {
    problems.push(
      `H9: ${missingMovement.length} de ${wanted.length} producto(s) nacen con stock y SIN movimiento «inventario_inicial» (${missingMovement.join(", ")}): el stock no cuadra con el libro de movimientos y /inventory/movements no lo muestra`,
    );
  }
  rec.set(problems.length > 0 ? "fail" : "pass", problems.join(" · "));
}

async function flow09(lab: Lab): Promise<void> {
  await runCase(
    lab,
    { n: 9, title: "Crear producto con stock inicial por el formulario → movimiento inventario_inicial", hypothesis: ["H9", "H8"] },
    async (rec) => {
      const sku = `u404-${lab.tag}-f9-form`.toLowerCase();
      const name = `U404 ${lab.tag} F9-FORM`;
      const stock = 15;
      const page = await rec.open("admin");
      await rec.goto(page, "/products");
      await page.getByRole("button", { name: "Nuevo producto" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.getByLabel("Nombre", { exact: true }).fill(name);
      await dialog.getByLabel("SKU", { exact: true }).fill(sku);
      await dialog.getByLabel("Categoria").selectOption({ label: lab.categoryName }).catch(() => undefined);
      await dialog.getByLabel("Costo ref").fill("0.6");
      await dialog.getByLabel("Precio ref").fill("1");
      await dialog.getByLabel("Stock inicial").fill(String(stock));
      await dialog.getByLabel("Stock minimo").fill("0");
      rec.say("Diálogo Crear producto · etiquetas", (await dialog.locator("label").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).join(" / "));
      await rec.shot(page, "formulario");
      const posted = page
        .waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/products", { timeout: NAV_TIMEOUT })
        .catch(() => null);
      await page.getByRole("button", { name: /^Crear producto$|Guardando|Creando/ }).last().click();
      const response = await posted;
      await page.waitForTimeout(1_000);
      const stillOpen = await dialog.isVisible().catch(() => false);
      const text = stillOpen ? await dialogText(dialog) : "(el diálogo se cerró sin mensaje)";
      rec.say("Diálogo Crear producto tras enviar", text);
      await rec.shot(page, "tras-crear");
      rec.step("UI Crear producto con Stock inicial 15", { as: "admin", status: response?.status(), note: response ? "" : "no salió ningún POST" });
      if (stillOpen) await page.keyboard.press("Escape");
      await judgeInitialStock(rec, page, [{ sku, name, stock }], stillOpen ? "error" : "success", text);
    },
  );
}

async function flow10(lab: Lab): Promise<void> {
  await runCase(
    lab,
    { n: 10, title: "Import Excel con stock_inicial > 0 en 3 filas → un movimiento inventario_inicial por producto", hypothesis: ["H9", "H8"] },
    async (rec) => {
      const rows = buildImportRows(`u404-${lab.tag}-f10-`, `U404 ${lab.tag} F10`, lab.categoryName, 3);
      const file = join(lab.shotsDir, `f10-import-${lab.tag}.xlsx`);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildImportSheetAoa(rows)), IMPORT_SHEET_NAME);
      XLSX.writeFile(workbook, file);
      rec.evidence.push(file);

      const page = await rec.open("admin");
      const posts: number[] = [];
      page.on("response", (response) => {
        if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/products") posts.push(response.status());
      });
      await rec.goto(page, "/products/import");
      const fileInput = page.locator('input[type="file"]');
      const advance = page.getByRole("button", { name: /Siguiente|Continuar|Subir archivo|Ya tengo|Comenzar|Importar/ });
      // Paso 1 → 2: avanzar hasta que exista el campo de archivo.
      for (let i = 0; i < 3 && (await fileInput.count()) === 0; i += 1) {
        rec.say(`Import · botones del paso ${i + 1}`, (await page.locator("main").getByRole("button").allInnerTexts()).map((t) => t.trim()).join(" / "));
        await advance.first().click();
        await page.waitForTimeout(500);
      }
      await fileInput.setInputFiles(file);
      await page.waitForTimeout(1_500);
      rec.say("Import · tras elegir archivo", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 500));
      await rec.shot(page, "archivo");
      // Paso 2 → 3 (preview) → 4 (importación): pulsar el botón de avance mientras exista.
      for (let i = 0; i < 4; i += 1) {
        const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
        if (/Resumen de Importación/i.test(main)) break;
        const buttons = (await page.locator("main").getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
        rec.say(`Import · pantalla ${i + 1}`, `${main.slice(0, 260)} … botones: ${buttons.join(" / ")}`);
        if (/Vista Previa de Datos/i.test(main)) await rec.shot(page, "preview");
        const next = page.locator("main").getByRole("button", { name: /Importar|Siguiente|Continuar|Confirmar|Validar/ }).last();
        if ((await next.count()) === 0 || (await next.isDisabled())) {
          await page.waitForTimeout(2_000);
          continue;
        }
        await next.click();
        await page.waitForTimeout(2_500);
      }
      await page.getByText(/Resumen de Importación/i).first().waitFor({ state: "visible", timeout: 60_000 });
      const summary = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      rec.say("Import · Resumen de Importación", summary.slice(0, 600));
      await rec.shot(page, "resumen");
      rec.step("UI Import Excel (3 filas con stock_inicial 7/14/21)", { as: "admin", status: posts[0], note: `POST /api/products=${posts.join(",")}` });
      const okCount = posts.filter((status) => status >= 200 && status < 300).length;
      await judgeInitialStock(
        rec,
        page,
        rows.map((row) => ({ sku: row.sku, name: row.nombre, stock: row.stock_inicial })),
        okCount === rows.length ? "success" : okCount === 0 ? "error" : "success",
        summary.slice(0, 300),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Catálogo de flujos
// ---------------------------------------------------------------------------

export type FlowDef = { n: number; title: string; run: (lab: Lab) => Promise<void> };

export const FLOWS: readonly FlowDef[] = [
  { n: 1, title: "POS: vender → movimiento y stock exactos", run: flow01 },
  { n: 2, title: "POS con 3G lento: doble clic (y triple, y 3 en la misma tarea) → una sola venta", run: flow02 },
  { n: 3, title: "POS: respuesta perdida tras confirmar (Verificar, Limpiar orden, recarga, salir y volver) → una venta", run: flow03 },
  { n: 4, title: "Compra en modo empaque por UI → recibir → unidades correctas", run: flow04 },
  { n: 5, title: "Compra pedido: ¿la UI deja claro que el stock no entró?", run: flow05 },
  { n: 6, title: "Ajuste desde inventario (entrada, salida, salida > stock; sin devoluciones en el modal)", run: flow06 },
  { n: 7, title: "Conversión desde el detalle del producto empaque", run: flow07 },
  { n: 8, title: "Cancelar venta desde su detalle → movimiento inverso", run: flow08 },
  { n: 9, title: "Crear producto con stock inicial → movimiento inventario_inicial", run: flow09 },
  { n: 10, title: "Import Excel con stock_inicial → movimiento inventario_inicial", run: flow10 },
];

/** Ejecuta un flujo; si revienta fuera de sus casos (p. ej. alta de datos) deja un `error` propio. */
export async function runFlow(lab: Lab, flow: FlowDef): Promise<void> {
  try {
    await flow.run(lab);
  } catch (error) {
    lab.onResult({
      ts: new Date().toISOString(),
      suite: "ui",
      id: flowId(flow.n),
      scope: "plan",
      title: flow.title,
      hypothesis: [],
      steps: [],
      ui_says: [],
      expected: {},
      actual: {},
      reconcile_scoped: {},
      reconcile_global: {},
      verdict: "error",
      detail: errorText(error),
      evidence: [],
    });
  }
}


