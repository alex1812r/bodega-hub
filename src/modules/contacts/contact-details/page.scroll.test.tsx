/**
 * DET-F2 · el detalle de contacto recuerda el scroll por URL y lo restaura al
 * volver, una sola vez y con la sublista de la pestaña activa ya pintada.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/contacts/c-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

import { ContactDetailsPage } from "./page";

const SAVED_TOP = 742;

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

function page<T>(items: T[]) {
  return { items, limit: 10, skip: 0, total: items.length };
}

/** Enlace de una fila de la sublista: su presencia dice que la tabla ya está pintada. */
function rowLink(path: string) {
  return document.querySelector(`a[href^="${path}"]`);
}

describe("ContactDetailsPage · scroll al volver (DET-F2)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalScrollTo = window.scrollTo;
  /** Cada restauración: a qué posición y qué filas había pintadas en ese instante. */
  let restores: { paymentRow: boolean; productRow: boolean; top: number }[];

  beforeEach(() => {
    restores = [];
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: (_x: number, top: number) => {
        restores.push({
          paymentRow: rowLink("/payments/pay-1") !== null,
          productRow: rowLink("/products/prod-1") !== null,
          top,
        });
      },
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");

      if (url.pathname === "/api/contacts/c-1") {
        return jsonResponse({
          data: {
            address: "",
            email: "",
            id: "c-1",
            isActive: true,
            name: "Distribuidora Polar",
            phone: "",
            taxId: "J-1",
            type: "ambos",
          },
        });
      }

      if (url.pathname === "/api/contacts/c-1/payments") {
        return jsonResponse({
          data: page([
            {
              amountRef: 2,
              amountVes: 1000,
              createdAt: "2026-09-03T15:00:00.000Z",
              direction: "entrada",
              id: "pay-1",
              method: "pago_movil",
              status: "activo",
            },
          ]),
        });
      }

      if (url.pathname === "/api/suppliers/c-1/products") {
        return jsonResponse({
          data: page([
            {
              id: "sp-1",
              isActive: true,
              lastCostRef: 3,
              packUnits: [],
              product: { id: "prod-1", name: "Producto 1", sku: "sku-1" },
              productId: "prod-1",
              supplierId: "c-1",
            },
          ]),
        });
      }

      return jsonResponse({ data: page([]) });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    Object.defineProperty(window, "scrollTo", { configurable: true, value: originalScrollTo });
  });

  function renderPage(search: string) {
    const url = `/contacts/c-1${search}`;

    window.history.replaceState(null, "", url);
    window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify([[url, SAVED_TOP]]));

    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ContactDetailsPage contactId="c-1" />
      </QueryClientProvider>,
    );
  }

  it("?tab=productos: restaura la posición guardada con la tabla de productos ya pintada", async () => {
    renderPage("?tab=productos");

    await waitFor(() => expect(restores).toHaveLength(1));
    expect(restores[0]).toMatchObject({ productRow: true, top: SAVED_TOP });
  });

  it("?tab=pagos: restaura la posición guardada con la tabla de pagos ya pintada", async () => {
    renderPage("?tab=pagos");

    await waitFor(() => expect(restores).toHaveLength(1));
    expect(restores[0]).toMatchObject({ paymentRow: true, top: SAVED_TOP });
  });

  it("cambiar de pestaña dentro del detalle no mueve el scroll aunque esa URL tenga posición guardada", async () => {
    renderPage("?tab=pagos");
    window.sessionStorage.setItem(
      SCROLL_POSITIONS_STORAGE_KEY,
      JSON.stringify([
        ["/contacts/c-1?tab=pagos", SAVED_TOP],
        ["/contacts/c-1?tab=productos", 300],
      ]),
    );

    await waitFor(() => expect(restores).toHaveLength(1));

    fireEvent.click(screen.getByRole("tab", { name: "Productos" }));

    await waitFor(() => expect(rowLink("/products/prod-1")).not.toBeNull());
    expect(window.location.search).toBe("?tab=productos");
    expect(restores).toHaveLength(1);
  });

  it("al salir guarda la posición bajo la URL del detalle con su pestaña", async () => {
    const view = renderPage("?tab=pagos");

    await waitFor(() => expect(restores).toHaveLength(1));
    window.sessionStorage.clear();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 510 });
    fireEvent.scroll(window);
    view.unmount();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });

    expect(JSON.parse(window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY) ?? "[]")).toEqual(
      [["/contacts/c-1?tab=pagos", 510]],
    );
  });
});
