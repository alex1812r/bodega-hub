import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * COM-F11 · el costo sugerido de una línea es el costo unitario SIN IVA de la última
 * línea de compra recibida del producto (`GET /api/purchases/last-costs`), no el costo
 * guardado con IVA dividido entre la alícuota de la categoría.
 *
 * El servidor de prueba hace lo que `create_purchase`: guarda la línea con su costo neto
 * y su alícuota y deja en el producto `neto × (1 + alícuota DE LA LÍNEA)`. Con una compra
 * exenta de un producto de categoría 16 %, dividir ese costo entre 1,16 lo bajaba un
 * 13,8 % en cada compra confirmada sin teclear nada.
 */

const mockPush = jest.fn();

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
    mockBuildTaxRate("general", "General", 16, 30),
  ],
  refetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, error: null }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: ({ onSupplierChange }: { onSupplierChange: (id: string) => void }) => (
    <button onClick={() => onSupplierChange("cont-supplier")} type="button">
      elegir proveedor
    </button>
  ),
}));

import {
  createQueryWrapper,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";
import { roundMoney } from "@/shared/utils/currency";

import { PurchaseCreatePage } from "./page";

/** CNF-01: «Confirmar Compra» abre la confirmación; la compra se envía con el botón del modal. */
function acceptConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: /^Registrar (compra|pedido)$/ }));
}

const BARCODE = "7501234567890";
const CATEGORY_PCT = 16;

type LastLine = { taxRate: number; unitCostRef: number };
type PostedItem = { taxRate: number; unitCostRef: number };

/** Lo que el servidor sabe del Taladro: su costo CON IVA y su última línea recibida. */
function installServer(initial: { currentCostRef: number; lastLine: LastLine | null }) {
  const state = { ...initial };
  const posted: PostedItem[] = [];
  const lastCostRequests: string[] = [];
  let holdLastCosts: Promise<void> | null = null;

  function productRow() {
    return {
      barcode: BARCODE,
      category: { id: "cat-electric", isActive: true, name: "Eléctricos", taxRate: CATEGORY_PCT },
      categoryId: "cat-electric",
      currentCostRef: state.currentCostRef,
      currentStock: 4,
      id: "prod-drill",
      isActive: true,
      name: "Taladro",
      sku: "ELE-TAL-001",
    };
  }

  function page(items: unknown[]) {
    return { items, limit: 20, skip: 0, total: items.length };
  }

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");

    if (init?.method === "POST" && url.pathname === "/api/purchases") {
      const body = JSON.parse(String(init.body)) as { items: PostedItem[] };
      const [item] = body.items;

      posted.push(item);
      state.lastLine = { taxRate: item.taxRate, unitCostRef: item.unitCostRef };
      state.currentCostRef = roundMoney(item.unitCostRef * (1 + item.taxRate / 100));

      return jsonResponse({ data: { id: `purchase-${posted.length}` } }, 201);
    }

    if (url.pathname === "/api/purchases/last-costs") {
      lastCostRequests.push(url.search);
      await holdLastCosts;

      return jsonResponse({
        data: state.lastLine
          ? [{ productId: "prod-drill", source: "supplier", ...state.lastLine }]
          : [],
      });
    }

    if (url.pathname === "/api/products") {
      const barcode = url.searchParams.get("barcode");
      const sku = url.searchParams.get("sku");
      const matches = sku !== null || (barcode !== null && barcode !== BARCODE) ? [] : [productRow()];

      return jsonResponse({ data: page(matches) });
    }

    if (url.pathname.startsWith("/api/suppliers/")) {
      return jsonResponse({ data: page([]) });
    }

    return jsonResponse({ data: null });
  }) as unknown as typeof fetch;

  return {
    /** La respuesta de los últimos costos queda en vuelo hasta llamar a la función devuelta. */
    holdLastCosts() {
      let release: () => void = () => undefined;

      holdLastCosts = new Promise<void>((resolve) => {
        release = resolve;
      });

      return () => release();
    },
    lastCostRequests,
    posted,
    state,
  };
}

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "elegir proveedor" }));
}

function searchBox() {
  return screen.getByRole<HTMLInputElement>("searchbox", { name: "Buscar productos" });
}

async function findResult() {
  fireEvent.change(searchBox(), { target: { value: "tal" } });

  return within(
    await screen.findByRole("list", { name: "Productos encontrados" }, { timeout: 3000 }),
  ).getByRole("button", { name: /Taladro/ });
}

async function pickFromList() {
  fireEvent.click(await findResult());
  await screen.findByLabelText("Cantidad de Taladro");
}

async function scan() {
  fireEvent.change(searchBox(), { target: { value: BARCODE } });
  fireEvent.keyDown(searchBox(), { key: "Enter" });
  await screen.findByLabelText("Cantidad de Taladro");
}

/** Una compra de 1 Taladro confirmada SIN teclear ningún costo; devuelve la línea enviada. */
async function buyWithoutTyping(
  server: ReturnType<typeof installServer>,
  options: { add: () => Promise<void>; exempt: boolean },
) {
  const already = server.posted.length;

  renderPage();
  await options.add();

  if (options.exempt) {
    fireEvent.click(screen.getByRole("switch", { name: "Compra exenta" }));
  }

  fireEvent.click(screen.getByRole("button", { name: /Confirmar Compra/ }));
  acceptConfirmation();
  await waitFor(() => expect(server.posted).toHaveLength(already + 1));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/purchases/purchase-${already + 1}`));
  cleanup();

  return server.posted[already];
}

beforeEach(() => {
  mockPush.mockReset();
  window.localStorage.clear();
});

// Each case drives three full purchases through the page; under a loaded full run it exceeds the 5 s default.
jest.setTimeout(30000);

describe("PurchaseCreatePage · costo sugerido = último costo neto recibido (COM-F11)", () => {
  it("sugiere 2.494,41 a un producto de categoría 16 % cuya última compra fue exenta a 2.494,41", async () => {
    installServer({ currentCostRef: 2494.41, lastLine: { taxRate: 0, unitCostRef: 2494.41 } });

    renderPage();
    await pickFromList();

    // REF 2.494,41 a tasa 510 = Bs 1.272.149,10 (dividido entre 1,16 saldría REF 2.150,35).
    expect(screen.getByLabelText<HTMLInputElement>("Costo unitario BS de Taladro").value).toBe(
      "1272149.10",
    );
  });

  it.each([
    ["la lista del buscador", pickFromList],
    ["un escaneo", scan],
  ])("comprar exento sin teclear, tres veces, por %s: el costo enviado no baja", async (_, add) => {
    const server = installServer({
      currentCostRef: 2893.52,
      lastLine: { taxRate: 16, unitCostRef: 2494.41 },
    });
    const sent: PostedItem[] = [];

    for (let round = 0; round < 3; round += 1) {
      sent.push(await buyWithoutTyping(server, { add, exempt: true }));
    }

    expect(sent.map((item) => item.unitCostRef)).toEqual([2494.41, 2494.41, 2494.41]);
    expect(sent.map((item) => item.taxRate)).toEqual([0, 0, 0]);
    // El costo del producto queda en el neto de la compra exenta, sin seguir bajando.
    expect(server.state.currentCostRef).toBe(2494.41);
  });

  it("exenta y luego gravada sin teclear: la gravada sugiere el mismo neto, no 2.150,35 + 16 %", async () => {
    const server = installServer({
      currentCostRef: 2893.52,
      lastLine: { taxRate: 16, unitCostRef: 2494.41 },
    });

    const exempt = await buyWithoutTyping(server, { add: pickFromList, exempt: true });
    const taxed = await buyWithoutTyping(server, { add: pickFromList, exempt: false });
    const taxedAgain = await buyWithoutTyping(server, { add: scan, exempt: false });

    expect([exempt, taxed, taxedAgain].map((item) => item.unitCostRef)).toEqual([
      2494.41, 2494.41, 2494.41,
    ]);
    expect([exempt, taxed, taxedAgain].map((item) => item.taxRate)).toEqual([0, 16, 16]);
    expect(server.state.currentCostRef).toBe(2893.52);
  });

  it("compra gravada normal sin teclear: sin deriva de un céntimo", async () => {
    // Se compró a 2.494,40 + 16 % y el costo guardado del producto es 2.893,51: dividirlo
    // entre 1,16 daba 2.494,41, un céntimo más que lo pagado (y 2.893,52 al confirmar).
    const server = installServer({
      currentCostRef: 2893.51,
      lastLine: { taxRate: 16, unitCostRef: 2494.4 },
    });
    const sent: PostedItem[] = [];

    for (let round = 0; round < 3; round += 1) {
      sent.push(await buyWithoutTyping(server, { add: pickFromList, exempt: false }));
    }

    expect(sent.map((item) => item.unitCostRef)).toEqual([2494.4, 2494.4, 2494.4]);
    expect(server.state.currentCostRef).toBe(2893.5);
  });

  it("producto sin compras previas: conserva el cálculo actual (costo con IVA entre la alícuota de la categoría)", async () => {
    const server = installServer({ currentCostRef: 11.6, lastLine: null });

    const sent = await buyWithoutTyping(server, { add: pickFromList, exempt: false });

    expect(sent.unitCostRef).toBe(10);
    expect(server.lastCostRequests.length).toBeGreaterThan(0);
  });

  it("pide los últimos costos una vez por página de resultados, con el proveedor y los ids", async () => {
    const server = installServer({
      currentCostRef: 2893.52,
      lastLine: { taxRate: 16, unitCostRef: 2494.41 },
    });

    renderPage();
    await findResult();
    await waitFor(() => expect(server.lastCostRequests).toHaveLength(1));

    expect(new URLSearchParams(server.lastCostRequests[0]).get("supplierId")).toBe("cont-supplier");
    expect(new URLSearchParams(server.lastCostRequests[0]).get("productIds")).toBe("prod-drill");
  });

  it("si se elige el producto antes de que lleguen los costos, la línea espera y nace con el último neto", async () => {
    const server = installServer({ currentCostRef: 2494.41, lastLine: { taxRate: 0, unitCostRef: 2494.41 } });
    const release = server.holdLastCosts();

    renderPage();
    fireEvent.click(await findResult());

    // La lista no esperó a los costos; la línea sí.
    expect(screen.queryByLabelText("Cantidad de Taladro")).not.toBeInTheDocument();

    release();

    expect(
      (await screen.findByLabelText<HTMLInputElement>("Costo unitario BS de Taladro")).value,
    ).toBe("1272149.10");
  });
});
