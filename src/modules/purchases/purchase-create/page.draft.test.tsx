import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/** COM-09 · borrador local de la compra en curso, duplicar compra y ProcessGuard. */

const mockPush = jest.fn();
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
import { purchaseDraftStorageKey } from "./utils/purchaseDraftStorage";

const draftKey = purchaseDraftStorageKey({ storeId: "store-1", userId: "user-1" });

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
const PURCHASE_NOT_FOUND = { error: { code: "NOT_FOUND", message: "Compra no encontrada." } };

type ApiOptions = {
  links?: Array<ReturnType<typeof supplierLink>>;
  /** Compra de origen; `null` = el servidor responde 404. */
  purchase?: ReturnType<typeof sourcePurchase> | null;
};

/** `fetch` de prueba: fichas de producto, vínculos del proveedor, compra de origen y el POST. */
function installApi({ links = [], purchase }: ApiOptions = {}) {
  const products = [cable, harina, refresco, vieja];
  const posts: Array<Record<string, unknown>> = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({ data: { id: "purchase-nueva" } }, 201);
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
  window.localStorage.clear();
  window.history.replaceState({}, "", "/purchases/create");
  mockPush.mockReset();
  mockRate.data = { rateVes: 510 };
  mockRate.error = null;
  installApi();
});

describe("PurchaseCreatePage · borrador local (COM-09)", () => {
  it("no guarda nada con el formulario vacío y guarda al haber una línea, sin pago ni clave de idempotencia", () => {
    renderPage();

    click("elegir proveedor");
    expect(storedDraft()).toBeNull();

    click("agregar cable");

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
      "Tienes una compra sin terminar (proveedor Proveedor Demo · 2 líneas · guardada hace un momento)",
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

    expect(window.localStorage.getItem(draftKey)).toBe(before);
    expect(banner()).toHaveTextContent("Restaurar sustituye lo que hay ahora en el formulario.");
  });

  it("confirmar la compra borra el borrador", async () => {
    const api = installApi();

    renderPage();
    click("elegir proveedor");
    click("agregar cable");
    expect(storedDraft()).not.toBeNull();

    click(/Confirmar Compra/);

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
  const guardDialog = () => screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });

  it("sin líneas salir no pregunta; con una línea pregunta nombrando la compra", () => {
    renderPage();
    click("elegir proveedor");

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));
    expect(guardDialog()).not.toBeInTheDocument();

    click("agregar cable");
    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    expect(guardDialog()).toBeInTheDocument();
    expect(within(guardDialog() as HTMLElement).getByText("Compra en curso con 1 línea")).toBeInTheDocument();
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
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toMatchObject({ discountRef: 0, status: "recibido", supplierId: "cont-supplier" });
    expect(api.posts[0]).not.toHaveProperty("notes");
    expect(api.posts[0]).not.toHaveProperty("initialPayment");
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

  it("con un borrador pendiente manda lo duplicado, el borrador no se toca y Restaurar lo sustituye", async () => {
    window.history.replaceState({}, "", "/purchases/create");
    leaveUnfinishedPurchase();

    const before = window.localStorage.getItem(draftKey);

    window.history.replaceState({}, "", "/purchases/create?duplicate=pur-1");
    installApi({ links: [supplierLink(cable, 2.32)], purchase: sourcePurchase(activeSupplier) });
    renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(lineTexts()[0]).toContain("Cable HDMI · 3 u");
    expect(window.localStorage.getItem(draftKey)).toBe(before);
    expect(banner()).toHaveTextContent("Restaurar sustituye lo que hay ahora en el formulario.");

    await act(async () => {
      click("Restaurar");
    });

    await waitFor(() => expect(banner()).not.toBeInTheDocument());
    expect(lineTexts().map((line) => line?.split(" · ")[0])).toEqual(["Harina PAN", "Cable HDMI"]);
    expect(screen.getByText("compra exenta: sí")).toBeInTheDocument();
    expect(screen.queryByText(/No se duplicó/)).not.toBeInTheDocument();
  });
});
