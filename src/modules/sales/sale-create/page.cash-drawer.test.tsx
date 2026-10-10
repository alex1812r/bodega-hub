/**
 * POS-F6 · el POS validaba el vuelto en efectivo contra el saldo del cajón de
 * cuando cargó la página. Tras vender en efectivo sin recargar, un cobro bancario
 * por más del total no dejaba dar el vuelto en efectivo («disponible Bs.S 0,00»).
 *
 * Se monta la pantalla REAL (`SaleCreatePage`) con QueryClient y `fetch` simulado
 * por URL: la sesión de caja devuelve el saldo que el servidor tendría en cada momento.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";

import { SaleCreatePage } from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

type SalePostBody = {
  payments?: Array<{
    amount: number;
    change?: { amount: number; method: string };
    method: string;
  }>;
};

const RATE_VES = 500;
const PRODUCT = {
  barcode: "7590000000611",
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 20,
  id: "prod-posf6",
  isActive: true,
  minStock: 5,
  name: "Harina POSF6",
  salePriceRef: 2,
  sku: "posf6-harina",
};
/** Total de una unidad en Bs. */
const SALE_TOTAL_VES = PRODUCT.salePriceRef * RATE_VES;
const CUSTOMER = { id: "cont-posf6", isPosDefault: true, name: "Cliente mostrador POSF6", type: "cliente" };
const REGISTER = { assignedUserId: "user-posf6", id: "reg-1", isActive: true, name: "Caja 1" };

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

/** BFF simulado: el cajón abre en 0 y sube con cada venta cobrada en efectivo VES. */
function mountBackend() {
  const requests: string[] = [];
  const salePosts: SalePostBody[] = [];
  let drawerVes = 0;

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const route = `${init?.method ?? "GET"} ${url.pathname}`;

    requests.push(route);

    switch (route) {
      case "POST /api/sales": {
        const body = JSON.parse(String(init?.body ?? "{}")) as SalePostBody;

        salePosts.push(body);
        for (const payment of body.payments ?? []) {
          if (payment.method === "efectivo_ves") {
            drawerVes += payment.amount;
          }
        }

        return jsonResponse(
          {
            data: {
              id: `sale-posf6-${salePosts.length}`,
              invoiceNumber: `V-POSF6-${salePosts.length}`,
              status: "pagada",
            },
          },
          201,
        );
      }
      case "GET /api/products":
        return jsonResponse({ data: paginated([PRODUCT]) });
      case "GET /api/cash/session":
        return jsonResponse({
          data: {
            id: "session-1",
            liveTotals: { cashRef: 0, cashVes: drawerVes },
            openedAt: new Date().toISOString(),
            openingRef: 0,
            openingVes: 0,
            register: REGISTER,
            registerId: REGISTER.id,
            status: "open",
          },
        });
      case "GET /api/cash/registers":
        return jsonResponse({ data: [REGISTER] });
      case "GET /api/cash/movements":
        return jsonResponse({ data: { items: [], theoretical: { ref: 0, ves: drawerVes } } });
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
            user: { email: "vendedor@example.com", id: REGISTER.assignedUserId, name: "Vendedor" },
          },
        });
      case "GET /api/contacts":
        return jsonResponse({ data: paginated([CUSTOMER]) });
      case "GET /api/categories":
        return jsonResponse({ data: paginated([]) });
      case "GET /api/exchange-rates/current":
        return jsonResponse({
          data: { createdAt: new Date().toISOString(), id: "rate-1", rateVes: RATE_VES, source: "manual" },
        });
      case "GET /api/settings/payment-methods":
        return jsonResponse({ data: { enabledPaymentMethods: DEFAULT_ENABLED_PAYMENT_METHODS } });
      default:
        return jsonResponse({ error: { code: "NOT_FOUND", message: route } }, 404);
    }
  }) as typeof fetch;

  return { requests, salePosts };
}

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

async function addProductToCart(user: ReturnType<typeof userEvent.setup>) {
  const card = (await screen.findAllByText(PRODUCT.name))[0]?.closest("button");

  if (!card) {
    throw new Error("montaje: no se encontró la tarjeta del producto del catálogo");
  }

  await user.click(card);
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

describe("POS-F6 · el efectivo disponible para vuelto sigue al cajón tras cada venta", () => {
  it("tras vender en efectivo sin recargar, un cobro por punto de venta da el vuelto en efectivo", async () => {
    const user = userEvent.setup();
    const backend = mountBackend();

    mountPos();

    // Venta 1: efectivo VES exacto con el cajón en 0.
    await addProductToCart(user);
    await screen.findAllByText(CUSTOMER.name);
    await user.click(screen.getByRole("button", { name: paymentMethodLabels.efectivo_ves }));
    await user.click(screen.getByRole("button", { name: "Procesar venta" }));
    await screen.findByText("Venta registrada");

    expect(backend.salePosts).toHaveLength(1);

    // Venta 2, sin recargar: punto de venta por más del total.
    await user.click(screen.getByRole("button", { name: "Nueva venta" }));
    await addProductToCart(user);
    await user.click(screen.getByRole("button", { name: "Cobrar con billetes y vuelto" }));

    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Método de pago"), "punto_venta");

    const amount = within(dialog).getByLabelText("Monto");

    await user.clear(amount);
    await user.type(amount, String(SALE_TOTAL_VES + 500));

    // Con Bs. 1.000 reales en el cajón, el vuelto de Bs. 500 nace en efectivo.
    const changeGroup = within(dialog).getByRole("group", { name: "Vuelto en" });

    await waitFor(() =>
      expect(
        within(changeGroup).getByRole("button", { name: paymentMethodLabels.efectivo_ves }),
      ).toHaveAttribute("aria-pressed", "true"),
    );

    // Primer «Cobrar»: pide la referencia; el segundo confirma el cobro.
    await user.click(within(dialog).getByRole("button", { name: "Cobrar" }));
    await user.type(within(dialog).getByLabelText("Referencia"), "445566");
    await user.click(within(dialog).getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/No hay suficiente efectivo/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Procesar venta" }));
    await waitFor(() => expect(backend.salePosts).toHaveLength(2));

    expect(screen.queryByText(/No hay suficiente efectivo/)).not.toBeInTheDocument();
    expect(backend.salePosts[1]?.payments).toEqual([
      expect.objectContaining({
        amount: SALE_TOTAL_VES + 500,
        change: { amount: 500, method: "efectivo_ves" },
        method: "punto_venta",
      }),
    ]);

    // Coste: una sola petición del cajón por venta, DESPUÉS de su cobro (en segundo plano).
    const firstPost = backend.requests.indexOf("POST /api/sales");
    const secondPost = backend.requests.lastIndexOf("POST /api/sales");

    expect(
      backend.requests
        .slice(firstPost + 1, secondPost)
        .filter((route) => route === "GET /api/cash/session"),
    ).toHaveLength(1);
  });
});
