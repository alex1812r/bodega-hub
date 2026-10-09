import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * COM-09 · borrador local de la compra en curso, duplicar compra y ProcessGuard.
 * CNF-15/16 · guardia de salida que nombra la compra y guardado automático con espera.
 */

const mockPush = jest.fn();
const mockLinkNavigate = jest.fn();
const mockRate: { data: { rateVes: number } | undefined; error: Error | null } = {
  data: { rateVes: 510 },
  error: null,
};

function mockBuildTaxRate(code: string, label: string, pct: number, sortOrder: number) {
  return {
    code,
    id: `tax-${code}`,
    isActive: true,
    isDefault: code === "general",
    isGlobal: true,
    label,
    pct,
    sortOrder,
  };
}

const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [
    mockBuildTaxRate("exento", "Exento", 0, 10),
    mockBuildTaxRate("reducida", "Reducida", 8, 20),
    mockBuildTaxRate("general", "General", 16, 30),
  ],
  refetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
// Contrato de `next/link` en el App Router: `onNavigate` corre en la navegación de
// cliente y puede cancelarla (es por donde `GuardedLink` consulta al guardia).
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    onNavigate,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();

        let prevented = false;

        onNavigate?.({
          preventDefault: () => {
            prevented = true;
          },
        });

        if (!prevented) {
          mockLinkNavigate(href);
        }
      }}
    />
  ),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockRate,
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../contacts/hooks/useSupplierProducts", () => ({
  useSupplierProducts: () => ({ data: undefined, error: null, isFetching: false }),
}));
// Proveedor reducido a lo que la página le pasa y dos botones para elegir.
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
      <button onClick={() => onSupplierChange("cont-otro", "Otro Proveedor")} type="button">
        elegir otro proveedor
      </button>
      <button onClick={() => onSupplierChange("")} type="button">
        limpiar proveedor
      </button>
    </div>
  ),
}));
// El buscador se reduce a botones y cada línea a un renglón con lo que la página resolvió.
jest.mock("./components/PurchaseProductPickerCard", () => {
  type PickerProps = Parameters<
    typeof import("./components/PurchaseProductPickerCard").PurchaseProductPickerCard
  >[0];

  return {
    PurchaseProductPickerCard: ({
      exemptPurchase,
      getItemMeta,
      lines,
      onAddProduct,
      onExemptPurchaseChange,
      onUpdateItem,
    }: PickerProps) => (
      <div>
        <p>compra exenta: {exemptPurchase ? "sí" : "no"}</p>
        <ul aria-label="líneas">
          {lines.map(({ edited, item, locked, tax }) => (
            <li key={item.id}>
              {[
                getItemMeta(item.productId).name,
                item.entryMode === "pack"
                  ? `${item.packCount} ${item.packLabel} de ${item.unitsPerPack} a REF ${item.packCostRef}`
                  : `${item.quantity} u a REF ${item.unitCostRef} / Bs ${item.unitCostVes}`,
                `en ${item.costCurrency}`,
                `IVA ${tax.code}`,
                locked ? "bloqueada" : "libre",
                edited ? "editada" : "sin editar",
              ].join(" · ")}
              <button onClick={() => onUpdateItem(item.id, { quantity: 4 })} type="button">
                poner 4 en {item.productId}
              </button>
            </li>
          ))}
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
        <button
          onClick={() =>
            onAddProduct({
              costWithTaxRef: 1.08,
              currentStock: 0,
              link: "none",
              name: "Harina PAN",
              packUnits: [],
              productId: "prod-harina",
              sku: "HAR-PAN",
              taxRate: 8,
              unitCostRef: 1,
            })
          }
          type="button"
        >
          agregar harina
        </button>
        <button onClick={() => onExemptPurchaseChange(true)} type="button">
          marcar exenta
        </button>
      </div>
    ),
  };
});

import {
  createQueryWrapper,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";

import { PurchaseCreatePage } from "./page";

/** CNF-01: «Confirmar Compra» abre la confirmación; la compra se envía con el botón del modal. */
function acceptConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: /^Registrar (compra|pedido)$/ }));
}
import {
  purchaseDraftStorageKey,
  purchaseNewDraftStorageKey,
} from "./utils/purchaseDraftStorage";

const draftKey = purchaseDraftStorageKey({ storeId: "store-1", userId: "user-1" });
const newDraftKey = purchaseNewDraftStorageKey({ storeId: "store-1", userId: "user-1" });

function storeProduct(id: string, name: string, taxRate: number, input: object = {}) {
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
    ...input,
  };
}

const cable = storeProduct("prod-cable", "Cable HDMI", 16);
const harina = storeProduct("prod-harina", "Harina PAN", 8);
const refresco = storeProduct("prod-refresco", "Refresco Cola", 16);
const vieja = storeProduct("prod-vieja", "Harina Vieja", 8, { isActive: false });

function supplierLink(product: ReturnType<typeof storeProduct>, lastCostRef: number) {
  return {
    id: `supp-${product.id}`,
    isActive: true,
    isPreferred: false,
    lastCostRef,
    packUnits: [],
    product: { ...product, taxRate: product.category.taxRate },
    productId: product.id,
    supplierId: "cont-supplier",
  };
}

function sourcePurchase(supplier: Record<string, unknown>) {
  return {
    id: "pur-1",
    items: [
      // Con vínculo: el costo sale del vínculo (REF 2,32 con IVA 16 % = REF 2,00), no de aquí.
      {
        entryMode: "unit",
        product: { name: "Cable HDMI" },
        productId: "prod-cable",
        purchaseId: "pur-1",
        quantity: 3,
        subtotalRef: 15,
        subtotalVes: 7650,
        unitCostRef: 5,
        unitCostVes: 2550,
      },
      // Sin vínculo: conserva el costo de la línea de origen.
      {
        entryMode: "pack",
        packCostRef: 18,
        packCount: 2,
        packLabel: "Caja",
        product: { name: "Refresco Cola" },
        productId: "prod-refresco",
        purchaseId: "pur-1",
        quantity: 24,
        subtotalRef: 36,
        subtotalVes: 18360,
        unitCostRef: 1.5,
        unitCostVes: 765,
        unitsPerPack: 12,
      },
      {
        entryMode: "unit",
        product: { name: "Harina Vieja" },
        productId: "prod-vieja",
        purchaseId: "pur-1",
        quantity: 1,
        subtotalRef: 1,
        subtotalVes: 510,
        unitCostRef: 1,
        unitCostVes: 510,
      },
    ],
    notes: "Nota de la compra original",
    payments: [],
    status: "pedido",
    supplier,
    supplierId: String(supplier.id),
  };
}

const activeSupplier = { id: "cont-supplier", isActive: true, name: "Proveedor Demo", type: "proveedor" };
const otherSupplier = { id: "cont-otro", isActive: true, name: "Otro Proveedor", type: "proveedor" };
const SUPPLIER_NOT_FOUND = { error: { code: "NOT_FOUND", message: "Proveedor no encontrado." } };
const PURCHASE_NOT_FOUND = { error: { code: "NOT_FOUND", message: "Compra no encontrada." } };

type ApiOptions = {
  /** Unitario sin IVA de la última compra recibida, por producto; sin entrada = nunca comprado. */
  lastCosts?: Record<string, number>;
  links?: Array<ReturnType<typeof supplierLink>>;
  /** Compra de origen; `null` = el servidor responde 404. */
  purchase?: ReturnType<typeof sourcePurchase> | null;
  /** Proveedores por id que cambian respecto de los dos activos; `null` = ya no existe (404). */
  suppliers?: Record<string, typeof activeSupplier | null>;
};

/** `fetch` de prueba: fichas de producto, vínculos del proveedor, compra de origen y el POST. */
function installApi({ lastCosts = {}, links = [], purchase, suppliers = {} }: ApiOptions = {}) {
  const products = [cable, harina, refresco, vieja];
  const knownSuppliers: Record<string, typeof activeSupplier | null> = {
    [activeSupplier.id]: activeSupplier,
    [otherSupplier.id]: otherSupplier,
    ...suppliers,
  };
  const posts: Array<Record<string, unknown>> = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({ data: { id: "purchase-nueva" } }, 201);
    }

    if (url.startsWith("/api/purchases/last-costs")) {
      const ids = new URL(url, "http://localhost").searchParams.get("productIds")?.split(",") ?? [];

      return jsonResponse({
        data: ids.flatMap((productId) =>
          productId in lastCosts
            ? [{ productId, source: "supplier", taxRate: 0, unitCostRef: lastCosts[productId] }]
            : [],
        ),
      });
    }

    // Un proveedor por id: restaurar un borrador revalida el suyo (CNF-16).
    if (url.startsWith("/api/purchases/suppliers?")) {
      const supplier =
        knownSuppliers[new URL(url, "http://localhost").searchParams.get("id") ?? ""];

      return supplier ? jsonResponse({ data: supplier }) : jsonResponse(SUPPLIER_NOT_FOUND, 404);
    }

    if (url.startsWith("/api/purchases/pur-1") && purchase !== undefined) {
      return purchase ? jsonResponse({ data: purchase }) : jsonResponse(PURCHASE_NOT_FOUND, 404);
    }

    if (/^\/api\/suppliers\/[^/]+\/products/.test(url)) {
      return jsonResponse({ data: { items: links, limit: 100, skip: 0, total: links.length } });
    }

    const product = products.find((candidate) => url === `/api/products/${candidate.id}`);

    if (product) {
      return jsonResponse({ data: product });
    }

    return url.startsWith("/api/products/")
      ? jsonResponse({ error: { code: "NOT_FOUND", message: "Producto no encontrado." } }, 404)
      : jsonResponse({ data: null });
  }) as unknown as typeof fetch;

  return { posts };
}

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  // El contenedor cancela el clic para que jsdom no intente navegar con el enlace.
  return render(
    <QueryWrapper>
      <ToastProvider>
        <div onClick={(event) => event.preventDefault()} role="presentation">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- un `<a>` sin `next/link` es justo lo que intercepta el guardia */}
          <a href="/sales">Ventas</a>
          <PurchaseCreatePage />
        </div>
      </ToastProvider>
    </QueryWrapper>,
  );
}

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const lineTexts = () =>
  within(screen.getByRole("list", { name: "líneas" }))
    .queryAllByRole("listitem")
    .map((line) => line.firstChild?.textContent);
const storedDraft = () => {
  const raw = window.localStorage.getItem(draftKey);

  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};
const banner = () => screen.queryByRole("status", { name: "Compra sin terminar" });
const storedNewDraft = () => {
  const raw = window.localStorage.getItem(newDraftKey);

  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};
/** Deja pasar la espera del guardado automático (CNF-16: 500 ms desde el último cambio). */
const settleDraft = () =>
  act(() => {
    jest.advanceTimersByTime(500);
  });
const notesField = () => screen.getByPlaceholderText("Nro. de factura, condiciones...");
const guardDialog = () => screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });
const leaveViaMenu = () => fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

/** Deja guardada una compra: proveedor, dos líneas (la primera bloqueada), exenta y en REF. */
function leaveUnfinishedPurchase() {
  const view = renderPage();

  click("elegir proveedor");
  click("agregar cable");
  click("agregar harina");
  click("marcar exenta");
  click("REF");
  fireEvent.change(screen.getByPlaceholderText("Nro. de factura, condiciones..."), {
    target: { value: "Factura 123" },
  });
  view.unmount();
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/purchases/create");
  mockPush.mockReset();
  mockLinkNavigate.mockReset();
  mockRate.data = { rateVes: 510 };
  mockRate.error = null;
  installApi();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("PurchaseCreatePage · borrador local (COM-09)", () => {
  it("no guarda nada con el formulario vacío y guarda al haber proveedor y línea, sin pago ni clave de idempotencia", () => {
    renderPage();

    fireEvent.change(notesField(), { target: { value: "Solo una nota" } });
    settleDraft();
    expect(storedDraft()).toBeNull();

    fireEvent.change(notesField(), { target: { value: "" } });
    click("elegir proveedor");
    click("agregar cable");
    settleDraft();

    const stored = storedDraft();

    expect(stored).toMatchObject({
      costCurrency: "ves",
      storeId: "store-1",
      supplierId: "cont-supplier",
      supplierName: "Proveedor Demo",
      userId: "user-1",
      version: 1,
    });
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        "costCurrency",
        "discountRef",
        "lineMeta",
        "lines",
        "notes",
        "rateVes",
        "savedAt",
        "status",
        "storeId",
        "supplierId",
        "supplierName",
        "userId",
        "version",
      ],
    );
    expect(Object.keys((stored?.lines as object) ?? {}).sort()).toEqual([
      "items",
      "locks",
      "review",
      "taxState",
    ]);
    // Lo que guarda esta visita no se le ofrece a ella misma.
    expect(banner()).not.toBeInTheDocument();
  });

  it("al volver ofrece la compra sin terminar y Restaurar repone proveedor, líneas, bloqueos, exenta, moneda y notas", async () => {
    leaveUnfinishedPurchase();
    renderPage();

    expect(banner()).toHaveTextContent(
      "Tienes una compra sin terminar (Proveedor Demo, 2 líneas, hace un momento)",
    );
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);

    click("Restaurar");

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(lineTexts()).toEqual([
      "Harina PAN · 1 u a REF 1 / Bs 510 · en ref · IVA exento · libre · sin editar",
      "Cable HDMI · 1 u a REF 2 / Bs 1020 · en ref · IVA exento · bloqueada · sin editar",
    ]);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    expect(screen.getByText("compra exenta: sí")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "REF" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByPlaceholderText("Nro. de factura, condiciones...")).toHaveValue("Factura 123");
    expect(banner()).not.toBeInTheDocument();
    // Misma tasa y todos los productos siguen activos: nada que avisar.
    expect(screen.queryByText(/La tasa cambió/)).not.toBeInTheDocument();
    expect(storedDraft()).not.toBeNull();
  });

  it("restaurar con otra tasa deja fijo el monto en la moneda de captura, recalcula el otro y avisa", async () => {
    const view = renderPage();

    click("elegir proveedor");
    click("agregar cable");
    view.unmount();

    mockRate.data = { rateVes: 600 };
    renderPage();
    click("Restaurar");

    await waitFor(() => expect(lineTexts()).toHaveLength(1));
    // Capturada en Bs: los Bs 1.020 no se mueven y el REF pasa de 2,00 a 1,70.
    expect(lineTexts()).toEqual([
      "Cable HDMI · 1 u a REF 1.7 / Bs 1020 · en ves · IVA general · libre · sin editar",
    ]);
    expect(screen.getByText(/La tasa cambió desde que guardaste la compra/)).toBeInTheDocument();
  });

  it("al restaurar quita las líneas de productos inactivos o inexistentes y avisa cuáles", async () => {
    leaveUnfinishedPurchase();
    installApi();
    // La harina se desactivó y el cable ya no existe.
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/products/prod-harina") {
        return jsonResponse({ data: { ...harina, isActive: false } });
      }

      if (url.startsWith("/api/products/")) {
        return jsonResponse({ error: { code: "NOT_FOUND", message: "Producto no encontrado." } }, 404);
      }

      if (url.startsWith("/api/purchases/suppliers?")) {
        return jsonResponse({ data: activeSupplier });
      }

      return jsonResponse({ data: { items: [], limit: 100, skip: 0, total: 0 } });
    });
    renderPage();
    click("Restaurar");

    expect(
      await screen.findByText(
        "Se quitaron 2 productos que ya no existen o están inactivos: Harina PAN, Cable HDMI.",
      ),
    ).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
  });

  it("Descartar borra el borrador y quita el aviso", () => {
    leaveUnfinishedPurchase();
    renderPage();

    click("Descartar");

    expect(banner()).not.toBeInTheDocument();
    expect(storedDraft()).toBeNull();
    expect(lineTexts()).toEqual([]);
  });

  it("con un borrador pendiente sin decidir, lo que se teclee no lo pisa", () => {
    leaveUnfinishedPurchase();

    const before = window.localStorage.getItem(draftKey);

    renderPage();
    click("elegir otro proveedor");
    click("agregar cable");
    settleDraft();

    expect(window.localStorage.getItem(draftKey)).toBe(before);
    // COM-F10: lo nuevo ya no se pierde; el aviso pide decidir (ver el bloque F-B1).
    expect(banner()).toHaveTextContent("Empezaste una compra nueva");
  });

  it("confirmar la compra borra el borrador", async () => {
    const api = installApi();

    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    settleDraft();
    expect(storedDraft()).not.toBeNull();

    click(/Confirmar Compra/);
    acceptConfirmation();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
    expect(api.posts).toHaveLength(1);
    expect(storedDraft()).toBeNull();
  });

  it("si localStorage lanza, la pantalla sigue funcionando sin borrador", async () => {
    const api = installApi();
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const removeItem = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    try {
      renderPage();
      click("elegir proveedor");
      click("agregar cable");
      expect(lineTexts()).toHaveLength(1);
      expect(banner()).not.toBeInTheDocument();

      click(/Confirmar Compra/);
      acceptConfirmation();
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
      expect(api.posts).toHaveLength(1);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
    }
  });
});

describe("PurchaseCreatePage · ProcessGuard (COM-09, regla 14)", () => {
  it("con el formulario vacío salir no pregunta; con una línea pregunta nombrando la compra", () => {
    renderPage();

    leaveViaMenu();
    expect(guardDialog()).not.toBeInTheDocument();

    click("elegir proveedor");
    click("agregar cable");
    leaveViaMenu();

    expect(guardDialog()).toBeInTheDocument();
    expect(
      within(guardDialog() as HTMLElement).getByText("Compra a Proveedor Demo · 1 línea · ref 2.32"),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    click("Seguir aquí");
    expect(guardDialog()).not.toBeInTheDocument();
    expect(lineTexts()).toHaveLength(1);
  });

  it("tras confirmar navega al detalle sin preguntar y el guardia queda apagado", async () => {
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click(/Confirmar Compra/);
    acceptConfirmation();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(guardDialog()).not.toBeInTheDocument();

    // La pantalla sigue montada (el mock no navega) y aún tiene sus líneas: ya no pregunta.
    expect(lineTexts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));
    expect(guardDialog()).not.toBeInTheDocument();
  });
});

describe("PurchaseCreatePage · duplicar compra (COM-09)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/purchases/create?duplicate=pur-1");
  });

  it("precarga proveedor y líneas con el costo del vínculo, omite el producto inactivo y limpia la URL", async () => {
    const api = installApi({
      links: [supplierLink(cable, 2.32)],
      purchase: sourcePurchase(activeSupplier),
    });

    renderPage();
    expect(screen.getByText("Cargando la compra a duplicar...")).toBeInTheDocument();

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(lineTexts()).toEqual([
      "Cable HDMI · 3 u a REF 2 / Bs 1020 · en ves · IVA general · libre · sin editar",
      "Refresco Cola · 2 Caja de 12 a REF 18 · en ves · IVA general · libre · sin editar",
    ]);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    expect(
      screen.getByText("No se duplicó 1 producto que ya no existe o está inactivo: Harina Vieja."),
    ).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/purchases/create");

    // No copia notas, descuento, estado ni pagos de la compra original.
    expect(screen.getByPlaceholderText("Nro. de factura, condiciones...")).toHaveValue("");
    click(/Confirmar Compra/);
    acceptConfirmation();
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toMatchObject({ discountRef: 0, status: "recibido", supplierId: "cont-supplier" });
    expect(api.posts[0]).not.toHaveProperty("notes");
    expect(api.posts[0]).not.toHaveProperty("initialPayment");
  });

  // COM-F11 · la última compra del cable fue EXENTA a REF 2,32: el vínculo guarda 2,32 y
  // dividirlo entre el 16 % de la categoría daba REF 2,00.
  it("usa el costo neto de la última compra recibida de cada producto, por unidad y por empaque", async () => {
    installApi({
      lastCosts: { "prod-cable": 2.32, "prod-refresco": 1.25 },
      links: [supplierLink(cable, 2.32)],
      purchase: sourcePurchase(activeSupplier),
    });

    renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(lineTexts()).toEqual([
      "Cable HDMI · 3 u a REF 2.32 / Bs 1183.2 · en ves · IVA general · libre · sin editar",
      "Refresco Cola · 2 Caja de 12 a REF 15 · en ves · IVA general · libre · sin editar",
    ]);

    const lastCostRequests = (global.fetch as jest.Mock).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/purchases/last-costs"));

    // Una petición para todos los productos activos de la compra; el inactivo no se pide.
    expect(lastCostRequests).toHaveLength(1);
    expect(new URL(lastCostRequests[0], "http://localhost").searchParams.get("productIds")).toBe(
      "prod-cable,prod-refresco",
    );
  });

  it("proveedor inactivo: avisa, no lo preselecciona y las líneas entran al elegir otro", async () => {
    installApi({
      purchase: sourcePurchase({ ...activeSupplier, isActive: false, name: "Distribuidora Vieja" }),
    });

    renderPage();

    expect(
      await screen.findByText(
        "El proveedor Distribuidora Vieja está inactivo: elige otro proveedor para duplicar la compra.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
    expect(window.location.search).toBe("");

    click("elegir otro proveedor");

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(screen.getByText("proveedor: cont-otro")).toBeInTheDocument();
    // Sin vínculo con el proveedor nuevo: el costo es el de la línea de origen.
    expect(lineTexts()[0]).toBe(
      "Cable HDMI · 3 u a REF 5 / Bs 2550 · en ves · IVA general · libre · sin editar",
    );
    expect(screen.queryByText(/está inactivo: elige otro proveedor/)).not.toBeInTheDocument();
  });

  it("un contacto que ya no es proveedor tampoco se preselecciona", async () => {
    installApi({ purchase: sourcePurchase({ ...activeSupplier, name: "Ahora Cliente", type: "cliente" }) });

    renderPage();

    expect(await screen.findByText(/El proveedor Ahora Cliente está inactivo/)).toBeInTheDocument();
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
  });

  it("si la compra de origen no existe muestra el error del servidor y deja volver a la lista", async () => {
    installApi({ purchase: null });

    renderPage();

    expect(await screen.findByText("No pudimos duplicar la compra")).toBeInTheDocument();
    expect(screen.getByText("Compra no encontrada.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirmar Compra/ })).not.toBeInTheDocument();

    click("Volver a Compras");
    expect(mockPush).toHaveBeenCalledWith("/purchases");
  });

  // COM-F10 · F-C1: `?duplicate=..%2Fproducts` hacía GET a otra ruta de /api.
  it.each([
    ["../products", "..%2Fproducts"],
    ["../contacts?limit=100", "..%2Fcontacts%3Flimit%3D100"],
    ["pur-1/cancel", "pur-1%2Fcancel"],
    ["un id de más de 64 caracteres", "a".repeat(65)],
    ["un id con espacios", "pur%201"],
  ])("un id que no tiene forma de id (%s) no se pide: «Compra no encontrada»", async (_case, value) => {
    window.history.replaceState({}, "", `/purchases/create?duplicate=${value}`);
    installApi({ purchase: sourcePurchase(activeSupplier) });
    renderPage();

    expect(await screen.findByText("No pudimos duplicar la compra")).toBeInTheDocument();
    expect(screen.getByText("Compra no encontrada.")).toBeInTheDocument();
    // Solo lo que la pantalla pide siempre: nada que salga del parámetro.
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).sort()).toEqual([
      "/api/inventory/pack-conversions",
      "/api/settings/payment-methods",
    ]);

    click("Volver a Compras");
    expect(mockPush).toHaveBeenCalledWith("/purchases");
  });

  it("con un borrador pendiente manda lo duplicado, el borrador no se toca y Restaurar lo sustituye", async () => {
    window.history.replaceState({}, "", "/purchases/create");
    leaveUnfinishedPurchase();

    const before = window.localStorage.getItem(draftKey);

    window.history.replaceState({}, "", "/purchases/create?duplicate=pur-1");
    installApi({ links: [supplierLink(cable, 2.32)], purchase: sourcePurchase(activeSupplier) });
    renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    settleDraft();
    expect(lineTexts()[0]).toContain("Cable HDMI · 3 u");
    expect(window.localStorage.getItem(draftKey)).toBe(before);
    // COM-F10: la compra duplicada es una compra nueva más; se guarda aparte.
    expect(banner()).toHaveTextContent("Empezaste una compra nueva");
    expect(storedNewDraft()).toMatchObject({ supplierId: "cont-supplier" });

    await act(async () => {
      click("Restaurar el guardado");
    });

    await waitFor(() => expect(banner()).not.toBeInTheDocument());
    expect(lineTexts().map((line) => line?.split(" · ")[0])).toEqual(["Harina PAN", "Cable HDMI"]);
    expect(screen.getByText("compra exenta: sí")).toBeInTheDocument();
    expect(screen.queryByText(/No se duplicó/)).not.toBeInTheDocument();
  });
});

describe("PurchaseCreatePage · cambiar de proveedor con líneas pregunta antes (COM-F3)", () => {
  const confirmDialog = () => screen.queryByRole("dialog", { name: "Cambiar de proveedor" });

  it("sin líneas cambia y limpia directo, sin preguntar", () => {
    renderPage();
    click("elegir proveedor");
    click("elegir otro proveedor");

    expect(confirmDialog()).not.toBeInTheDocument();
    expect(screen.getByText("proveedor: cont-otro")).toBeInTheDocument();

    click("limpiar proveedor");

    expect(confirmDialog()).not.toBeInTheDocument();
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
  });

  it("limpiar el proveedor con líneas pregunta; Cancelar conserva proveedor, líneas y borrador", async () => {
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click("agregar harina");
    settleDraft();

    const draftBefore = window.localStorage.getItem(draftKey);

    expect(draftBefore).not.toBeNull();
    click("limpiar proveedor");

    expect(confirmDialog()).toHaveTextContent(
      "Cambiar de proveedor quita las 2 líneas de esta compra.",
    );
    // Con el diálogo abierto el resto de la página queda oculto a los roles: se mira por texto.
    expect(screen.getAllByText(/ u a REF /)).toHaveLength(2);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();

    click("Cancelar");

    await waitFor(() => expect(confirmDialog()).not.toBeInTheDocument());
    expect(lineTexts()).toHaveLength(2);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    settleDraft();
    expect(window.localStorage.getItem(draftKey)).toBe(draftBefore);
  });

  it("«Quitar líneas y cambiar» al limpiar deja la compra sin proveedor ni líneas", async () => {
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click("limpiar proveedor");

    expect(confirmDialog()).toHaveTextContent("Cambiar de proveedor quita la línea de esta compra.");

    click("Quitar líneas y cambiar");

    await waitFor(() => expect(confirmDialog()).not.toBeInTheDocument());
    expect(lineTexts()).toEqual([]);
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(storedDraft()).toBeNull();
  });

  it("elegir otro proveedor con líneas también pregunta, y al aceptar entra el nuevo sin líneas", async () => {
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click("agregar harina");
    click("elegir otro proveedor");

    expect(confirmDialog()).toBeInTheDocument();
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();

    click("Quitar líneas y cambiar");

    await waitFor(() => expect(screen.getByText("proveedor: cont-otro")).toBeInTheDocument());
    expect(confirmDialog()).not.toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
  });

  it("duplicar con el proveedor inactivo: elegir otro no pregunta (las líneas esperan a ese proveedor)", async () => {
    window.history.replaceState({}, "", "/purchases/create?duplicate=pur-1");
    installApi({
      purchase: sourcePurchase({ ...activeSupplier, isActive: false, name: "Distribuidora Vieja" }),
    });
    renderPage();
    await screen.findByText(/Distribuidora Vieja está inactivo/);

    click("elegir otro proveedor");

    expect(confirmDialog()).not.toBeInTheDocument();
    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(screen.getByText("proveedor: cont-otro")).toBeInTheDocument();
  });
});

// COM-F10 · F-B1: con el aviso sin resolver, la compra nueva no se autoguardaba y al recargar se perdía.
describe("PurchaseCreatePage · compra nueva con un borrador guardado sin decidir (COM-F10 · F-B1)", () => {
  const SAVED = "Proveedor Demo, 2 líneas";

  /** Con una compra guardada sin decidir, empieza otra: otro proveedor y un cable. */
  function startNewPurchaseOverSavedDraft() {
    leaveUnfinishedPurchase();

    const view = renderPage();

    click("elegir otro proveedor");
    click("agregar cable");
    settleDraft();

    return view;
  }

  it("al empezar una compra nueva el aviso pide decidir, y se guarda aparte sin tocar la guardada", () => {
    leaveUnfinishedPurchase();

    const before = window.localStorage.getItem(draftKey);

    renderPage();
    fireEvent.change(notesField(), { target: { value: "Solo una nota" } });
    settleDraft();
    // Sin proveedor ni líneas todavía no hay nada que perder.
    expect(banner()).toHaveTextContent("Tienes una compra sin terminar");
    expect(storedNewDraft()).toBeNull();

    click("elegir otro proveedor");
    click("agregar cable");
    // Hasta que no pasa la espera, el aviso sigue ofreciendo solo la guardada.
    expect(banner()).toHaveTextContent("Restaurar sustituye lo que hay ahora en el formulario.");
    settleDraft();

    expect(banner()).toHaveTextContent(
      `Empezaste una compra nueva: al seguir se reemplaza el borrador guardado (${SAVED})`,
    );
    expect(screen.getByRole("button", { name: "Restaurar el guardado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir con esta" })).toBeInTheDocument();
    expect(window.localStorage.getItem(draftKey)).toBe(before);
    expect(storedNewDraft()).toMatchObject({ supplierId: "cont-otro", supplierName: "Otro Proveedor" });
    // No bloquea: se puede seguir armando la compra.
    click("agregar harina");
    expect(lineTexts()).toHaveLength(2);
  });

  it("un proveedor elegido, sin líneas, también cuenta como compra nueva, con sus notas", () => {
    leaveUnfinishedPurchase();
    renderPage();
    click("elegir otro proveedor");
    settleDraft();
    expect(banner()).toHaveTextContent("Empezaste una compra nueva");

    fireEvent.change(notesField(), { target: { value: "Factura nueva" } });
    settleDraft();

    expect(storedNewDraft()).toMatchObject({ notes: "Factura nueva", supplierId: "cont-otro" });
  });

  it("al recargar sin decidir no se pierde ninguna: se ofrece elegir, y la nueva vuelve al formulario", async () => {
    startNewPurchaseOverSavedDraft().unmount();
    renderPage();

    expect(banner()).toHaveTextContent("Tienes dos compras sin terminar");
    expect(banner()).toHaveTextContent(`Guardada: ${SAVED}, hace un momento`);
    expect(banner()).toHaveTextContent("Nueva: Otro Proveedor, 1 línea, hace un momento");
    expect(lineTexts()).toEqual([]);

    click("Restaurar la nueva");

    await waitFor(() => expect(lineTexts()).toHaveLength(1));
    expect(lineTexts()[0]).toContain("Cable HDMI · 1 u");
    expect(screen.getByText("proveedor: cont-otro")).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
    // La nueva pasa a ser el borrador y la vieja se borra.
    expect(storedDraft()).toMatchObject({ supplierId: "cont-otro" });
    expect(storedNewDraft()).toBeNull();
  });

  it("al recargar, «Restaurar la guardada» repone la vieja y borra la nueva", async () => {
    startNewPurchaseOverSavedDraft().unmount();
    renderPage();

    click("Restaurar la guardada");

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
    expect(storedDraft()).toMatchObject({ supplierId: "cont-supplier" });
    expect(storedNewDraft()).toBeNull();
  });

  it("al recargar, «Descartar las dos» deja el formulario vacío y sin borradores", () => {
    startNewPurchaseOverSavedDraft().unmount();
    renderPage();

    click("Descartar las dos");

    expect(banner()).not.toBeInTheDocument();
    expect(storedDraft()).toBeNull();
    expect(storedNewDraft()).toBeNull();
  });

  it("«Seguir con esta» promueve la compra nueva, borra la guardada y deja el formulario como estaba", () => {
    startNewPurchaseOverSavedDraft();

    click("Seguir con esta");

    expect(banner()).not.toBeInTheDocument();
    expect(lineTexts()).toHaveLength(1);
    expect(screen.getByText("proveedor: cont-otro")).toBeInTheDocument();
    expect(storedDraft()).toMatchObject({ supplierId: "cont-otro" });
    expect(storedNewDraft()).toBeNull();

    // Desde aquí se guarda como cualquier compra en curso.
    click("agregar harina");
    settleDraft();
    expect((storedDraft()?.lines as { items: unknown[] }).items).toHaveLength(2);
  });

  it("«Restaurar el guardado» repone la vieja y borra la nueva", async () => {
    startNewPurchaseOverSavedDraft();

    click("Restaurar el guardado");

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
    expect(storedDraft()).toMatchObject({ supplierId: "cont-supplier" });
    expect(storedNewDraft()).toBeNull();
  });

  it("confirmar la compra nueva sin haber decidido borra las dos", async () => {
    const api = installApi();

    startNewPurchaseOverSavedDraft();
    click(/Confirmar Compra/);
    acceptConfirmation();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
    expect(api.posts).toHaveLength(1);
    expect(storedDraft()).toBeNull();
    expect(storedNewDraft()).toBeNull();
  });

  it("una compra duplicada cuyas líneas aún esperan proveedor no se guarda: el aviso dice que Restaurar la sustituye", async () => {
    leaveUnfinishedPurchase();
    window.history.replaceState({}, "", "/purchases/create?duplicate=pur-1");
    installApi({ purchase: sourcePurchase({ ...activeSupplier, isActive: false }) });
    renderPage();

    await screen.findByText(/está inactivo: elige otro proveedor/);
    expect(banner()).toHaveTextContent("Tienes una compra sin terminar");
    expect(banner()).toHaveTextContent("Restaurar sustituye lo que hay ahora en el formulario.");
    expect(storedNewDraft()).toBeNull();
  });

  it("al salir con la compra nueva guardada aparte, el guardia ya no dice que se va a perder", () => {
    startNewPurchaseOverSavedDraft();

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    const dialog = screen.getByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(within(dialog).queryByText(/esta no se guardará/)).not.toBeInTheDocument();
  });
});

describe("PurchaseCreatePage · guardia de salida (CNF-15)", () => {
  it("no pregunta con el formulario vacío, ni con notas y estado tocados sin proveedor ni líneas", () => {
    renderPage();
    fireEvent.change(notesField(), { target: { value: "Factura 9" } });
    fireEvent.change(screen.getByLabelText("Estado de la Compra"), { target: { value: "pedido" } });

    leaveViaMenu();

    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("con solo el proveedor elegido ya pregunta, y nombra proveedor, líneas y total", () => {
    renderPage();
    click("elegir proveedor");
    leaveViaMenu();

    const dialog = guardDialog() as HTMLElement;

    expect(within(dialog).getByText("Compra a Proveedor Demo · 0 líneas · ref 0.00")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Si sales ahora, se guardará un borrador");

    click("Seguir aquí");
    click("agregar cable");
    click("agregar harina");
    leaveViaMenu();

    // Cable REF 2,00 + 16 % y harina REF 1,00 + 8 %.
    expect(
      within(guardDialog() as HTMLElement).getByText("Compra a Proveedor Demo · 2 líneas · ref 3.40"),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("«Seguir aquí» no pierde líneas, bloqueos ni notas, y no navega", () => {
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click("agregar harina");
    fireEvent.change(notesField(), { target: { value: "Factura 123" } });

    const before = lineTexts();

    leaveViaMenu();
    click("Seguir aquí");

    expect(guardDialog()).not.toBeInTheDocument();
    expect(lineTexts()).toEqual(before);
    expect(before[1]).toContain("bloqueada");
    expect(notesField()).toHaveValue("Factura 123");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("«Salir» guarda el borrador en el acto, sin esperar los 500 ms, y navega al destino", async () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");

    try {
      renderPage();
      click("elegir proveedor");
      click("agregar cable");
      // Aún no pasó la espera: nada guardado.
      expect(storedDraft()).toBeNull();

      leaveViaMenu();
      await act(async () => {
        click("Salir");
      });

      expect(storedDraft()).toMatchObject({ supplierId: "cont-supplier" });
      expect((storedDraft()?.lines as { items: unknown[] }).items).toHaveLength(1);
      expect(mockPush).toHaveBeenCalledWith("/sales");

      // El guardado automático pendiente quedó cancelado: no hay una segunda escritura.
      const writes = setItem.mock.calls.filter(([key]) => key === draftKey).length;

      settleDraft();
      expect(setItem.mock.calls.filter(([key]) => key === draftKey)).toHaveLength(writes);
      expect(writes).toBe(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it("«Volver» de la cabecera pasa por el guardia: vacío sale directo, con una compra en curso pregunta", () => {
    renderPage();

    fireEvent.click(screen.getByRole("link", { name: "Volver" }));
    expect(guardDialog()).not.toBeInTheDocument();
    expect(mockLinkNavigate).toHaveBeenCalledWith("/purchases");

    mockLinkNavigate.mockClear();
    click("elegir proveedor");
    click("agregar cable");
    fireEvent.click(screen.getByRole("link", { name: "Volver" }));

    expect(guardDialog()).toBeInTheDocument();
    expect(mockLinkNavigate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("recargar o cerrar la pestaña (beforeunload) avisa y guarda el borrador sin esperar", () => {
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    expect(storedDraft()).toBeNull();

    const event = new Event("beforeunload", { cancelable: true });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(storedDraft()).toMatchObject({ supplierId: "cont-supplier" });
  });

  it("los modales de la pantalla (cambio de proveedor, confirmación) no disparan el guardia", async () => {
    const supplierDialog = () => screen.queryByRole("dialog", { name: "Cambiar de proveedor" });

    renderPage();
    click("elegir proveedor");
    click("agregar cable");

    click("elegir otro proveedor");
    expect(supplierDialog()).toBeInTheDocument();
    expect(guardDialog()).not.toBeInTheDocument();
    click("Cancelar");
    await waitFor(() => expect(supplierDialog()).not.toBeInTheDocument());

    click(/Confirmar Compra/);
    expect(screen.getByRole("button", { name: /^Registrar compra$/ })).toBeInTheDocument();
    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("confirmar antes de que pase la espera: ni guardia ni borrador, tampoco después", async () => {
    const api = installApi();

    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click(/Confirmar Compra/);
    acceptConfirmation();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
    expect(api.posts).toHaveLength(1);
    expect(guardDialog()).not.toBeInTheDocument();

    // El guardado automático que estuviera pendiente no resucita el borrador.
    settleDraft();
    settleDraft();
    expect(storedDraft()).toBeNull();
    expect(storedNewDraft()).toBeNull();

    leaveViaMenu();
    expect(guardDialog()).not.toBeInTheDocument();

    // Recargar tras confirmar: no hay nada que ofrecer.
    cleanup();
    renderPage();
    expect(banner()).not.toBeInTheDocument();
  });

  it("si el navegador no deja guardar, el guardia no promete un borrador: avisa que la compra se pierde", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    try {
      renderPage();
      click("elegir proveedor");
      click("agregar cable");
      settleDraft();
      // La pantalla sigue funcionando.
      expect(lineTexts()).toHaveLength(1);

      leaveViaMenu();

      const dialog = guardDialog() as HTMLElement;

      expect(dialog).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(dialog).toHaveTextContent(/no dejó guardar el borrador.*esta compra se pierde/);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("PurchaseCreatePage · borrador recuperable (CNF-16)", () => {
  it("guarda 500 ms después del último cambio y una sola vez por ráfaga", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const draftWrites = () => setItem.mock.calls.filter(([key]) => key === draftKey).length;

    try {
      renderPage();
      click("elegir proveedor");
      click("agregar cable");
      act(() => {
        jest.advanceTimersByTime(499);
      });
      expect(draftWrites()).toBe(0);

      // Otro cambio antes de cumplirse la espera: vuelve a empezar.
      fireEvent.change(notesField(), { target: { value: "Factura 123" } });
      act(() => {
        jest.advanceTimersByTime(499);
      });
      expect(draftWrites()).toBe(0);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(draftWrites()).toBe(1);
      expect(storedDraft()).toMatchObject({ notes: "Factura 123", supplierId: "cont-supplier" });
    } finally {
      setItem.mockRestore();
    }
  });

  it("guarda proveedor, líneas, bloqueos, estado, notas, descuento y la fecha, y nunca el pago", () => {
    jest.setSystemTime(new Date("2026-10-09T15:00:00.000Z"));
    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    click("agregar harina");
    fireEvent.change(screen.getByLabelText("Estado de la Compra"), { target: { value: "pedido" } });
    fireEvent.change(notesField(), { target: { value: "Factura 123" } });
    settleDraft();

    const stored = storedDraft() as {
      lines: { items: Array<{ id: string; productId: string }>; locks: { locked: object } };
    };

    expect(stored).toMatchObject({
      discountRef: 0,
      notes: "Factura 123",
      savedAt: "2026-10-09T15:00:00.500Z",
      status: "pedido",
      supplierId: "cont-supplier",
      supplierName: "Proveedor Demo",
      version: 1,
    });
    expect(stored.lines.items.map((item) => item.productId)).toEqual(["prod-harina", "prod-cable"]);
    // «Bloquear al agregar»: al entrar la harina, el cable quedó bloqueado.
    expect(stored.lines.locks.locked).toEqual({ [stored.lines.items[1].id]: true });
    expect(JSON.stringify(stored)).not.toMatch(/payment|reference|clientRequestId/i);
  });

  it("el aviso dice proveedor, líneas y hace cuánto se guardó, y no restaura solo", () => {
    leaveUnfinishedPurchase();
    act(() => {
      jest.advanceTimersByTime(20 * 60_000);
    });
    renderPage();

    expect(banner()).toHaveTextContent(
      "Tienes una compra sin terminar (Proveedor Demo, 2 líneas, hace 20 min)",
    );
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
  });

  it("F5 a media compra: tras recargar el aviso lo ofrece todo, con sus líneas bloqueadas", async () => {
    const view = renderPage();

    click("elegir proveedor");
    click("agregar cable");
    click("agregar harina");
    // Recarga antes de que pase la espera: lo guarda el aviso nativo.
    act(() => {
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    });
    view.unmount();

    renderPage();
    expect(banner()).toHaveTextContent("Proveedor Demo, 2 líneas");
    click("Restaurar");

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(lineTexts()[0]).toContain("Harina PAN");
    expect(lineTexts()[0]).toContain("libre");
    expect(lineTexts()[1]).toContain("Cable HDMI");
    expect(lineTexts()[1]).toContain("bloqueada");
  });

  it.each([
    ["corrupto", "{no es json"],
    ["de una versión vieja", JSON.stringify({ supplierId: "cont-supplier", version: 0 })],
    ["de otro usuario", null],
  ])("un borrador %s se descarta sin romper la pantalla y se puede guardar encima", (_, raw) => {
    if (raw === null) {
      leaveUnfinishedPurchase();
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ ...storedDraft(), userId: "user-2" }),
      );
    } else {
      window.localStorage.setItem(draftKey, raw);
    }

    renderPage();

    expect(banner()).not.toBeInTheDocument();
    click("elegir proveedor");
    click("agregar cable");
    settleDraft();

    expect(lineTexts()).toHaveLength(1);
    expect(storedDraft()).toMatchObject({ supplierId: "cont-supplier", userId: "user-1", version: 1 });
  });

  it.each([
    ["inactivo", { ...activeSupplier, isActive: false }],
    ["que ya no existe", null],
  ])(
    "restaurar con el proveedor %s: avisa, no lo elige, y las líneas entran al elegir otro sin perder el borrador",
    async (_, supplier) => {
      leaveUnfinishedPurchase();

      const before = window.localStorage.getItem(draftKey);

      installApi({ suppliers: { "cont-supplier": supplier } });
      renderPage();
      click("Restaurar");

      expect(
        await screen.findByText(
          /El proveedor Proveedor Demo de la compra guardada ya no está disponible: sus 2 líneas no se restauraron/,
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
      expect(lineTexts()).toEqual([]);
      expect(banner()).not.toBeInTheDocument();
      // Notas y moneda sí vuelven.
      expect(notesField()).toHaveValue("Factura 123");
      // Mientras las líneas esperan proveedor, lo guardado no se toca: recargar lo vuelve a ofrecer.
      settleDraft();
      expect(window.localStorage.getItem(draftKey)).toBe(before);

      await act(async () => {
        click("elegir otro proveedor");
      });

      await waitFor(() => expect(lineTexts()).toHaveLength(2));
      expect(lineTexts().map((line) => line?.split(" · ")[0])).toEqual(["Harina PAN", "Cable HDMI"]);
      expect(screen.queryByText(/ya no está disponible/)).not.toBeInTheDocument();
      settleDraft();
      expect(storedDraft()).toMatchObject({ supplierId: "cont-otro" });
    },
  );

  it("Descartar: recargar ya no lo ofrece", () => {
    leaveUnfinishedPurchase();

    const view = renderPage();

    click("Descartar");
    settleDraft();
    view.unmount();
    renderPage();

    expect(banner()).not.toBeInTheDocument();
    expect(storedDraft()).toBeNull();
  });

  it("dos pestañas: la segunda no mezcla sus líneas con las de la primera", () => {
    const first = renderPage();

    fireEvent.click(within(first.container).getByRole("button", { name: "elegir proveedor" }));
    fireEvent.click(within(first.container).getByRole("button", { name: "agregar cable" }));
    settleDraft();

    const second = renderPage();
    const inSecond = within(second.container);

    // La segunda ve la compra de la primera como pendiente; lo suyo va a otra ranura.
    expect(inSecond.getByRole("status", { name: "Compra sin terminar" })).toBeInTheDocument();
    fireEvent.click(inSecond.getByRole("button", { name: "elegir otro proveedor" }));
    fireEvent.click(inSecond.getByRole("button", { name: "agregar harina" }));
    settleDraft();

    const productIds = (stored: Record<string, unknown> | null) =>
      (stored?.lines as { items: Array<{ productId: string }> }).items.map((item) => item.productId);

    expect(storedDraft()).toMatchObject({ supplierId: "cont-supplier" });
    expect(productIds(storedDraft())).toEqual(["prod-cable"]);
    expect(storedNewDraft()).toMatchObject({ supplierId: "cont-otro" });
    expect(productIds(storedNewDraft())).toEqual(["prod-harina"]);
  });
});
