import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * INT-02 · B2 — receptor de INV-05: `/purchases/create?restock=<id>` precarga la
 * compra con la selección de «Crear compra con estos productos»
 * (`.notes/ux-mejoras/inventario/INV-05-contrato.md`) y convive con el borrador
 * local de COM-09.
 */

const mockPush = jest.fn();
const mockRate: { data: { rateVes: number } | undefined; error: Error | null } = {
  data: { rateVes: 510 },
  error: null,
};
const mockProfile: { storeId: string; user: { id: string } } = {
  storeId: "store-1",
  user: { id: "user-1" },
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
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => mockRate,
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, profile: mockProfile }),
}));
jest.mock("../../contacts/hooks/useSupplierProducts", () => ({
  useSupplierProducts: () => ({ data: undefined, error: null, isFetching: false }),
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
    </div>
  ),
}));
jest.mock("./components/PurchaseProductPickerCard", () => {
  type PickerProps = Parameters<
    typeof import("./components/PurchaseProductPickerCard").PurchaseProductPickerCard
  >[0];

  return {
    PurchaseProductPickerCard: ({ getItemMeta, lines, onAddProduct }: PickerProps) => (
      <div>
        <ul aria-label="líneas">
          {lines.map(({ edited, item, locked, tax }) => (
            <li key={item.id}>
              {[
                getItemMeta(item.productId).name,
                item.entryMode === "pack"
                  ? `${item.packCount} ${item.packLabel} de ${item.unitsPerPack} a REF ${item.packCostRef}`
                  : `${item.quantity} u a REF ${item.unitCostRef}`,
                `IVA ${tax.code}`,
                locked ? "bloqueada" : "libre",
                edited ? "editada" : "sin editar",
              ].join(" · ")}
            </li>
          ))}
        </ul>
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
      </div>
    ),
  };
});

import {
  createQueryWrapper,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import {
  RESTOCK_DRAFT_KEY_PREFIX,
  RESTOCK_DRAFT_TTL_MS,
  saveRestockDraft,
  type RestockLine,
} from "@/modules/inventory/restock";
import { ToastProvider } from "@/shared/components/Toast";

import { PurchaseCreatePage } from "./page";

/** CNF-01: «Confirmar Compra» abre la confirmación; la compra se envía con el botón del modal. */
function acceptConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: /^Registrar (compra|pedido)$/ }));
}
import { purchaseDraftStorageKey } from "./utils/purchaseDraftStorage";

const SESSION = { storeId: "store-1", userId: "user-1" };
const draftKey = purchaseDraftStorageKey(SESSION);
const UNAVAILABLE =
  "La selección de reposición ya no está disponible. Vuelve a crearla desde Inventario.";

function storeProduct(id: string, name: string, taxRate: number, input: object = {}) {
  return {
    barcode: null,
    category: { id: `cat-${taxRate}`, isActive: true, name: `IVA ${taxRate}`, taxRate },
    categoryId: `cat-${taxRate}`,
    currentCostRef: 9.28,
    currentStock: 1,
    id,
    isActive: true,
    minStock: 5,
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
const PRODUCTS = [cable, harina, refresco, vieja];

function supplierLink(product: ReturnType<typeof storeProduct>, lastCostRef: number, packUnits: object[] = []) {
  return {
    id: `supp-${product.id}`,
    isActive: true,
    isPreferred: false,
    lastCostRef,
    packUnits,
    product: { ...product, taxRate: product.category.taxRate },
    productId: product.id,
    supplierId: "cont-supplier",
  };
}

function restockLine(product: ReturnType<typeof storeProduct>, suggestedQuantity: number): RestockLine {
  return {
    currentStock: product.currentStock,
    // Pista del emisor: el receptor NO la usa como costo.
    lastCostRef: 99,
    minStock: product.minStock,
    name: `${product.name} (foto vieja)`,
    productId: product.id,
    sku: product.sku,
    suggestedQuantity,
  };
}

type ApiOptions = {
  lastCosts?: Record<string, number>;
  links?: Array<ReturnType<typeof supplierLink>>;
  /** Proveedores que conoce `GET /api/purchases/suppliers?id=`; los demás, 404. */
  suppliers?: Array<{ id: string; isActive: boolean; name: string }>;
};

function installApi({
  lastCosts = {},
  links = [],
  suppliers = [{ id: "cont-supplier", isActive: true, name: "Proveedor Demo" }],
}: ApiOptions = {}) {
  const posts: Array<Record<string, unknown>> = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({ data: { id: "purchase-nueva" } }, 201);
    }

    if (url.startsWith("/api/purchases/suppliers")) {
      const id = new URL(url, "http://localhost").searchParams.get("id");
      const supplier = suppliers.find((candidate) => candidate.id === id);

      return supplier
        ? jsonResponse({ data: { ...supplier, taxId: "J-1" } })
        : jsonResponse({ error: { code: "NOT_FOUND", message: "Proveedor no encontrado." } }, 404);
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

    if (/^\/api\/suppliers\/[^/]+\/products/.test(url)) {
      return jsonResponse({ data: { items: links, limit: 100, skip: 0, total: links.length } });
    }

    const product = PRODUCTS.find((candidate) => url === `/api/products/${candidate.id}`);

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

  return render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
}

/** Deja la precarga en `sessionStorage` y la URL con `?restock=<id>`, como hace el emisor. */
function arriveWithRestock(
  lines: RestockLine[],
  supplier?: { id: string; name: string },
  options: { now?: number; session?: typeof SESSION } = {},
) {
  const id = saveRestockDraft(
    { lines, ...(supplier ? { supplier } : {}) },
    options.session ?? SESSION,
    options.now,
  );

  if (!id) {
    throw new Error("SETUP: no se pudo guardar la precarga");
  }

  window.history.replaceState({}, "", `/purchases/create?restock=${id}`);

  return id;
}

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const lineTexts = () =>
  // `hidden`: con un modal abierto el resto de la página queda fuera del árbol accesible.
  within(screen.getByRole("list", { hidden: true, name: "líneas" }))
    .queryAllByRole("listitem", { hidden: true })
    .map((line) => line.textContent);
const restockKeys = () =>
  Object.keys(window.sessionStorage).filter((key) => key.startsWith(RESTOCK_DRAFT_KEY_PREFIX));
const location = () => window.location.pathname + window.location.search;
const conflictModal = () => screen.queryByRole("dialog", { name: "Tienes una compra en curso" });

/** Compra sin terminar de una visita anterior: proveedor y una línea de harina. */
function leaveUnfinishedPurchase() {
  window.history.replaceState({}, "", "/purchases/create");

  const view = renderPage();

  click("elegir proveedor");
  click("agregar harina");
  view.unmount();
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/purchases/create");
  mockPush.mockReset();
  mockRate.data = { rateVes: 510 };
  mockProfile.storeId = "store-1";
  mockProfile.user = { id: "user-1" };
  installApi();
});

describe("PurchaseCreatePage · reposición de stock bajo (INV-05, receptor)", () => {
  it("sin `restock` en la URL nada cambia: compra vacía, sin avisos ni modal", () => {
    renderPage();

    expect(lineTexts()).toEqual([]);
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(conflictModal()).not.toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("con proveedor: lo elige y carga las líneas en el orden del payload, por unidad, con la cantidad sugerida y el costo e IVA del catálogo (no del payload)", async () => {
    const api = installApi({
      lastCosts: { "prod-refresco": 1.5 },
      // El cable tiene un empaque por defecto: a mano nacería por caja; la reposición va por unidad.
      links: [
        supplierLink(cable, 2.32, [
          { id: "pack-1", isDefault: true, label: "Caja", unitsPerPack: 12 },
        ]),
      ],
    });
    arriveWithRestock(
      [restockLine(refresco, 9), restockLine(cable, 4), restockLine(harina, 11)],
      { id: "cont-supplier", name: "Proveedor Demo" },
    );

    renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(3));
    expect(lineTexts()).toEqual([
      // Última compra recibida a REF 1,50 sin IVA.
      "Refresco Cola · 9 u a REF 1.5 · IVA general · libre · sin editar",
      // Vínculo a REF 2,32 con IVA 16 % = REF 2,00.
      "Cable HDMI · 4 u a REF 2 · IVA general · libre · sin editar",
      // Sin vínculo: costo actual del producto (REF 9,28 con IVA 8 %).
      "Harina PAN · 11 u a REF 8.59 · IVA reducida · libre · sin editar",
    ]);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    expect(conflictModal()).not.toBeInTheDocument();
    // Un solo uso: las líneas ya están en el borrador de la compra (COM-09).
    expect(restockKeys()).toEqual([]);
    expect(location()).toBe("/purchases/create");
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(draftKey) ?? "{}")).toMatchObject({
        supplierId: "cont-supplier",
      }),
    );

    click(/Confirmar Compra/);
    acceptConfirmation();
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toMatchObject({ status: "recibido", supplierId: "cont-supplier" });
    expect(
      (api.posts[0].items as Array<{ productId: string; quantity: number }>).map((item) => [
        item.productId,
        item.quantity,
      ]),
    ).toEqual([
      ["prod-refresco", 9],
      ["prod-cable", 4],
      ["prod-harina", 11],
    ]);
  });

  it("sin proveedor: no inventa uno, avisa cuántos productos esperan y los carga al elegirlo, sin preguntar ni vaciarlos", async () => {
    arriveWithRestock([restockLine(cable, 4), restockLine(harina, 2)]);

    renderPage();

    expect(
      await screen.findByText("Elige el proveedor para cargar 2 productos de la reposición"),
    ).toBeInTheDocument();
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
    // Aún no está en la compra: una recarga debe volver a encontrarla.
    expect(restockKeys()).toHaveLength(1);

    await act(async () => {
      click("elegir proveedor");
    });

    await waitFor(() => expect(lineTexts()).toHaveLength(2));
    expect(lineTexts().map((line) => line?.split(" · ").slice(0, 2).join(" · "))).toEqual([
      "Cable HDMI · 4 u a REF 8",
      "Harina PAN · 2 u a REF 8.59",
    ]);
    expect(screen.getByText("proveedor: cont-supplier")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Cambiar de proveedor" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Elige el proveedor para cargar/)).not.toBeInTheDocument();
    expect(restockKeys()).toEqual([]);
    expect(location()).toBe("/purchases/create");
  });

  it("recargar antes de elegir proveedor vuelve a ofrecer la misma reposición, sin duplicar", async () => {
    arriveWithRestock([restockLine(cable, 4)]);

    const first = renderPage();

    await screen.findByText("Elige el proveedor para cargar 1 producto de la reposición");
    first.unmount();
    renderPage();

    expect(
      await screen.findByText("Elige el proveedor para cargar 1 producto de la reposición"),
    ).toBeInTheDocument();
    await act(async () => {
      click("elegir proveedor");
    });
    await waitFor(() => expect(lineTexts()).toHaveLength(1));
  });

  it("proveedor inactivo o inexistente: se trata como sin proveedor y se avisa", async () => {
    installApi({ suppliers: [{ id: "cont-supplier", isActive: false, name: "Proveedor Demo" }] });
    arriveWithRestock([restockLine(cable, 4)], { id: "cont-supplier", name: "Proveedor Demo" });

    renderPage();

    expect(
      await screen.findByText("Elige el proveedor para cargar 1 producto de la reposición"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("El proveedor de la reposición ya no está disponible"),
    ).toBeInTheDocument();
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
  });

  it("producto inactivo o borrado: se omite, el resto entra y se avisa cuántos faltaron", async () => {
    arriveWithRestock(
      [
        restockLine(vieja, 3),
        restockLine(cable, 4),
        restockLine(storeProduct("prod-borrado", "Borrado", 16), 2),
      ],
      { id: "cont-supplier", name: "Proveedor Demo" },
    );

    renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(1));
    expect(lineTexts()[0]).toContain("Cable HDMI · 4 u");
    expect(screen.getByText("2 productos no se pudieron cargar")).toBeInTheDocument();
  });

  it.each([
    ["id inventado", () => window.history.replaceState({}, "", "/purchases/create?restock=5b0e4a1e-0000-4000-8000-000000000000")],
    ["id raro", () => window.history.replaceState({}, "", "/purchases/create?restock=..%2Fx")],
    [
      "caducada (> 30 min)",
      () =>
        arriveWithRestock([restockLine(cable, 4)], undefined, {
          now: Date.now() - RESTOCK_DRAFT_TTL_MS - 1000,
        }),
    ],
    [
      "de otro usuario",
      () =>
        arriveWithRestock([restockLine(cable, 4)], undefined, {
          session: { storeId: "store-1", userId: "user-2" },
        }),
    ],
    [
      "JSON corrupto",
      () => {
        const id = arriveWithRestock([restockLine(cable, 4)]);

        window.sessionStorage.setItem(`${RESTOCK_DRAFT_KEY_PREFIX}:${id}`, "{roto");
      },
    ],
  ])("precarga inservible (%s): avisa, no precarga nada y quita `restock` de la URL", async (_name, arrange) => {
    arrange();

    renderPage();

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(screen.queryByText(/Elige el proveedor para cargar/)).not.toBeInTheDocument();
    expect(location()).toBe("/purchases/create");
  });

  it("tras usarla, el mismo enlace ya no sirve: aviso, compra vacía y URL limpia", async () => {
    const id = arriveWithRestock([restockLine(cable, 4)], {
      id: "cont-supplier",
      name: "Proveedor Demo",
    });
    const first = renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(1));
    first.unmount();
    window.localStorage.clear();
    window.history.replaceState({}, "", `/purchases/create?restock=${id}`);
    renderPage();

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument();
    expect(lineTexts()).toEqual([]);
    expect(location()).toBe("/purchases/create");
  });
});

describe("PurchaseCreatePage · reposición con una compra en curso (INV-05 + borrador COM-09)", () => {
  it("con un borrador guardado pregunta; «Conservar la compra actual» no toca nada y consume la reposición", async () => {
    leaveUnfinishedPurchase();

    const before = window.localStorage.getItem(draftKey);

    arriveWithRestock([restockLine(cable, 4)], { id: "cont-supplier", name: "Proveedor Demo" });
    renderPage();

    const modal = await screen.findByRole("dialog", { name: "Tienes una compra en curso" });

    // Nada se pisa mientras el usuario no decide.
    expect(lineTexts()).toEqual([]);
    expect(window.localStorage.getItem(draftKey)).toBe(before);

    fireEvent.click(within(modal).getByRole("button", { name: "Conservar la compra actual" }));

    await waitFor(() => expect(conflictModal()).not.toBeInTheDocument());
    expect(lineTexts()).toEqual([]);
    expect(screen.getByText("proveedor: ninguno")).toBeInTheDocument();
    expect(window.localStorage.getItem(draftKey)).toBe(before);
    // El borrador sigue ofreciéndose tal cual.
    expect(screen.getByRole("status", { name: "Compra sin terminar" })).toBeInTheDocument();
    expect(restockKeys()).toEqual([]);
    expect(location()).toBe("/purchases/create");
  });

  it("«Reemplazar por la reposición» descarta el borrador guardado y precarga la reposición", async () => {
    leaveUnfinishedPurchase();
    arriveWithRestock([restockLine(cable, 4)], { id: "cont-supplier", name: "Proveedor Demo" });
    renderPage();

    const modal = await screen.findByRole("dialog", { name: "Tienes una compra en curso" });

    await act(async () => {
      fireEvent.click(within(modal).getByRole("button", { name: "Reemplazar por la reposición" }));
    });

    await waitFor(() => expect(lineTexts()).toHaveLength(1));
    expect(lineTexts()[0]).toContain("Cable HDMI · 4 u");
    expect(conflictModal()).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Compra sin terminar" })).not.toBeInTheDocument();
    // El borrador de la compra es ahora la reposición (una sola línea: el cable).
    await waitFor(() => expect(window.localStorage.getItem(draftKey)).not.toBeNull());

    const stored = JSON.parse(window.localStorage.getItem(draftKey) ?? "{}") as {
      lines: { items: Array<{ productId: string }> };
    };

    expect(stored.lines.items.map((item) => item.productId)).toEqual(["prod-cable"]);
    expect(restockKeys()).toEqual([]);
    expect(location()).toBe("/purchases/create");
  });

  it("cerrar el modal sin elegir equivale a conservar: nada cambia", async () => {
    leaveUnfinishedPurchase();

    const before = window.localStorage.getItem(draftKey);

    arriveWithRestock([restockLine(cable, 4)], { id: "cont-supplier", name: "Proveedor Demo" });
    renderPage();

    await screen.findByRole("dialog", { name: "Tienes una compra en curso" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(conflictModal()).not.toBeInTheDocument());
    expect(lineTexts()).toEqual([]);
    expect(window.localStorage.getItem(draftKey)).toBe(before);
    expect(restockKeys()).toEqual([]);
  });

  it("con líneas precargadas, confirmar dos veces seguidas envía UNA compra y borra el borrador", async () => {
    const api = installApi();

    arriveWithRestock([restockLine(cable, 4)], { id: "cont-supplier", name: "Proveedor Demo" });
    renderPage();

    await waitFor(() => expect(lineTexts()).toHaveLength(1));

    // CNF-01: el doble clic que envía es el del botón de la confirmación.
    fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));

    const register = screen.getByRole("button", { name: "Registrar compra" });

    fireEvent.click(register);
    fireEvent.click(register);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-nueva"));
    expect(api.posts).toHaveLength(1);
    expect(window.localStorage.getItem(draftKey)).toBeNull();
  });
});
