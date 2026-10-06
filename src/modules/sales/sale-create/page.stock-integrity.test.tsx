/**
 * STK-413 · regresión de C3 (clave de idempotencia del POS en memoria + mensaje
 * «Failed to fetch») y C20 (escaneo lento que se cruza con el cobro).
 *
 * Se monta la pantalla REAL (`SaleCreatePage`) con QueryClient y `fetch` simulado
 * por URL; lo observable son los cuerpos de `POST /api/sales` y lo que ve el cajero.
 * STK-509: los `it.failing` de STK-413 pasan a `it`. El BFF simulado conoce ahora
 * `GET /api/sales/by-request/:clave` (la consulta que resuelve un cobro incierto).
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

const BY_REQUEST_PATH = "/api/sales/by-request/";

/** Respuestas de `GET /api/sales/by-request/:clave`. */
function lookupNotFound() {
  return jsonResponse({ error: { code: "NOT_FOUND", message: "Venta no encontrada." } }, 404);
}

function lookupFound(status = "pagada") {
  return jsonResponse({
    data: { id: "sale-stk509", invoiceNumber: "V-STK509-1", items: [], payments: [], status },
  });
}

function networkDown(): Promise<Response> {
  return Promise.reject(new TypeError("Failed to fetch"));
}

/** BFF simulado por URL. Los cobros y las búsquedas por código los decide cada test. */
function mountBackend(handlers: {
  /** Consulta por clave; por defecto el servidor responde 404 (no hay venta). */
  onLookup?: (attempt: number) => Promise<Response>;
  onSalePost: (attempt: number) => Promise<Response>;
  onScan?: (code: string) => Promise<Response>;
}) {
  const lookupRequests: string[] = [];
  const salePosts: SalePostBody[] = [];
  const scanRequests: string[] = [];
  const unknownRequests: string[] = [];

  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const route = `${method} ${url.pathname}`;

    if (method === "GET" && url.pathname.startsWith(BY_REQUEST_PATH)) {
      lookupRequests.push(decodeURIComponent(url.pathname.slice(BY_REQUEST_PATH.length)));
      return handlers.onLookup ? handlers.onLookup(lookupRequests.length) : lookupNotFound();
    }

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

  return { lookupRequests, salePosts, scanRequests, unknownRequests };
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
  // Causa: la clave vivia en `clientRequestIdRef` (memoria del componente). Si la
  // respuesta se pierde tras el commit y el cajero recarga o sale y vuelve, el
  // mismo carrito viajaba con una clave nueva → 2 ventas `pagada` identicas.
  // Evento: `w3-ui` `f03.iv_cut_response_then_reload`; qa/STK-408/verdict.md §H8 C2.
  // STK-509: el escenario necesita que la consulta por clave tampoco responda en el
  // primer intento y diga 404 tras recargar; si dijera que la venta existe, lo sano
  // es NO enviar un segundo POST (test «recargar con la venta ya registrada»).
  it("tras un error de red, recargar y cobrar el mismo carrito reutiliza el mismo clientRequestId", async () => {
    const backend = mountBackend({
      onLookup: async (attempt) => (attempt === 1 ? networkDown() : lookupNotFound()),
      onSalePost: async (attempt) => (attempt === 1 ? networkDown() : saleResponse(attempt)),
    });

    const firstLoad = mountPos();
    fireEvent.click(await prepareCartReadyToCharge());
    await waitFor(() => expect(backend.salePosts).toHaveLength(1));
    await waitFor(() => expect(visibleAlerts()).not.toBe(""));
    firstLoad.unmount();

    // Recarga / salir y volver: estado de React nuevo; el cajero rearma el mismo carrito.
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
    // Antes de reenviar se consulto por esa misma clave.
    expect(backend.lookupRequests).toEqual([first?.clientRequestId, first?.clientRequestId]);
  });

  // Causa: el `catch` de `handleProcessSale` mostraba `error.message` tal cual; ante un
  // `TypeError: Failed to fetch` el cajero no sabia que la venta pudo registrarse y la repetia.
  // Evento: `w3-ui` `f03.ii`; qa/STK-408/verdict.md §H8 C1/C2.
  // STK-509: `/registr/i` tambien aceptaba «No se pudo registrar la venta», que es lo
  // contrario del aviso; ahora se exige el texto de que PUDO registrarse y la accion «Verificar».
  it("ante un error de red el mensaje advierte que la venta pudo haberse registrado", async () => {
    const backend = mountBackend({
      onLookup: networkDown,
      onSalePost: networkDown,
    });

    mountPos();
    fireEvent.click(await prepareCartReadyToCharge());
    await waitFor(() => expect(backend.salePosts).toHaveLength(1));
    await waitFor(() => expect(visibleAlerts()).not.toBe(""));

    expect(visibleAlerts()).toMatch(/pudo haberse registrado/i);
    expect(visibleAlerts()).toMatch(/verifica antes de volver a cobrar/i);
    expect(visibleAlerts()).not.toMatch(/no (se )?(pudo|pudimos) (registrar|procesar)/i);
    expect(visibleAlerts()).not.toMatch(/failed to fetch/i);
    expect(screen.getByRole("button", { name: "Verificar" })).toBeEnabled();
    // Sin reintento a ciegas: un solo POST y una consulta por la clave enviada.
    await flush();
    expect(backend.salePosts).toHaveLength(1);
    expect(backend.lookupRequests).toEqual([backend.salePosts[0]?.clientRequestId]);
    expect(backend.unknownRequests).toEqual([]);
  });

  it("si la respuesta se pierde pero la venta existe por clave, la da por registrada sin reenviar", async () => {
    const backend = mountBackend({
      onLookup: async () => lookupFound(),
      onSalePost: async (attempt) => (attempt === 1 ? networkDown() : saleResponse(attempt)),
    });

    mountPos();
    fireEvent.click(await prepareCartReadyToCharge());

    await screen.findByText("Venta registrada");
    // Los datos son los del servidor, no los del carrito.
    expect(screen.getByText("V-STK509-1")).toBeInTheDocument();
    expect(backend.salePosts).toHaveLength(1);

    // La venta siguiente es otro carrito: clave nueva.
    fireEvent.click(screen.getByRole("button", { name: "Nueva venta" }));
    fireEvent.click(await prepareCartReadyToCharge());
    await waitFor(() => expect(backend.salePosts).toHaveLength(2));
    expect(backend.salePosts[1]?.clientRequestId).toEqual(expect.any(String));
    expect(backend.salePosts[1]?.clientRequestId).not.toBe(backend.salePosts[0]?.clientRequestId);
    expect(backend.unknownRequests).toEqual([]);
  });

  it("una venta recuperada en pendiente_pago no se anuncia como cobrada", async () => {
    mountBackend({
      onLookup: async () => lookupFound("pendiente_pago"),
      onSalePost: networkDown,
    });

    mountPos();
    fireEvent.click(await prepareCartReadyToCharge());

    await screen.findByText("Venta registrada sin cobro");
    expect(screen.queryByText("Venta registrada")).toBeNull();
    expect(screen.getByText(/pendiente de pago/i)).toBeInTheDocument();
  });

  it("si el servidor confirma que no hay venta (404), permite reintentar con la misma clave", async () => {
    const backend = mountBackend({
      onSalePost: async (attempt) => (attempt === 1 ? networkDown() : saleResponse(attempt)),
    });

    mountPos();
    const chargeButton = await prepareCartReadyToCharge();
    fireEvent.click(chargeButton);
    await waitFor(() => expect(visibleAlerts()).not.toBe(""));

    expect(visibleAlerts()).not.toMatch(/pudo haberse registrado/i);
    expect(screen.queryByRole("button", { name: "Verificar" })).toBeNull();
    // No hubo reintento automatico.
    expect(backend.salePosts).toHaveLength(1);

    await waitFor(() => expect(chargeButton).toBeEnabled());
    fireEvent.click(chargeButton);
    await screen.findByText("Venta registrada");
    expect(backend.salePosts).toHaveLength(2);
    expect(backend.salePosts[1]?.clientRequestId).toBe(backend.salePosts[0]?.clientRequestId);
    expect(backend.unknownRequests).toEqual([]);
  });

  it("recargar con la venta ya registrada: avisa con la factura y no envia otro POST", async () => {
    const backend = mountBackend({
      onLookup: async (attempt) => (attempt === 1 ? networkDown() : lookupFound()),
      onSalePost: async (attempt) => (attempt === 1 ? networkDown() : saleResponse(attempt)),
    });

    const firstLoad = mountPos();
    fireEvent.click(await prepareCartReadyToCharge());
    await waitFor(() => expect(visibleAlerts()).toMatch(/pudo haberse registrado/i));
    firstLoad.unmount();

    mountPos();
    // Al volver, el POS recuerda que hay un cobro sin confirmar.
    const chargeButton = await prepareCartReadyToCharge();
    expect(visibleAlerts()).toMatch(/pudo haberse registrado/i);
    fireEvent.click(chargeButton);

    await waitFor(() => expect(visibleAlerts()).toMatch(/V-STK509-1/));
    await flush();
    expect(screen.queryByText("Venta registrada")).toBeNull();
    expect(backend.salePosts).toHaveLength(1);
    expect(backend.unknownRequests).toEqual([]);
  });

  it("«Limpiar orden» con un cobro de resultado desconocido primero lo resuelve", async () => {
    let lookupMode: "down" | "found" = "down";
    const backend = mountBackend({
      onLookup: async () => (lookupMode === "down" ? networkDown() : lookupFound()),
      onSalePost: networkDown,
    });

    mountPos();
    fireEvent.click(await prepareCartReadyToCharge());
    await waitFor(() => expect(visibleAlerts()).toMatch(/pudo haberse registrado/i));

    // Sin poder verificar no se limpia: el carrito sigue ahi y se avisa.
    const clearButton = screen.getByRole("button", { name: "Limpiar orden" });
    await waitFor(() => expect(clearButton).toBeEnabled());
    fireEvent.click(clearButton);
    await waitFor(() => expect(backend.lookupRequests).toHaveLength(2));
    await flush();
    expect(screen.getByRole("button", { name: "Procesar venta" })).toBeInTheDocument();
    expect(visibleAlerts()).toMatch(/pudo haberse registrado/i);
    expect(screen.getByRole("button", { name: "Limpiar orden" })).toBeEnabled();

    // Cuando la consulta responde que la venta existe, se cierra como registrada.
    lookupMode = "found";
    fireEvent.click(screen.getByRole("button", { name: "Limpiar orden" }));
    await screen.findByText("Venta registrada");
    expect(backend.salePosts).toHaveLength(1);
    expect(backend.unknownRequests).toEqual([]);
  });

  // C4 visto desde la UI: la clave ya tiene una venta con otro contenido.
  it("un 409 por clave reutilizada se muestra como error, nunca como «Venta registrada»", async () => {
    const backend = mountBackend({
      onLookup: async () => lookupFound(),
      onSalePost: async () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "La clave de idempotencia ya se uso con otra venta." } },
          409,
        ),
    });

    mountPos();
    fireEvent.click(await prepareCartReadyToCharge());
    await waitFor(() => expect(visibleAlerts()).toMatch(/clave de idempotencia ya se uso/i));
    await flush();

    expect(screen.queryByText("Venta registrada")).toBeNull();
    expect(screen.getByRole("button", { name: "Procesar venta" })).toBeInTheDocument();
    expect(backend.salePosts).toHaveLength(1);
    expect(backend.unknownRequests).toEqual([]);
  });

  it("un 4xx definitivo no consulta por clave; la clave solo cambia si cambia el carrito", async () => {
    const backend = mountBackend({
      onSalePost: async () =>
        jsonResponse({ error: { code: "BAD_REQUEST", message: "Stock insuficiente." } }, 400),
    });

    mountPos();
    const chargeButton = await prepareCartReadyToCharge();
    fireEvent.click(chargeButton);
    await waitFor(() => expect(visibleAlerts()).toMatch(/stock insuficiente/i));
    await waitFor(() => expect(chargeButton).toBeEnabled());

    // Mismo carrito → misma clave.
    fireEvent.click(chargeButton);
    await waitFor(() => expect(backend.salePosts).toHaveLength(2));
    await waitFor(() => expect(chargeButton).toBeEnabled());

    // Carrito distinto tras el rechazo → clave nueva.
    await addCatalogProductToCart();
    fireEvent.click(chargeButton);
    await waitFor(() => expect(backend.salePosts).toHaveLength(3));

    const [first, second, third] = backend.salePosts;
    expect(second?.clientRequestId).toBe(first?.clientRequestId);
    expect(third?.items).toEqual([{ productId: CATALOG_PRODUCT.id, quantity: 2 }]);
    expect(third?.clientRequestId).not.toBe(first?.clientRequestId);
    expect(backend.lookupRequests).toEqual([]);
    expect(backend.unknownRequests).toEqual([]);
  });
});

describe("C20 · escaneo lento cruzado con el cobro", () => {
  // Causa: «Procesar venta» solo se deshabilita con `createSale.isPending`; una
  // búsqueda por código en vuelo (`barcodeScan.isLookingUp`) no lo bloquea, así que
  // el cobro sale SIN la línea que el cajero acaba de escanear.
  // Evento: qa/STK-408/verdict.md C6 (one-shots 830b/830d).
  // Código: src/modules/sales/sale-create/page.tsx:155, :197-209 y :485;
  // src/modules/sales/sale-create/components/PosCartPanel.tsx:272.
  it(
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
  it(
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
