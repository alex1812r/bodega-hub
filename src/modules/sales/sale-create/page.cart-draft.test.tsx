/**
 * CNF-15b/16b · POS: guardia de salida con carrito y carrito recuperable.
 *
 * Se monta la pantalla REAL (`SaleCreatePage`) con `fetch` simulado por URL, como en
 * `page.stock-integrity.test.tsx`. La persistencia fina (espera, pestañas,
 * `localStorage` roto) está en `hooks/usePosCartDraft.test.tsx`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/shared/components/Toast";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";
import { formatRefUsd } from "@/shared/utils/currency";

import { SaleCreatePage } from "./page";

const mockPush = jest.fn();
const mockLinkNavigate = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
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
    children?: ReactNode;
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented) {
          return;
        }

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

type CatalogProduct = {
  barcode: string;
  categoryId: string;
  currentCostRef: number;
  currentStock: number;
  id: string;
  isActive: boolean;
  minStock: number;
  name: string;
  salePriceRef: number;
  sku: string;
};

type SalePostBody = {
  clientRequestId?: string;
  customerId?: string;
  items?: Array<{ productId: string; quantity: number }>;
};

const CUSTOMER = { id: "cont-1", isPosDefault: true, name: "Cliente mostrador CNF", type: "cliente" };

const HARINA: CatalogProduct = {
  barcode: "7590000000011",
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 20,
  id: "prod-harina",
  isActive: true,
  minStock: 5,
  name: "Harina CNF",
  salePriceRef: 2,
  sku: "cnf-harina",
};

const AZUCAR: CatalogProduct = {
  ...HARINA,
  barcode: "7590000000028",
  id: "prod-azucar",
  name: "Azucar CNF",
  salePriceRef: 3,
  sku: "cnf-azucar",
};

const REGISTER = { assignedUserId: "user-1", id: "reg-1", isActive: true, name: "Caja 1" };

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function paginated<T>(items: T[]) {
  return { items, limit: 100, skip: 0, total: items.length };
}

type BackendOptions = {
  onSalePost?: (attempt: number) => Response;
  products?: CatalogProduct[];
  /** `null`: el servidor dice que no hay caja abierta. */
  session?: { id: string; registerId: string } | null;
  userId?: string;
};

/** BFF simulado por URL. Anota TODAS las peticiones, en orden. */
function mountBackend({
  onSalePost,
  products = [HARINA, AZUCAR],
  session = { id: "session-1", registerId: REGISTER.id },
  userId = "user-1",
}: BackendOptions = {}) {
  const requests: string[] = [];
  const salePosts: SalePostBody[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const route = `${init?.method ?? "GET"} ${url.pathname}`;

    requests.push(route);

    switch (route) {
      case "POST /api/sales":
        salePosts.push(JSON.parse(String(init?.body ?? "{}")) as SalePostBody);
        return (
          onSalePost?.(salePosts.length) ??
          jsonResponse(
            { data: { id: `sale-${salePosts.length}`, invoiceNumber: `V-CNF-${salePosts.length}`, status: "pagada" } },
            201,
          )
        );
      case "GET /api/products":
        return jsonResponse({ data: paginated(products) });
      case "GET /api/cash/session":
        return jsonResponse({
          data: session
            ? {
                id: session.id,
                liveTotals: { cashRef: 100, cashVes: 50000 },
                openedAt: new Date().toISOString(),
                openingRef: 100,
                openingVes: 50000,
                register: { ...REGISTER, id: session.registerId },
                registerId: session.registerId,
                status: "open",
              }
            : null,
        });
      case "GET /api/cash/registers":
        return jsonResponse({ data: [REGISTER] });
      case "GET /api/cash/movements":
        return jsonResponse({ data: { movements: [], theoretical: { ref: 100, ves: 50000 } } });
      case "GET /api/auth/me":
        return jsonResponse({
          data: {
            deniedPermissions: [],
            grantedPermissions: [],
            permissionCatalog: [],
            permissions: [],
            role: "vendedor",
            roles: ["vendedor"],
            storeId: "store-1",
            user: { email: "vendedor@example.com", id: userId, name: "Vendedor" },
          },
        });
      case "GET /api/contacts":
        return jsonResponse({ data: paginated([CUSTOMER]) });
      case "GET /api/categories":
        return jsonResponse({ data: paginated([]) });
      case "GET /api/exchange-rates/current":
        return jsonResponse({
          data: { createdAt: new Date().toISOString(), id: "rate-1", rateVes: 500, source: "manual" },
        });
      case "GET /api/settings/payment-methods":
        return jsonResponse({ data: { enabledPaymentMethods: DEFAULT_ENABLED_PAYMENT_METHODS } });
      default:
        return jsonResponse({ error: { code: "NOT_FOUND", message: route } }, 404);
    }
  }) as typeof fetch;

  return { requests, salePosts };
}

/** Monta el POS como una carga de página nueva (QueryClient y estado de React nuevos). */
function mountPos() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SaleCreatePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function flush(ms = 50) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function addToCart(product: CatalogProduct) {
  const labels = await screen.findAllByText(product.name);
  const card = labels.map((label) => label.closest("button")).find((button) => button !== null);

  if (!card) {
    throw new Error(`montaje: no se encontró la tarjeta de ${product.name}`);
  }

  fireEvent.click(card);
}

async function expectCartCount(text: string) {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}

async function chargeInCashUsd() {
  await screen.findAllByText(CUSTOMER.name);
  fireEvent.click(screen.getByRole("button", { name: paymentMethodLabels.efectivo_usd }));

  const chargeButton = screen.getByRole("button", { name: "Procesar venta" });

  await waitFor(() => expect(chargeButton).toBeEnabled());
  fireEvent.click(chargeButton);
}

function draftKeys() {
  return Object.keys(window.localStorage).filter((key) => key.includes(":pos:carrito:v"));
}

function guardDialog() {
  return screen.queryByText("¿Salir sin terminar?");
}

/** `true` si el navegador mostraría el aviso nativo de salida. */
function beforeUnloadIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
}

// jsdom no trae `MediaStream`, y el escáner de cámara lo consulta al cerrarse.
beforeAll(() => {
  Object.defineProperty(globalThis, "MediaStream", {
    configurable: true,
    value: class MediaStreamStub {},
    writable: true,
  });
});

const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  mockPush.mockClear();
  mockLinkNavigate.mockClear();
  // Escritorio: el carrito va en la columna derecha, no en el modal móvil.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
    writable: true,
  });
});

describe("CNF-15 · guardia de salida del POS", () => {
  it("con el carrito vacío no hay guardia: el enlace navega y no hay aviso nativo", async () => {
    mountBackend();
    mountPos();
    await screen.findAllByText(HARINA.name);

    fireEvent.click(screen.getByRole("link", { name: "Volver a ventas" }));

    expect(mockLinkNavigate).toHaveBeenCalledWith("/sales");
    expect(guardDialog()).not.toBeInTheDocument();
    expect(beforeUnloadIsBlocked()).toBe(false);
  });

  it("con líneas pregunta nombrando la venta; «Seguir aquí» no pierde nada y «Salir» guarda el carrito y sale", async () => {
    mountBackend();
    mountPos();
    await addToCart(HARINA);
    await addToCart(AZUCAR);
    await expectCartCount("2 items");
    await screen.findAllByText(CUSTOMER.name);

    fireEvent.click(screen.getByRole("link", { name: "Volver a ventas" }));

    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(
        `Venta en curso · 2 productos · ${formatRefUsd(5)} · ${CUSTOMER.name}`,
      ),
    ).toBeInTheDocument();
    expect(mockLinkNavigate).not.toHaveBeenCalled();
    expect(beforeUnloadIsBlocked()).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Seguir aquí" }));
    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // «Salir» no espera al guardado automático: el carrito queda escrito al salir.
    window.localStorage.clear();
    fireEvent.click(screen.getByRole("link", { name: "Volver a ventas" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Salir" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/sales"));
    expect(draftKeys()).toHaveLength(1);
  });

  it("ATRÁS del navegador con el carrito lleno pregunta y, si se queda, la URL no cambia", async () => {
    mountBackend();
    mountPos();
    await addToCart(HARINA);
    await expectCartCount("1 item");

    const urlBefore = window.location.href;

    act(() => window.history.back());

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/^Venta en curso · 1 producto/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Seguir aquí" }));

    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    await flush();
    expect(window.location.href).toBe(urlBefore);
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("el aviso nativo de recarga deja el carrito guardado sin esperar", async () => {
    mountBackend();
    mountPos();
    await addToCart(HARINA);
    await expectCartCount("1 item");

    expect(draftKeys()).toEqual([]);
    expect(beforeUnloadIsBlocked()).toBe(true);
    expect(draftKeys()).toHaveLength(1);
  });

  it("no aparece al abrir ni cerrar el cobro, el cliente o el escáner", async () => {
    mountBackend();
    mountPos();
    await addToCart(HARINA);
    await expectCartCount("1 item");
    await screen.findAllByText(CUSTOMER.name);

    for (const opener of [
      screen.getByRole("button", { name: "Cobrar con billetes y vuelto" }),
      screen.getByRole("button", { name: CUSTOMER.name }),
      screen.getByRole("button", { name: "Escanear codigo" }),
    ]) {
      fireEvent.click(opener);

      const modal = await screen.findByRole("dialog");

      expect(guardDialog()).not.toBeInTheDocument();
      fireEvent.keyDown(modal, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(guardDialog()).not.toBeInTheDocument();
    }

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("tras cobrar no hay guardia ni carrito guardado: se sale sin preguntas", async () => {
    const backend = mountBackend();

    mountPos();
    await addToCart(HARINA);
    await expectCartCount("1 item");
    // El guardado automático ya escribió el carrito antes de cobrar.
    await flush(600);
    expect(draftKeys()).toHaveLength(1);

    await chargeInCashUsd();
    await screen.findByText("Venta registrada");

    expect(backend.salePosts).toHaveLength(1);
    expect(guardDialog()).not.toBeInTheDocument();
    expect(draftKeys()).toEqual([]);
    expect(beforeUnloadIsBlocked()).toBe(false);

    fireEvent.click(screen.getByRole("link", { name: "Volver al listado" }));

    expect(mockLinkNavigate).toHaveBeenCalledWith("/sales");
    expect(guardDialog()).not.toBeInTheDocument();

    // Ni un guardado tardío lo resucita.
    await flush(600);
    expect(draftKeys()).toEqual([]);
  });
});

describe("CNF-16 · carrito recuperable del POS", () => {
  it("al volver con la misma caja abierta restaura el carrito y avisa; «Vaciar» lo descarta", async () => {
    mountBackend();

    const firstVisit = mountPos();

    await addToCart(HARINA);
    await addToCart(HARINA);
    await addToCart(AZUCAR);
    await expectCartCount("3 items");
    firstVisit.unmount();

    mountPos();

    expect(await screen.findByText("Carrito recuperado")).toBeInTheDocument();
    await expectCartCount("3 items");

    fireEvent.click(screen.getByRole("button", { name: "Vaciar" }));

    await screen.findByText("Carrito vacio");
    await waitFor(() => expect(draftKeys()).toEqual([]));
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
  });

  it("el carrito restaurado se cobra con las cantidades guardadas y sin datos de cobro heredados", async () => {
    const backend = mountBackend();
    const firstVisit = mountPos();

    await addToCart(HARINA);
    await addToCart(HARINA);
    await expectCartCount("2 items");
    fireEvent.click(await screen.findByRole("button", { name: paymentMethodLabels.efectivo_usd }));
    firstVisit.unmount();

    expect(window.localStorage.getItem(draftKeys()[0] ?? "")).not.toMatch(/efectivo|payment|method/i);

    mountPos();
    await expectCartCount("2 items");
    // El método de pago no viaja con el carrito: hay que elegirlo otra vez.
    expect(screen.getByRole("button", { name: "Procesar venta" })).toBeDisabled();

    await chargeInCashUsd();
    await screen.findByText("Venta registrada");

    expect(backend.salePosts[0]?.items).toEqual([{ productId: HARINA.id, quantity: 2 }]);
    expect(backend.salePosts[0]?.customerId).toBe(CUSTOMER.id);
    expect(draftKeys()).toEqual([]);
  });

  it("producto desactivado y precio cambiado: se quita avisando cuál y se vende al precio actual", async () => {
    mountBackend();

    const firstVisit = mountPos();

    await addToCart(HARINA);
    await addToCart(AZUCAR);
    await expectCartCount("2 items");
    firstVisit.unmount();

    // Mientras tanto: el azúcar se desactivó y la harina subió de precio.
    mountBackend({ products: [{ ...HARINA, salePriceRef: 2.5 }] });
    mountPos();

    await screen.findByText("Carrito recuperado");
    await expectCartCount("1 item");
    expect(screen.getByText(new RegExp(`se quitaron: ${AZUCAR.name}`))).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`${HARINA.name} ${formatRefUsd(2)} → ${formatRefUsd(2.5)}`.replace(/[.$]/g, "\\$&")),
      ),
    ).toBeInTheDocument();
    // El total es el del precio vigente, no el guardado.
    expect(screen.getAllByText(formatRefUsd(2.5)).length).toBeGreaterThan(0);
  });

  it("limpiar la orden borra el carrito guardado", async () => {
    mountBackend();
    mountPos();
    await addToCart(HARINA);
    await expectCartCount("1 item");
    await flush(600);
    expect(draftKeys()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Limpiar orden" }));

    await screen.findByText("Carrito vacio");
    expect(draftKeys()).toEqual([]);
  });

  it("otra sesión de caja: el carrito del turno anterior no reaparece y se borra", async () => {
    mountBackend();

    const firstVisit = mountPos();

    await addToCart(HARINA);
    await expectCartCount("1 item");
    firstVisit.unmount();
    expect(draftKeys()).toHaveLength(1);

    mountBackend({ session: { id: "session-2", registerId: REGISTER.id } });
    mountPos();

    await screen.findAllByText(HARINA.name);
    await flush();
    expect(screen.getByText("Carrito vacio")).toBeInTheDocument();
    expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
    expect(draftKeys()).toEqual([]);
  });

  it("caja cerrada: al entrar al POS sin caja abierta se borran los carritos guardados", async () => {
    mountBackend();

    const firstVisit = mountPos();

    await addToCart(HARINA);
    await expectCartCount("1 item");
    firstVisit.unmount();
    expect(draftKeys()).toHaveLength(1);

    mountBackend({ session: null });
    mountPos();

    await screen.findByText("Caja cerrada");
    await waitFor(() => expect(draftKeys()).toEqual([]));
  });

  it("otro usuario u otra caja en el mismo navegador no heredan el carrito", async () => {
    mountBackend();

    const firstVisit = mountPos();

    await addToCart(HARINA);
    await expectCartCount("1 item");
    firstVisit.unmount();

    for (const other of [
      { userId: "user-2" },
      { session: { id: "session-1", registerId: "reg-2" } },
    ]) {
      mountBackend(other);

      const visit = mountPos();

      await screen.findAllByText(HARINA.name);
      await flush();
      expect(screen.getByText("Carrito vacio")).toBeInTheDocument();
      expect(screen.queryByText("Carrito recuperado")).not.toBeInTheDocument();
      visit.unmount();
    }

    // El carrito del primero sigue guardado para cuando vuelva.
    expect(draftKeys()).toHaveLength(1);
  });

  it("un carrito restaurado y luego modificado tras un rechazo no reutiliza la clave del intento anterior", async () => {
    const backend = mountBackend({
      onSalePost: (attempt) =>
        attempt === 1
          ? jsonResponse({ error: { code: "BAD_REQUEST", message: "Stock insuficiente." } }, 400)
          : jsonResponse({ data: { id: "sale-2", invoiceNumber: "V-CNF-2", status: "pagada" } }, 201),
    });
    const firstVisit = mountPos();

    await addToCart(HARINA);
    await expectCartCount("1 item");
    await chargeInCashUsd();
    await waitFor(() => expect(backend.salePosts).toHaveLength(1));
    await screen.findAllByText(/stock insuficiente/i);
    firstVisit.unmount();

    mountPos();
    await expectCartCount("1 item");
    await addToCart(AZUCAR);
    await expectCartCount("2 items");
    await chargeInCashUsd();
    await screen.findByText("Venta registrada");

    expect(backend.salePosts[1]?.items).toHaveLength(2);
    expect(backend.salePosts[0]?.clientRequestId).toEqual(expect.any(String));
    expect(backend.salePosts[1]?.clientRequestId).toEqual(expect.any(String));
    expect(backend.salePosts[1]?.clientRequestId).not.toBe(backend.salePosts[0]?.clientRequestId);
  });
});

// Medido con la pantalla de antes de CNF-15b/16b (commit 488c9b1) y este mismo montaje.
const BASELINE_LOAD_REQUESTS = [
  "GET /api/auth/me",
  "GET /api/auth/me",
  "GET /api/cash/movements",
  "GET /api/cash/registers",
  "GET /api/cash/session",
  "GET /api/cash/session",
  "GET /api/categories",
  "GET /api/contacts",
  "GET /api/exchange-rates/current",
  "GET /api/products",
  "GET /api/settings/payment-methods",
];
// El POST y los refrescos de catálogo que ya disparaba una venta registrada, en ese orden.
const BASELINE_CHARGE_REQUESTS = [
  "POST /api/sales",
  "GET /api/categories",
  "GET /api/products",
  "GET /api/contacts",
];

describe("El camino de cobro no cambia", () => {
  it("una venta simple hace exactamente las mismas peticiones que antes de CNF-15/16", async () => {
    const backend = mountBackend();

    mountPos();
    await addToCart(HARINA);
    await expectCartCount("1 item");
    await flush(600);

    const beforeCharge = backend.requests.length;

    await chargeInCashUsd();
    await screen.findByText("Venta registrada");
    await flush(200);

    // Carga del POS: las mismas consultas, sin ninguna nueva por el guardia o el carrito guardado.
    expect([...backend.requests.slice(0, beforeCharge)].sort()).toEqual(BASELINE_LOAD_REQUESTS);
    // Cobro: el POST de la venta y los refrescos que ya disparaba una venta registrada.
    expect(backend.requests.slice(beforeCharge)).toEqual(BASELINE_CHARGE_REQUESTS);
  });
});
