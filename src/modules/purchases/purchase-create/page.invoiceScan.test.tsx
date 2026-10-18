import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceReviewDraft } from "./invoice-scan/reviewDraft";

/**
 * SCN-07 · «Escanear factura» en la compra nueva: solo con `purchases.create`,
 * `?scan=1` lo abre al entrar (y se limpia de la URL) y el `ProcessGuard` nombra
 * el escaneo mientras está en curso. El modal se reduce a botones: sus tests son aparte.
 *
 * SCN-08c · La factura leída se revisa en la misma página (en lugar del formulario) y
 * «Cargar» la pone en el formulario: líneas bloqueadas, proveedor, moneda y número; el
 * escaneo viaja en el borrador local y en `POST /api/purchases` con las cifras finales.
 * La revisión se reduce a botones (sus tests son aparte), igual que proveedor y líneas.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCan = jest.fn();
let mockReviewDraft: InvoiceReviewDraft;
let mockExchangeRate: { data: { rateVes: number } | undefined; error: Error | null };

function mockBuildTaxRate(code: string, label: string, pct: number, sortOrder: number) {
  return { code, id: `tax-${code}`, isActive: true, isDefault: code === "general", isGlobal: true, label, pct, sortOrder };
}

const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    mockBuildTaxRate("exento", "Exento", 0, 10),
    mockBuildTaxRate("reducida", "Reducida", 8, 20),
    mockBuildTaxRate("general", "General", 16, 30),
    { ...mockBuildTaxRate("lujo", "Lujo", 31, 40), isActive: false },
  ],
  refetch: jest.fn(),
};

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockExchangeRate,
}));
jest.mock("../../settings/hooks/useSettings", () => ({
  settingsQueryKeys: { paymentMethods: () => ["settings", "payment-methods"] },
  usePricingSettings: () => ({ data: undefined }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockCan(permission),
    isLoading: false,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: ({
    onSupplierChange,
    selectedSupplierId,
  }: {
    onSupplierChange: (id: string, name?: string) => void;
    selectedSupplierId: string;
  }) => (
    <div>
      <p>proveedor: {selectedSupplierId || "ninguno"}</p>
      <button onClick={() => onSupplierChange("cont-supplier", "Proveedor Demo")} type="button">
        elegir proveedor
      </button>
      <button
        onClick={() => onSupplierChange("33333333-3333-4333-8333-333333333333", "Chevere Depot")}
        type="button"
      >
        elegir chevere
      </button>
    </div>
  ),
}));
// Cada línea es un renglón con lo que la página resolvió y botones para tocarla.
jest.mock("./components/PurchaseProductPickerCard", () => {
  type PickerProps = Parameters<
    typeof import("./components/PurchaseProductPickerCard").PurchaseProductPickerCard
  >[0];

  return {
    PurchaseProductPickerCard: ({
      getItemMeta,
      lines,
      lockControls,
      onAddProduct,
      onRemoveItem,
      onUpdateItem,
    }: PickerProps) => (
      <div>
        <ul aria-label="líneas">
          {lines.map(({ disassemble, item, locked, tax }) => {
            const name = getItemMeta(item.productId).name;

            return (
              <li key={item.id}>
                <span>
                  {[
                    name,
                    item.entryMode === "pack"
                      ? `${item.packCount} ${item.packLabel} de ${item.unitsPerPack} a REF ${item.packCostRef}`
                      : `${item.quantity} u a REF ${item.unitCostRef} / Bs ${item.unitCostVes}`,
                    `en ${item.costCurrency}`,
                    `IVA ${tax.code}`,
                    locked ? "bloqueada" : "libre",
                    ...(disassemble === true ? ["desarmar"] : []),
                  ].join(" · ")}
                </span>
                <button onClick={() => lockControls?.onToggleLine(item.id, false)} type="button">
                  desbloquear {name}
                </button>
                <button
                  onClick={() => onUpdateItem(item.id, { quantity: 3, unitCostRef: 11, unitCostVes: 5500 })}
                  type="button"
                >
                  editar {name}
                </button>
                <button onClick={() => onRemoveItem(item.id)} type="button">
                  quitar {name}
                </button>
              </li>
            );
          })}
        </ul>
        <button
          onClick={() =>
            onAddProduct({
              costWithTaxRef: 2.32,
              currentStock: 0,
              link: "none",
              name: "Cable HDMI",
              packUnits: [],
              productId: "prod-cable",
              sku: "ELE-CAB-001",
              taxRate: 16,
              unitCostRef: 2,
            })
          }
          type="button"
        >
          agregar cable
        </button>
      </div>
    ),
  };
});
jest.mock("../../invoice-scan/client/components/InvoiceScanModal", () => ({
  InvoiceScanModal: ({
    onBusyChange,
    onOpenChange,
    onScanned,
  }: {
    onBusyChange: (busy: boolean) => void;
    onOpenChange: (open: boolean) => void;
    onScanned: (response: unknown) => void;
  }) => (
    <div data-testid="invoice-scan-modal">
      <button onClick={() => onBusyChange(true)} type="button">
        empezar escaneo
      </button>
      <button onClick={() => onBusyChange(false)} type="button">
        terminar escaneo
      </button>
      <button
        onClick={() => onScanned({ scanId: "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c" })}
        type="button"
      >
        factura leída
      </button>
      <button
        onClick={() =>
          onScanned({
            confirmedPurchase: { id: "purchase-001", purchaseNumber: "C-000001" },
            scanId: "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
          })
        }
        type="button"
      >
        factura ya confirmada
      </button>
      <button onClick={() => onOpenChange(false)} type="button">
        cerrar escaneo
      </button>
    </div>
  ),
}));
jest.mock("./invoice-scan/components/InvoiceReviewPanel", () => ({
  InvoiceReviewPanel: ({
    canCreateProduct,
    context,
    onDiscard,
    onLoad,
    onRescan,
    response,
  }: {
    canCreateProduct?: boolean;
    context: { systemRateVes?: number; taxRates: Record<string, number> };
    onDiscard: () => void;
    onLoad: (draft: InvoiceReviewDraft) => void;
    onRescan: () => void;
    response: { scanId: string };
  }) => (
    <section aria-label="Revisión de la factura">
      <p>
        {[
          `escaneo ${response.scanId}`,
          `tasa ${context.systemRateVes ?? "sin tasa"}`,
          `alícuotas ${Object.entries(context.taxRates)
            .map(([code, pct]) => `${code}=${pct}`)
            .join(",")}`,
          `crear ${canCreateProduct ? "sí" : "no"}`,
        ].join(" · ")}
      </p>
      <button onClick={() => onLoad(mockReviewDraft)} type="button">
        Cargar en la compra
      </button>
      <button onClick={onDiscard} type="button">
        Descartar escaneo
      </button>
      <button onClick={onRescan} type="button">
        Repetir foto
      </button>
    </section>
  ),
}));

import { jsonResponse, createQueryWrapper } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";
import Link from "next/link";

import { buildInvoiceReviewDraft } from "./invoice-scan/reviewDraft";
import {
  makeLoadedReviewDraft,
  makeReviewResponse,
  productUuid,
  REVIEW_SCAN_ID,
  REVIEW_SUPPLIER_ID,
  REVIEW_TAX_RATES,
} from "./invoice-scan/reviewFixtures";
import { createInvoiceReviewState, reviewReducer } from "./invoice-scan/reviewModel";
import { INVOICE_SCAN_NOT_LINKED_MESSAGE, PurchaseCreatePage } from "./page";
import { purchaseDraftStorageKey } from "./utils/purchaseDraftStorage";

const draftKey = purchaseDraftStorageKey({ storeId: "store-1", userId: "user-1" });
const DISCARD_URL = `/api/purchases/invoice-scan/${REVIEW_SCAN_ID}/discard`;

function storeProduct(id: string, name: string, taxRate: number) {
  return {
    barcode: null,
    category: { id: `cat-${taxRate}`, isActive: true, name: `IVA ${taxRate}`, taxRate },
    categoryId: `cat-${taxRate}`,
    currentCostRef: 9,
    currentStock: 7,
    id,
    isActive: true,
    minStock: 0,
    name,
    salePriceRef: 12,
    sku: id.toUpperCase(),
  };
}

const PRODUCTS = [
  storeProduct(productUuid(1), "Harina PAN", 16),
  storeProduct(productUuid(3), "Refresco Cola", 0),
  storeProduct("prod-cable", "Cable HDMI", 16),
];
const SUPPLIERS = [
  { id: REVIEW_SUPPLIER_ID, isActive: true, name: "Chevere Depot", type: "proveedor" },
  { id: "cont-supplier", isActive: true, name: "Proveedor Demo", type: "proveedor" },
];
/** La caja de refresco tiene receta de apertura: su línea ofrece «Desarmar al recibir». */
const RECIPES = [
  {
    id: "rec-refresco",
    linkedProduct: { id: "prod-lata" },
    packProduct: { id: productUuid(3) },
    role: "pack",
    unitsPerPack: 12,
  },
];

type ApiReply = { payload: unknown; status: number };
type ApiOptions = { discard?: ApiReply; purchase?: ApiReply; scanDetail?: ApiReply };
const SCAN_URL = `/api/purchases/invoice-scan/${REVIEW_SCAN_ID}`;

/** `fetch` de prueba: fichas, proveedores, recetas, el alta de la compra y el descarte. */
function installApi({
  discard = { payload: { data: { id: REVIEW_SCAN_ID, status: "discarded" } }, status: 200 },
  purchase = { payload: { data: { id: "purchase-nueva" } }, status: 201 },
  scanDetail,
}: ApiOptions = {}) {
  const posts: Array<{ body: Record<string, unknown> | null; url: string }> = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      posts.push({
        body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        url,
      });
      const reply = url === DISCARD_URL ? discard : purchase;

      return jsonResponse(reply.payload, reply.status);
    }

    if (url === SCAN_URL && scanDetail) {
      return jsonResponse(scanDetail.payload, scanDetail.status);
    }

    if (url.startsWith("/api/inventory/pack-conversions")) {
      return jsonResponse({ data: RECIPES });
    }

    if (/^\/api\/suppliers\/[^/]+\/products/.test(url)) {
      return jsonResponse({ data: { items: [], limit: 100, skip: 0, total: 0 } });
    }

    if (url.startsWith("/api/purchases/suppliers?")) {
      const id = new URL(url, "http://localhost").searchParams.get("id");
      const supplier = SUPPLIERS.find((candidate) => candidate.id === id);

      return supplier
        ? jsonResponse({ data: supplier })
        : jsonResponse({ error: { code: "NOT_FOUND", message: "Proveedor no encontrado." } }, 404);
    }

    const product = PRODUCTS.find((candidate) => url === `/api/products/${candidate.id}`);

    return product ? jsonResponse({ data: product }) : jsonResponse({ data: null });
  }) as unknown as typeof fetch;

  return { posts };
}

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  const view = render(
    <QueryWrapper>
      <ToastProvider>
        <Link href="/sales">Ventas</Link>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );

  return { user: userEvent.setup({ delay: null }), view };
}

function scanButton() {
  return screen.queryByRole("button", { name: "Escanear factura" });
}

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const reviewPanel = () => screen.queryByRole("region", { name: "Revisión de la factura" });
const linesList = () => screen.queryByRole("list", { name: "líneas" });
// `hidden`: también con un modal abierto encima (Radix oculta el resto a la accesibilidad).
const lineTexts = () =>
  within(screen.getByRole("list", { hidden: true, name: "líneas" }))
    .queryAllByRole("listitem", { hidden: true })
    .map((line) => line.firstChild?.textContent);
const notesField = () => screen.getByPlaceholderText("Nro. de factura, condiciones...");
const storedDraft = () => {
  const raw = window.localStorage.getItem(draftKey);

  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

/** Abre el escaneo y entrega la factura: la página muestra su revisión. */
function scanInvoice() {
  click("Escanear factura");
  click("factura leída");
}

/** Escanea y carga la factura; espera a que sus líneas estén en el formulario. */
async function scanAndLoad(expectedLines = 2) {
  scanInvoice();
  click("Cargar en la compra");
  await waitFor(() => expect(linesList()).toBeInTheDocument());
  await waitFor(() => expect(lineTexts()).toHaveLength(expectedLines));
}

/** «Confirmar Compra» y el botón del modal; devuelve el body del alta. */
async function confirmPurchase(api: ReturnType<typeof installApi>) {
  click(/Confirmar Compra/);
  click(/^Registrar (compra|pedido)$/);
  await waitFor(() =>
    expect(api.posts.some((post) => post.url === "/api/purchases")).toBe(true),
  );

  return api.posts.find((post) => post.url === "/api/purchases")?.body ?? {};
}

const HARINA_LOCKED = "Harina PAN · 2 u a REF 10 / Bs 5000 · en ves · IVA general · bloqueada";
const REFRESCO_LOCKED = "Refresco Cola · 1 Caja de 12 a REF 24 · en ves · IVA exento · bloqueada · desarmar";

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockCan.mockReset();
  mockCan.mockReturnValue(true);
  mockReviewDraft = makeLoadedReviewDraft();
  mockExchangeRate = { data: { rateVes: 510 }, error: null };
  window.localStorage.clear();
  window.history.replaceState(null, "", "/purchases/create");
  installApi();
});

describe("PurchaseCreatePage · Escanear factura (SCN-07)", () => {
  it("con purchases.create el botón abre el modal de escaneo", async () => {
    const { user } = renderPage();

    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();

    await user.click(scanButton() as HTMLElement);

    expect(screen.getByTestId("invoice-scan-modal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "cerrar escaneo" }));

    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("al leer la factura el modal se cierra (SCN-07-F1)", async () => {
    const { user } = renderPage();

    await user.click(scanButton() as HTMLElement);
    await user.click(screen.getByRole("button", { name: "factura leída" }));

    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("sin purchases.create no hay botón «Escanear factura»", () => {
    mockCan.mockImplementation((permission: string) => permission !== "purchases.create");
    renderPage();

    expect(scanButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("?scan=1 abre el modal al entrar y quita el parámetro con router.replace sin scroll", async () => {
    window.history.replaceState(null, "", "/purchases/create?scan=1&returnTo=%2Fpurchases");
    renderPage();

    expect(await screen.findByTestId("invoice-scan-modal")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/purchases/create?returnTo=%2Fpurchases", { scroll: false });
  });

  it("?scan=1 sin purchases.create no abre nada, pero limpia la URL", async () => {
    mockCan.mockImplementation((permission: string) => permission !== "purchases.create");
    window.history.replaceState(null, "", "/purchases/create?scan=1");
    renderPage();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/purchases/create", { scroll: false }));
    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("sin scan en la URL no navega", () => {
    renderPage();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("con un escaneo en curso el guardia nombra el escaneo; leída la factura nombra la revisión", async () => {
    const { user } = renderPage();

    await user.click(scanButton() as HTMLElement);
    await user.click(screen.getByRole("button", { name: "empezar escaneo" }));

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(guard).toHaveTextContent("Escaneo de factura en curso");
    expect(guard).toHaveTextContent("Si sales ahora, la lectura de la factura se cancela.");

    await user.click(within(guard).getByRole("button", { name: "Seguir aquí" }));
    // Como el modal real: el escaneo deja de estar en curso y luego entrega la factura (que lo cierra).
    await user.click(screen.getByRole("button", { name: "terminar escaneo" }));
    await user.click(screen.getByRole("button", { name: "factura leída" }));

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    const reviewGuard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(reviewGuard).toHaveTextContent("Revisión de factura en curso");
    expect(reviewGuard).toHaveTextContent("Si sales ahora, se pierde lo que revisaste de la factura.");
    expect(reviewGuard).not.toHaveTextContent("Escaneo de factura en curso");
  });
});

describe("PurchaseCreatePage · revisión y carga de la factura (SCN-08c)", () => {
  it("la factura leída muestra la revisión en la página y oculta el formulario", () => {
    renderPage();

    expect(linesList()).toBeInTheDocument();

    scanInvoice();

    expect(reviewPanel()).toHaveTextContent(`escaneo ${REVIEW_SCAN_ID}`);
    // Tasa del sistema (no el respaldo) y solo las alícuotas activas, código → %.
    expect(reviewPanel()).toHaveTextContent("tasa 510");
    expect(reviewPanel()).toHaveTextContent("alícuotas exento=0,reducida=8,general=16 ·");
    expect(reviewPanel()).toHaveTextContent("crear sí");
    expect(linesList()).not.toBeInTheDocument();
    expect(screen.queryByText(/^proveedor:/)).not.toBeInTheDocument();
    // Mientras se revisa no se abre otro escaneo desde la cabecera.
    expect(scanButton()).not.toBeInTheDocument();
  });

  it("sin products.manage la revisión no ofrece crear productos", () => {
    mockCan.mockImplementation((permission: string) => permission !== "products.manage");
    renderPage();

    scanInvoice();

    expect(reviewPanel()).toHaveTextContent("crear no");
  });

  it("«Cargar» pone las líneas bloqueadas con proveedor, moneda y número de la factura", async () => {
    renderPage();

    await scanAndLoad();

    expect(reviewPanel()).not.toBeInTheDocument();
    expect(lineTexts()).toEqual([HARINA_LOCKED, REFRESCO_LOCKED]);
    expect(screen.getByText(`proveedor: ${REVIEW_SUPPLIER_ID}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
    expect(notesField()).toHaveValue("Factura 000123 del 14/10/2026");
    // Bloqueadas: editar no cambia nada hasta desbloquear.
    click("editar Harina PAN");
    expect(lineTexts()[0]).toBe(HARINA_LOCKED);
  });

  it("BAJO-N3 (CIE-03a): el modal «Confirmar compra» muestra el contacto elegido, no el nombre leído", async () => {
    mockReviewDraft = makeLoadedReviewDraft({
      supplier: { contactId: REVIEW_SUPPLIER_ID, name: "PROVEEDOR UNO, C.A" },
    });
    renderPage();

    await scanAndLoad();
    click(/Confirmar Compra/);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Confirmar compra" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Chevere Depot");
    expect(dialog).not.toHaveTextContent("PROVEEDOR UNO");
  });

  it("BAJO-N3 (CIE-03a): si el contacto no se puede leer, el modal usa el nombre de la revisión", async () => {
    mockReviewDraft = makeLoadedReviewDraft({
      supplier: { contactId: REVIEW_SUPPLIER_ID, name: "Nombre de la revisión" },
    });
    installApi();
    const baseFetch = global.fetch;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/purchases/suppliers?")
        ? jsonResponse({ error: { code: "INTERNAL", message: "Falló." } }, 500)
        : baseFetch(input, init),
    ) as unknown as typeof fetch;
    renderPage();

    await scanAndLoad();
    click(/Confirmar Compra/);

    expect(await screen.findByRole("dialog")).toHaveTextContent("Nombre de la revisión");
  });

  it("las notas que ya había no se pisan con el número de la factura", async () => {
    renderPage();

    fireEvent.change(notesField(), { target: { value: "Pago a 15 días" } });
    await scanAndLoad();

    expect(notesField()).toHaveValue("Pago a 15 días");
  });

  it("con líneas del mismo proveedor, las de la factura se añaden sin preguntar", async () => {
    renderPage();

    click("elegir chevere");
    click("agregar cable");
    await scanAndLoad(3);

    expect(screen.queryByRole("dialog", { name: "Reemplazar la compra en curso" })).not.toBeInTheDocument();
    expect(lineTexts().map((line) => line?.split(" · ")[0])).toEqual([
      "Harina PAN",
      "Refresco Cola",
      "Cable HDMI",
    ]);
    // La compra entera pasa a la moneda de la factura.
    expect(lineTexts()[2]).toContain("en ves");
  });

  it("con líneas de otro proveedor pide reemplazar; Cancelar deja la revisión y la compra", async () => {
    renderPage();

    click("elegir proveedor");
    click("agregar cable");
    fireEvent.change(notesField(), { target: { value: "Compra de cables" } });
    scanInvoice();
    click("Cargar en la compra");

    const dialog = screen.getByRole("dialog", { name: "Reemplazar la compra en curso" });

    expect(dialog).toHaveTextContent("La factura es de Chevere Depot");
    expect(dialog).toHaveTextContent("quita su línea, notas y descuento");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Reemplazar la compra en curso" })).not.toBeInTheDocument(),
    );
    expect(reviewPanel()).toBeInTheDocument();

    click("Cargar en la compra");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Reemplazar la compra en curso" })).getByRole("button", {
        name: "Reemplazar la compra",
      }),
    );

    await waitFor(() => expect(linesList()).toBeInTheDocument());
    await waitFor(() => expect(lineTexts()).toEqual([HARINA_LOCKED, REFRESCO_LOCKED]));
    expect(screen.getByText(`proveedor: ${REVIEW_SUPPLIER_ID}`)).toBeInTheDocument();
    expect(notesField()).toHaveValue("Factura 000123 del 14/10/2026");
  });

  it("el borrador local guarda el escaneo y al recargar Restaurar lo conserva para el envío", async () => {
    const api = installApi();
    const first = renderPage();

    await scanAndLoad();
    await waitFor(() =>
      expect(storedDraft()?.invoiceScan).toMatchObject({ scanId: REVIEW_SCAN_ID, version: 1 }),
    );
    first.view.unmount();

    renderPage();
    click("Restaurar");

    await waitFor(() => expect(lineTexts()).toEqual([HARINA_LOCKED, REFRESCO_LOCKED]));

    const body = await confirmPurchase(api);

    expect(body.invoiceScanId).toBe(REVIEW_SCAN_ID);
    expect(body.invoiceScanLines).toEqual([
      { lineIndex: 0, productId: productUuid(1) },
      { lineIndex: 2, packLabel: "Caja", productId: productUuid(3), unitsPerPack: 12 },
    ]);
  });

  it("al confirmar envía los 3 campos con la extracción ajustada a lo editado y avisa de lo aprendido", async () => {
    const api = installApi({
      purchase: {
        payload: { data: { id: "purchase-nueva", invoiceScan: { confirmed: true, learned: 2 } } },
        status: 201,
      },
    });
    renderPage();

    await scanAndLoad();
    click("desbloquear Harina PAN");
    click("editar Harina PAN");

    const body = await confirmPurchase(api);
    const extraction = body.invoiceScanExtraction as { lines: Array<Record<string, unknown>> };

    expect(body.invoiceScanId).toBe(REVIEW_SCAN_ID);
    expect(body.clientRequestId).toEqual(expect.any(String));
    expect(body.invoiceScanLines).toEqual([
      { lineIndex: 0, productId: productUuid(1) },
      { lineIndex: 2, packLabel: "Caja", productId: productUuid(3), unitsPerPack: 12 },
    ]);
    // Cifras finales en Bs de la factura (tasa elegida 500): 3 × Bs 5 500 (REF 11); la caja REF 24 → Bs 12 000.
    expect(extraction.lines.map((line) => [line.quantity, line.unitPrice])).toEqual([
      [3, 5500],
      [1, 10],
      [1, 12000],
    ]);
    expect((body.items as unknown[]).length).toBe(2);
    expect(await screen.findByText("Se aprendieron 2 alias de este proveedor")).toBeInTheDocument();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
  });

  it("CIE-06 (M1): si la compra se crea pero la factura no se vincula (confirmed:false) lo avisa y abre la compra", async () => {
    const api = installApi({
      purchase: {
        payload: { data: { id: "purchase-nueva", invoiceScan: { confirmed: false, learned: null } } },
        status: 201,
      },
    });
    renderPage();

    await scanAndLoad();
    await confirmPurchase(api);

    expect(await screen.findByText(INVOICE_SCAN_NOT_LINKED_MESSAGE)).toBeInTheDocument();
    expect(INVOICE_SCAN_NOT_LINKED_MESSAGE).toMatch(/^La compra se registró pero no se pudo vincular la factura/);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
  });

  it("CIE-09 (R2): la instrucción «No la vuelvas a registrar.» va en su propia línea del toast, para que el recorte móvil del título no la oculte", async () => {
    const api = installApi({
      purchase: {
        payload: { data: { id: "purchase-nueva", invoiceScan: { confirmed: false, learned: null } } },
        status: 201,
      },
    });
    renderPage();

    await scanAndLoad();
    await confirmPurchase(api);

    const title = await screen.findByText("La compra se registró pero no se pudo vincular la factura.");
    const instruction = screen.getByText("No la vuelvas a registrar.");

    expect(title).not.toBe(instruction);
    expect(title).not.toContainElement(instruction);
    expect(title.textContent).not.toMatch(/vuelvas/);
  });

  it("una línea de la factura quitada del formulario no viaja en invoiceScanLines", async () => {
    const api = installApi();
    renderPage();

    await scanAndLoad();
    click("desbloquear Refresco Cola");
    click("quitar Refresco Cola");

    const body = await confirmPurchase(api);

    expect(body.invoiceScanLines).toEqual([{ lineIndex: 0, productId: productUuid(1) }]);
  });

  it("si el servidor rechaza el escaneo (ya confirmado) muestra el motivo y conserva la compra", async () => {
    const api = installApi({
      purchase: {
        payload: { error: { code: "BAD_REQUEST", message: "El escaneo ya fue confirmado" } },
        status: 400,
      },
    });
    renderPage();

    await scanAndLoad();
    await confirmPurchase(api);

    expect(await screen.findByText("El escaneo ya fue confirmado")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(lineTexts()).toEqual([HARINA_LOCKED, REFRESCO_LOCKED]);
  });

  it("«Descartar escaneo» llama al descarte y vuelve al formulario sin tocarlo", async () => {
    const api = installApi();
    renderPage();

    click("elegir proveedor");
    click("agregar cable");
    scanInvoice();
    click("Descartar escaneo");

    expect(reviewPanel()).not.toBeInTheDocument();
    expect(lineTexts().map((line) => line?.split(" · ")[0])).toEqual(["Cable HDMI"]);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    await waitFor(() => expect(api.posts.map((post) => post.url)).toEqual([DISCARD_URL]));
  });

  it("REP-01: «Descartar escaneo» de una factura ya confirmada solo cierra la revisión, sin descarte ni error", async () => {
    const api = installApi();
    renderPage();

    click("Escanear factura");
    click("factura ya confirmada");
    click("Descartar escaneo");

    expect(reviewPanel()).not.toBeInTheDocument();
    await waitFor(() => expect(linesList()).toBeInTheDocument());
    expect(api.posts).toEqual([]);
    expect(screen.queryByText("No pudimos descartar el escaneo")).not.toBeInTheDocument();
  });

  it("si el descarte falla lo dice en español", async () => {
    installApi({
      discard: {
        payload: { error: { code: "CONFLICT", message: "Este escaneo ya estaba descartado." } },
        status: 409,
      },
    });
    renderPage();

    scanInvoice();
    click("Descartar escaneo");

    expect(await screen.findByText("No pudimos descartar el escaneo")).toBeInTheDocument();
    expect(screen.getByText("Este escaneo ya estaba descartado.")).toBeInTheDocument();
    expect(linesList()).toBeInTheDocument();
  });

  it("«Repetir foto» descarta la revisión y reabre el escaneo", async () => {
    const api = installApi();
    renderPage();

    scanInvoice();
    click("Repetir foto");

    expect(reviewPanel()).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-scan-modal")).toBeInTheDocument();
    await waitFor(() => expect(api.posts.map((post) => post.url)).toEqual([DISCARD_URL]));
  });
});

describe("PurchaseCreatePage · factura cargada sin tasa del día (SCN-08-F1, 6.7)", () => {
  beforeEach(() => {
    mockExchangeRate = { data: undefined, error: new Error("No hay tasa del día.") };
  });

  it("el formulario y el alta usan la tasa elegida en la revisión, nunca el respaldo de 510", async () => {
    const api = installApi();
    mockReviewDraft = makeLoadedReviewDraft({ invoiceRateVes: 500, rateVes: 500 });
    renderPage();

    await scanAndLoad();

    expect(lineTexts()[0]).toBe(
      "Harina PAN · 2 u a REF 10 / Bs 5000 · en ves · IVA general · bloqueada",
    );

    const body = await confirmPurchase(api);
    const items = body.items as Array<Record<string, unknown>>;

    expect(body.refRateVes).toBe(500);
    expect(items[0]).toMatchObject({ unitCostVes: 5000 });
  });

  it("factura en dólares sin ninguna tasa: no deja confirmar y lo dice en español", async () => {
    const api = installApi();
    const usdDraft = makeLoadedReviewDraft();
    delete usdDraft.invoiceRateVes;
    delete usdDraft.rateVes;
    mockReviewDraft = usdDraft;
    renderPage();

    await scanAndLoad();
    click(/Confirmar Compra/);

    expect(
      await screen.findByText(
        "No hay tasa del día ni tasa de la factura: registra la tasa del día para confirmar la compra.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Registrar (compra|pedido)$/ })).not.toBeInTheDocument();
    expect(api.posts.some((post) => post.url === "/api/purchases")).toBe(false);
  });

  it("compra manual sin escaneo: sigue con el respaldo de siempre", async () => {
    const api = installApi();
    renderPage();

    click("elegir proveedor");
    click("agregar cable");

    const body = await confirmPurchase(api);

    expect(body.refRateVes).toBe(510);
  });
});

describe("PurchaseCreatePage · tasa de la factura distinta de la del día (SCN-UI-C1, 6.20)", () => {
  /** Revisión real: Harina 2 × Bs 700,52 con tasa impresa 875,65 y tasa del día 900. */
  function printedRateDraft(
    choice: "printed" | "system",
    read: { lineTotal: number; quantity: number; unitPrice: number } = {
      lineTotal: 1401.04,
      quantity: 2,
      unitPrice: 700.52,
    },
  ) {
    let state = createInvoiceReviewState(
      makeReviewResponse({
        extraction: { printedRate: 875.65 },
        lines: [{ read }],
      }),
      { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    );
    state = reviewReducer(state, { choice, type: "setRateChoice" });
    const draft = buildInvoiceReviewDraft(state);

    if (!draft) {
      throw new Error("la revisión debería poder cargarse");
    }
    return draft;
  }

  beforeEach(() => {
    mockExchangeRate = { data: { rateVes: 900 }, error: null };
  });

  it("con «Tasa de la factura» la compra va a esa tasa y en los Bs exactos de la factura", async () => {
    const api = installApi();
    mockReviewDraft = printedRateDraft("printed");
    renderPage();

    await scanAndLoad(1);

    expect(screen.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Tasa de la factura 875,65 (hoy 900,00)")).toBeInTheDocument();

    const body = await confirmPurchase(api);
    const items = body.items as Array<Record<string, unknown>>;
    const extraction = body.invoiceScanExtraction as { lines: Array<Record<string, unknown>> };

    expect(body.refRateVes).toBe(875.65);
    expect(items[0]).toMatchObject({ quantity: 2, unitCostRef: 0.8, unitCostVes: 700.52 });
    expect(body.subtotalVes).toBe(1401.04);
    expect(extraction.lines[0]).toMatchObject({ quantity: 2, unitPrice: 700.52 });
  });

  it("con «Tasa de hoy» todo sigue a la del día y no hay aviso", async () => {
    const api = installApi();
    mockReviewDraft = printedRateDraft("system");
    renderPage();

    await scanAndLoad(1);

    expect(screen.queryByText(/^Tasa de la factura/)).not.toBeInTheDocument();

    const body = await confirmPurchase(api);

    expect(body.refRateVes).toBe(900);
    expect((body.items as Array<Record<string, unknown>>)[0]).toMatchObject({ unitCostVes: 700.52 });
  });

  it("SCN-UI-C3 (N1): quitar todas las líneas de la factura suelta el escaneo y vuelve a la tasa del día", async () => {
    const api = installApi();
    mockReviewDraft = printedRateDraft("printed");
    renderPage();

    await scanAndLoad(1);
    click("agregar cable");
    click("desbloquear Harina PAN");
    click("quitar Harina PAN");

    expect(
      screen.getByText("Quitaste todas las líneas de la factura: la compra ya no se vincula al escaneo"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Tasa de la factura/)).not.toBeInTheDocument();

    const body = await confirmPurchase(api);

    expect(body.refRateVes).toBe(900);
    expect(body).not.toHaveProperty("invoiceScanId");
    expect(body).not.toHaveProperty("invoiceScanLines");
    expect(body).not.toHaveProperty("invoiceScanExtraction");
    // El escaneo no se descarta solo: sigue por revisar.
    expect(api.posts.some((post) => post.url === DISCARD_URL)).toBe(false);
  });

  it("SCN-UI-C3 (N2): Bs → REF → Bs devuelve los Bs exactos de la factura en las líneas sin editar", async () => {
    const api = installApi();
    // 9 631,20 / 875,65 = REF 11,00, que de vuelta serían 9 632,15.
    mockReviewDraft = printedRateDraft("printed", { lineTotal: 19262.4, quantity: 2, unitPrice: 9631.2 });
    renderPage();

    await scanAndLoad(1);
    click("REF");
    click("Bs");

    expect(lineTexts()[0]).toContain("Bs 9631.2 · en ves");

    const body = await confirmPurchase(api);

    expect((body.items as Array<Record<string, unknown>>)[0]).toMatchObject({ unitCostVes: 9631.2 });
    expect(body.subtotalVes).toBe(19262.4);
  });

  it("SCN-UI-C3 (N2): una línea de la factura editada no recupera los Bs de la factura al alternar", async () => {
    installApi();
    mockReviewDraft = printedRateDraft("printed", { lineTotal: 19262.4, quantity: 2, unitPrice: 9631.2 });
    renderPage();

    await scanAndLoad(1);
    click("desbloquear Harina PAN");
    click("editar Harina PAN");
    click("REF");
    click("Bs");

    expect(lineTexts()[0]).not.toContain("Bs 9631.2");
  });

  it("SCN-UI-C3 (N3): sin tasa del día se puede restaurar el borrador que trae la tasa de la factura", async () => {
    const api = installApi();
    mockReviewDraft = printedRateDraft("printed");
    const first = renderPage();

    await scanAndLoad(1);
    await waitFor(() =>
      expect(storedDraft()?.invoiceScan).toMatchObject({ invoiceRateVes: 875.65, scanId: REVIEW_SCAN_ID }),
    );
    first.view.unmount();

    mockExchangeRate = { data: undefined, error: new Error("No hay tasa del día.") };
    renderPage();

    expect(screen.getByRole("button", { name: "Restaurar" })).toBeEnabled();
    click("Restaurar");
    await waitFor(() => expect(lineTexts()).toHaveLength(1));

    const body = await confirmPurchase(api);

    expect(body.refRateVes).toBe(875.65);
    expect(body.invoiceScanId).toBe(REVIEW_SCAN_ID);
  });
});

describe("PurchaseCreatePage · recargar a mitad de la revisión (SCN-UI-C1)", () => {
  const scanned = makeReviewResponse({ lines: [{}] });

  function detail(status: string) {
    return {
      payload: {
        data: {
          createdAt: "2026-10-16T10:00:00.000Z",
          extraction: scanned.extraction,
          imageUrls: [],
          matched: scanned.matched,
          pages: 1,
          purchaseId: null,
          scanId: REVIEW_SCAN_ID,
          status,
        },
      },
      status: 200,
    };
  }

  /** Abre la revisión, espera a que el borrador la recuerde y «recarga». */
  async function reviewAndReload() {
    const first = renderPage();

    scanInvoice();
    await waitFor(() => expect(storedDraft()?.pendingInvoiceReview).toEqual({ scanId: REVIEW_SCAN_ID }));
    first.view.unmount();
    return renderPage();
  }

  it("ofrece retomar la revisión y la vuelve a abrir con el escaneo guardado", async () => {
    installApi({ scanDetail: detail("extracted") });
    await reviewAndReload();

    fireEvent.click(await screen.findByRole("button", { name: "Retomar la revisión de la factura" }));

    await waitFor(() => expect(reviewPanel()).toHaveTextContent(`escaneo ${REVIEW_SCAN_ID}`));
    // Solo había la revisión: no se ofrece además restaurar una compra vacía.
    expect(screen.queryByRole("button", { name: "Restaurar" })).not.toBeInTheDocument();
  });

  it("con una compra debajo, retomar la restaura y vuelve a abrir la revisión", async () => {
    installApi({ scanDetail: detail("extracted") });
    const first = renderPage();

    click("elegir proveedor");
    click("agregar cable");
    scanInvoice();
    await waitFor(() => expect(storedDraft()?.pendingInvoiceReview).toEqual({ scanId: REVIEW_SCAN_ID }));
    first.view.unmount();
    renderPage();

    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Retomar la revisión de la factura" }));

    await waitFor(() => expect(reviewPanel()).toHaveTextContent(`escaneo ${REVIEW_SCAN_ID}`));
    // «Cargar» o descartar la revisión devuelve al formulario con la compra restaurada.
    click("Descartar escaneo");
    await waitFor(() => expect(lineTexts()).toHaveLength(1));
    expect(lineTexts()[0]).toContain("Cable HDMI");
  });

  it("si el escaneo ya no está por revisar no lo ofrece y olvida el borrador", async () => {
    installApi({ scanDetail: detail("confirmed") });
    await reviewAndReload();

    await waitFor(() => expect(storedDraft()).toBeNull());
    expect(screen.queryByRole("button", { name: "Retomar la revisión de la factura" })).not.toBeInTheDocument();
    expect(reviewPanel()).not.toBeInTheDocument();
  });

  it("«Descartar» descarta el escaneo en el servidor y el borrador", async () => {
    const api = installApi({ scanDetail: detail("extracted") });
    await reviewAndReload();

    const banner = await screen.findByRole("region", { name: "Revisión de factura sin terminar" });
    fireEvent.click(within(banner).getByRole("button", { name: "Descartar" }));

    await waitFor(() => expect(api.posts.map((post) => post.url)).toEqual([DISCARD_URL]));
    await waitFor(() => expect(storedDraft()).toBeNull());
    expect(screen.queryByRole("button", { name: "Retomar la revisión de la factura" })).not.toBeInTheDocument();
    expect(reviewPanel()).not.toBeInTheDocument();
  });
});
