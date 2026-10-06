/**
 * STK-413 · regresión de C3 (clave de idempotencia del POS en memoria + mensaje
 * «Failed to fetch») y C20 (escaneo lento que se cruza con el cobro).
 *
 * Se monta la pantalla REAL (`SaleCreatePage`) con QueryClient y `fetch` simulado
 * por URL; lo observable son los cuerpos de `POST /api/sales` y lo que ve el cajero.
 * Los `it.failing` describen el comportamiento SANO y hoy fallan: al corregir el
 * POS (fase 5) hay que convertirlos en `it`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";

import { SaleCreatePage } from "./page";

type SalePostBody = {
  clientRequestId?: string;
  customerId?: string;
  items?: Array<{ productId: string; quantity: number }>;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

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

const CUSTOMER = {
  id: "cont-stk413",
  isPosDefault: true,
  name: "Cliente mostrador STK413",
  type: "cliente",
};

const CATALOG_PRODUCT = {
  barcode: "7590000000011",
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 20,
  id: "prod-harina",
  isActive: true,
  minStock: 5,
  name: "Harina STK413",
  salePriceRef: 2,
  sku: "stk413-harina",
};

// Solo existe detrás del lector: no está en el catálogo, así que si su nombre
// aparece en pantalla es porque entró al carrito.
const SCANNED_PRODUCT = {
  barcode: "7590000000028",
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 20,
  id: "prod-azucar",
  isActive: true,
  minStock: 5,
  name: "Azucar escaneada STK413",
  salePriceRef: 3,
  sku: "stk413-azucar",
};

const REGISTER = { assignedUserId: "user-stk413", id: "reg-1", isActive: true, name: "Caja 1" };

function saleResponse(sequence: number) {
  return jsonResponse(
    { data: { id: `sale-stk413-${sequence}`, invoiceNumber: `V-STK413-${sequence}`, status: "pagada" } },
    201,
  );
}

/** BFF simulado por URL. Los cobros y las búsquedas por código los decide cada test. */
function mountBackend(handlers: {
  onSalePost: (attempt: number) => Promise<Response>;
  onScan?: (code: string) => Promise<Response>;
}) {
  const salePosts: SalePostBody[] = [];
  const scanRequests: string[] = [];
  const unknownRequests: string[] = [];

  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const route = `${method} ${url.pathname}`;

    switch (route) {
      case "POST /api/sales":
        salePosts.push(JSON.parse(String(init?.body ?? "{}")) as SalePostBody);
        return handlers.onSalePost(salePosts.length);
      case "GET /api/products": {
        const barcode = url.searchParams.get("barcode");
        if (barcode) {
          scanRequests.push(barcode);
          return handlers.onScan ? handlers.onScan(barcode) : jsonResponse({ data: paginated([]) });
        }
        return jsonResponse({ data: paginated([CATALOG_PRODUCT]) });
      }
      case "GET /api/cash/session":
        return jsonResponse({
          data: {
            id: "session-1",
            liveTotals: { cashRef: 100, cashVes: 50000 },
            openedAt: new Date().toISOString(),
            openingRef: 100,
            openingVes: 50000,
            register: REGISTER,
            registerId: REGISTER.id,
            status: "open",
          },
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
            user: { email: "vendedor@example.com", id: "user-stk413", name: "Vendedor" },
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
        unknownRequests.push(route);
        return jsonResponse({ error: { code: "NOT_FOUND", message: route } }, 404);
    }
  });

  global.fetch = fetchMock as typeof fetch;

  return { salePosts, scanRequests, unknownRequests };
}

/** Monta el POS como una carga de página nueva (QueryClient y estado de React nuevos). */
function mountPos() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SaleCreatePage />
    </QueryClientProvider>,
  );
}

async function flush(ms = 50) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function addCatalogProductToCart() {
  const labels = await screen.findAllByText(CATALOG_PRODUCT.name);
  const card = labels[0]?.closest("button");
  if (!card) {
    throw new Error("montaje: no se encontró la tarjeta del producto del catálogo");
  }
  fireEvent.click(card);
}

/** Carrito con una línea, cliente por defecto y efectivo USD: listo para cobrar. */
async function prepareCartReadyToCharge() {
  await addCatalogProductToCart();
  // El cliente por defecto llega por `/api/contacts`; sin él el cobro se corta antes.
  await screen.findAllByText(CUSTOMER.name);
  fireEvent.click(screen.getByRole("button", { name: paymentMethodLabels.efectivo_usd }));

  const chargeButton = screen.getByRole("button", { name: "Procesar venta" });
  await waitFor(() => expect(chargeButton).toBeEnabled());

  return chargeButton;
}

function scanBarcode(code: string) {
  const input = screen.getByRole("searchbox", { name: "Buscar productos" });
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function visibleAlerts() {
  return screen
    .queryAllByRole("alert")
    .map((node) => node.textContent ?? "")
    .join(" | ");
}

const originalFetch = global.fetch;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
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

describe("C3 · respuesta perdida al cobrar en el POS", () => {
  // Causa: la clave vive en `clientRequestIdRef` (memoria del componente). Si la
  // respuesta se pierde tras el commit y el cajero recarga o sale y vuelve, el
  // mismo carrito viaja con una clave nueva → 2 ventas `pagada` idénticas.
  // Evento: `w3-ui` `f03.iv_cut_response_then_reload`; qa/STK-408/verdict.md §H8 C2.
  // Código: src/modules/sales/sale-create/page.tsx:77, :227-233 y :394-397.
  it.failing(
    "tras un error de red, recargar y cobrar el mismo carrito reutiliza el mismo clientRequestId",
    async () => {
      const backend = mountBackend({
        onSalePost: async (attempt) => {
          if (attempt === 1) {
            // El servidor ya confirmó la venta; lo que se pierde es la respuesta.
            throw new TypeError("Failed to fetch");
          }
          return saleResponse(attempt);
        },
      });

      const firstLoad = mountPos();
      fireEvent.click(await prepareCartReadyToCharge());
      await waitFor(() => expect(backend.salePosts).toHaveLength(1));
      await waitFor(() => expect(visibleAlerts()).not.toBe(""));
      firstLoad.unmount();

      // Recarga: estado de React nuevo; el cajero rearma el mismo carrito.
      mountPos();
      fireEvent.click(await prepareCartReadyToCharge());
      await waitFor(() => expect(backend.salePosts).toHaveLength(2));

      const [first, second] = backend.salePosts;
      // Montaje: los dos intentos son el mismo carrito y ambos llevan clave.
      expect(backend.unknownRequests).toEqual([]);
      expect(second?.items).toEqual(first?.items);
      expect(second?.customerId).toBe(first?.customerId);
      expect(first?.clientRequestId).toEqual(expect.any(String));
      // Causa:
      expect(second?.clientRequestId).toBe(first?.clientRequestId);
    },
  );

  // Causa: el `catch` de `handleProcessSale` muestra `error.message` tal cual; ante un
  // `TypeError: Failed to fetch` el cajero no sabe que la venta pudo registrarse y la repite.
  // Evento: `w3-ui` `f03.ii`; qa/STK-408/verdict.md §H8 C1/C2.
  // Código: src/modules/sales/sale-create/page.tsx:424-426.
  it.failing(
    "ante un error de red el mensaje advierte que la venta pudo haberse registrado",
    async () => {
      const backend = mountBackend({
        onSalePost: async () => {
          throw new TypeError("Failed to fetch");
        },
      });

      mountPos();
      fireEvent.click(await prepareCartReadyToCharge());
      await waitFor(() => expect(backend.salePosts).toHaveLength(1));
      await waitFor(() => expect(visibleAlerts()).not.toBe(""));

      // No basta con el texto del navegador: debe hablar de que la venta pudo
      // quedar registrada (cualquier redacción con «registr…»).
      expect(visibleAlerts()).toMatch(/registr/i);
    },
  );
});

describe("C20 · escaneo lento cruzado con el cobro", () => {
  // Causa: «Procesar venta» solo se deshabilita con `createSale.isPending`; una
  // búsqueda por código en vuelo (`barcodeScan.isLookingUp`) no lo bloquea, así que
  // el cobro sale SIN la línea que el cajero acaba de escanear.
  // Evento: qa/STK-408/verdict.md C6 (one-shots 830b/830d).
  // Código: src/modules/sales/sale-create/page.tsx:155, :197-209 y :485;
  // src/modules/sales/sale-create/components/PosCartPanel.tsx:272.
  it.failing(
    "no envía el cobro mientras la búsqueda del código escaneado sigue en vuelo",
    async () => {
      const lookup = deferred<Response>();
      const backend = mountBackend({
        onSalePost: async (attempt) => saleResponse(attempt),
        onScan: () => lookup.promise,
      });

      mountPos();
      const chargeButton = await prepareCartReadyToCharge();
      scanBarcode(SCANNED_PRODUCT.barcode);
      await waitFor(() => expect(backend.scanRequests).toEqual([SCANNED_PRODUCT.barcode]));

      // El cajero pulsa «Procesar venta» antes de que responda la búsqueda. Sano si el
      // botón está bloqueado o si el cobro espera a la línea: en ambos casos no hay POST.
      fireEvent.click(chargeButton);
      await flush();

      expect(backend.unknownRequests).toEqual([]);
      expect(backend.salePosts).toEqual([]);

      lookup.resolve(jsonResponse({ data: paginated([SCANNED_PRODUCT]) }));
      await flush();
    },
  );

  // Causa: `onResolved` del escaneo llama a `cart.addProduct` sin comprobar que el
  // carrito siga siendo el mismo: si la venta se cerró entre medias, el producto
  // aparece en el carrito del cliente siguiente.
  // Evento: qa/STK-408/verdict.md C6 (one-shots 830b/830d).
  // Código: src/modules/sales/sale-create/page.tsx:197-209 y :219-225.
  it.failing(
    "una respuesta de escaneo que llega con la venta ya cerrada no entra al carrito siguiente",
    async () => {
      const lookup = deferred<Response>();
      const sale = deferred<Response>();
      const backend = mountBackend({
        onSalePost: () => sale.promise,
        onScan: () => lookup.promise,
      });

      mountPos();
      fireEvent.click(await prepareCartReadyToCharge());
      await waitFor(() => expect(backend.salePosts).toHaveLength(1));

      // Con el cobro viajando, el cajero escanea otro código (búsqueda lenta). Un
      // arreglo puede impedir este escaneo; entonces no habrá petición y también es sano.
      scanBarcode(SCANNED_PRODUCT.barcode);
      await flush();

      // La venta se confirma y se cierra...
      await act(async () => {
        sale.resolve(saleResponse(1));
      });
      await screen.findByText("Venta registrada");

      // ...y solo entonces llega la respuesta del escaneo.
      await act(async () => {
        lookup.resolve(jsonResponse({ data: paginated([SCANNED_PRODUCT]) }));
      });
      await flush();

      fireEvent.click(screen.getByRole("button", { name: "Nueva venta" }));
      await screen.findByRole("searchbox", { name: "Buscar productos" });
      await flush();

      // Montaje: la venta cerrada llevaba solo la línea del catálogo.
      expect(backend.unknownRequests).toEqual([]);
      expect(backend.salePosts[0]?.items).toEqual([{ productId: CATALOG_PRODUCT.id, quantity: 1 }]);
      // Causa: el carrito de la venta siguiente debe empezar vacío.
      expect(screen.queryAllByText(SCANNED_PRODUCT.name)).toHaveLength(0);
    },
  );
});
