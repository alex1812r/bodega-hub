/**
 * POS-H4 · D29: el slider de categorías del POS recibe TODAS las categorías
 * activas. `GET /api/categories` entrega 10 por página si no se pide `limit`
 * (y como mucho 100): el POS las pide paginando hasta agotarlas.
 *
 * Se monta la pantalla REAL (`SaleCreatePage`) con `fetch` simulado por URL, como
 * en `page.cart-draft.test.tsx`; el simulacro pagina igual que la API.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { ToastProvider } from "@/shared/components/Toast";
import { DEFAULT_ENABLED_PAYMENT_METHODS } from "@/shared/payments/paymentMethods";

import { SaleCreatePage } from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

type Category = { id: string; isActive: boolean; name: string; taxRate: number };

const REGISTER = { assignedUserId: "user-1", id: "reg-1", isActive: true, name: "Caja 1" };

function buildCategories(count: number): Category[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cat-${index + 1}`,
    isActive: true,
    name: `Categoría H4 ${String(index + 1).padStart(3, "0")}`,
    taxRate: 0,
  }));
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

/** Pagina como `parsePagination` de la API: 10 por defecto, tope `MAX_PAGE_LIMIT`. */
function paginate<T>(items: T[], searchParams: URLSearchParams) {
  const requestedLimit = Number.parseInt(searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT), 10);
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, requestedLimit));
  const skip = Math.max(0, Number.parseInt(searchParams.get("skip") ?? "0", 10));

  return { items: items.slice(skip, skip + limit), limit, skip, total: items.length };
}

function mountBackend(categories: Category[]) {
  const requests: string[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const route = `${init?.method ?? "GET"} ${url.pathname}`;

    requests.push(route);

    switch (route) {
      case "GET /api/categories":
        return jsonResponse({ data: paginate(categories, url.searchParams) });
      case "GET /api/products":
        return jsonResponse({ data: paginate([], url.searchParams) });
      case "GET /api/contacts":
        return jsonResponse({
          data: paginate(
            [{ id: "cont-1", isPosDefault: true, name: "Cliente mostrador H4", type: "cliente" }],
            url.searchParams,
          ),
        });
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
            user: { email: "vendedor@example.com", id: "user-1", name: "Vendedor" },
          },
        });
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

  return { requests };
}

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

function categoryRequests(requests: string[]) {
  return requests.filter((route) => route === "GET /api/categories").length;
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

describe("POS-H4 · D29: el POS muestra todas las categorías", () => {
  it("con 25 categorías en la API, el slider muestra las 25 con una sola petición", async () => {
    const categories = buildCategories(25);
    const { requests } = mountBackend(categories);

    mountPos();

    await screen.findByRole("button", { name: categories[24].name });

    for (const category of categories) {
      expect(screen.getByRole("button", { name: category.name })).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "Todos" })).toBeInTheDocument();
    expect(categoryRequests(requests)).toBe(1);
  });

  it("con más categorías que el tope de página de la API, pagina hasta agotarlas", async () => {
    const categories = buildCategories(MAX_PAGE_LIMIT + 5);
    const { requests } = mountBackend(categories);

    mountPos();

    await screen.findByRole("button", { name: categories[MAX_PAGE_LIMIT + 4].name });
    await waitFor(() => expect(categoryRequests(requests)).toBe(2));

    expect(screen.getByRole("button", { name: categories[0].name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: categories[MAX_PAGE_LIMIT - 1].name })).toBeInTheDocument();
  });
});
