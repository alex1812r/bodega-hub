/**
 * DET-04 · detalle de contacto: pestañas en `?tab=`, resumen en la cabecera,
 * sublistas paginadas en servidor con su página en la URL (D24), "Volver"
 * encadenado y enlaces salientes con `returnTo`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockAuth: { permissions: string[]; role: string } = { permissions: [], role: "admin" };

jest.mock("next/navigation", () => ({
  usePathname: () => "/contacts/c-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockAuth.permissions.includes(permission),
    isLoading: false,
    role: mockAuth.role,
  }),
}));

import { ContactDetailsPage } from "./page";

const ADMIN_PERMISSIONS = [
  "contacts.view",
  "contacts.manage",
  "payments.manage",
  "payments.view",
  "products.view",
  "purchases.view",
  "sales.create",
  "sales.view",
];

const LIST_URL = "/contacts?search=maria&page=2";
const RETURN_TO = `returnTo=${encodeURIComponent(LIST_URL)}`;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

/** Como el BFF: entrega solo la página pedida, nunca todas las filas. */
function pageOf<T>(total: number, url: URL, build: (index: number) => T) {
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const skip = Number(url.searchParams.get("skip") ?? 0);
  const count = Math.max(0, Math.min(limit, total - skip));

  return {
    items: Array.from({ length: count }, (_, offset) => build(skip + offset)),
    limit,
    skip,
    total,
  };
}

describe("ContactDetailsPage · pestañas, resumen y paginación (DET-04)", () => {
  const originalMatchMedia = window.matchMedia;
  let requests: string[];
  let contactType: "ambos" | "cliente" | "proveedor";
  let totals: { activity: number; payments: number; products: number; purchases: number; sales: number };
  /** Sublistas (`sales`, `payments`…) a las que el servidor responde 403. */
  let forbidden: string[];
  /** Sublistas a las que el servidor responde 500. */
  let failing: string[];

  beforeEach(() => {
    mockAuth.permissions = ADMIN_PERMISSIONS;
    mockAuth.role = "admin";
    requests = [];
    contactType = "ambos";
    totals = { activity: 25, payments: 25, products: 25, purchases: 12, sales: 25 };
    forbidden = [];
    failing = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const sublist = /^\/api\/contacts\/c-1\/(\w+)$/.exec(url.pathname)?.[1];

      requests.push(`${url.pathname}${url.search}`);

      if (url.pathname === "/api/contacts/c-1") {
        return jsonResponse({
          data: {
            address: "",
            email: "",
            id: "c-1",
            isActive: true,
            name: "María Pérez",
            phone: "",
            taxId: "V-1",
            type: contactType,
          },
        });
      }

      if (sublist && forbidden.includes(sublist)) {
        return jsonResponse({ error: { code: "FORBIDDEN", message: "No autorizado" } }, 403);
      }

      if (sublist && failing.includes(sublist)) {
        return jsonResponse({ error: { code: "INTERNAL", message: "Se cayó el servidor" } }, 500);
      }

      if (sublist === "sales") {
        return jsonResponse({
          data: pageOf(totals.sales, url, (index) => ({
            createdAt: "2026-09-01T15:00:00.000Z",
            id: `sale-${index + 1}`,
            invoiceNumber: `F-${String(index + 1).padStart(4, "0")}`,
            status: "pagada",
            totalRef: 10,
          })),
        });
      }

      if (sublist === "purchases") {
        return jsonResponse({
          data: pageOf(totals.purchases, url, (index) => ({
            createdAt: "2026-09-02T15:00:00.000Z",
            id: `purchase-${index + 1}`,
            purchaseNumber: `C-${String(index + 1).padStart(4, "0")}`,
            status: "recibido",
            totalRef: 20,
          })),
        });
      }

      if (sublist === "payments") {
        return jsonResponse({
          data: pageOf(totals.payments, url, (index) => ({
            amountRef: 2,
            amountVes: 1000 + index + 1,
            createdAt: "2026-09-03T15:00:00.000Z",
            direction: "entrada",
            id: `pay-${index + 1}`,
            method: "pago_movil",
            // pay-1 abona una venta, pay-2 una compra y pay-3 ningún documento.
            ...(index % 3 === 0
              ? { saleId: `sale-doc-${index + 1}` }
              : index % 3 === 1
                ? { purchaseId: `purchase-doc-${index + 1}` }
                : {}),
            status: "activo",
          })),
        });
      }

      if (sublist === "activity") {
        return jsonResponse({
          data: pageOf(totals.activity, url, (index) => ({
            amountVes: 500,
            createdAt: "2026-09-04T15:00:00.000Z",
            id: `sale-a${String(index + 1).padStart(3, "0")}`,
            type: "sale",
          })),
        });
      }

      if (url.pathname === "/api/payments/open-documents") {
        const isPurchase = url.searchParams.get("type") === "purchase";

        return jsonResponse({
          data: {
            items: [],
            limit: 100,
            skip: 0,
            total: 0,
            totals: {
              count: 1,
              pendingRef: isPurchase ? 30 : 15,
              pendingVes: isPurchase ? 15000 : 7500,
              truncated: false,
            },
          },
        });
      }

      if (url.pathname === "/api/suppliers/c-1/products") {
        return jsonResponse({
          data: pageOf(totals.products, url, (index) => ({
            id: `sp-${index + 1}`,
            isActive: true,
            lastCostRef: 3,
            packUnits: [],
            product: { id: `prod-${index + 1}`, name: `Producto ${index + 1}`, sku: `sku-${index + 1}` },
            productId: `prod-${index + 1}`,
            supplierId: "c-1",
          })),
        });
      }

      return jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage(search = "") {
    window.history.replaceState(null, "", `/contacts/c-1${search}`);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ContactDetailsPage contactId="c-1" />
      </QueryClientProvider>,
    );
  }

  const findTab = (name: string) => screen.findByRole("tab", { name });

  /** Peticiones de una sublista con el tamaño de pestaña (10): no las del resumen (100). */
  function tabRequests(sublist: string) {
    return requests.filter(
      (request) =>
        request.startsWith(`/api/contacts/c-1/${sublist}?`) && request.includes("limit=10&"),
    );
  }

  function linksTo(path: string) {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((link) => {
      const href = link.getAttribute("href") ?? "";

      return href === path || href.startsWith(`${path}?`);
    });
  }

  async function findLinkTo(path: string) {
    await waitFor(() => expect(linksTo(path).length).toBeGreaterThan(0));

    return linksTo(path)[0];
  }

  /** `returnTo` del enlace como ruta + parámetros ordenados: el orden en la query no importa. */
  function returnToOf(link: HTMLAnchorElement) {
    const returnTo = new URL(link.getAttribute("href") ?? "", "http://localhost").searchParams.get(
      "returnTo",
    );

    return normalizeUrl(returnTo ?? "");
  }

  function normalizeUrl(value: string) {
    const url = new URL(value, "http://localhost");

    return { params: [...url.searchParams.entries()].sort(), path: url.pathname };
  }

  function clickNextPage() {
    fireEvent.click(screen.getAllByRole("button", { name: "Siguiente" })[0]);
  }

  /** Tarjeta del resumen de la cabecera, por su etiqueta. */
  function metricCard(label: string) {
    return screen.getByText(label).parentElement?.parentElement as HTMLElement;
  }

  describe("pestañas en la URL", () => {
    it("abre en Actividad con todas las pestañas, Saldos incluida", async () => {
      renderPage();

      expect(await findTab("Actividad reciente")).toHaveAttribute("aria-selected", "true");
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Actividad reciente",
        "Ventas",
        "Compras",
        "Pagos",
        "Saldos",
        "Productos",
      ]);
      expect(window.location.search).toBe("");
    });

    it("?tab=pagos abre Pagos y un tab que no existe cae a la inicial", async () => {
      renderPage("?tab=pagos");

      expect(await findTab("Pagos")).toHaveAttribute("aria-selected", "true");
      expect(await findLinkTo("/payments/pay-1")).toBeInTheDocument();
    });

    it("?tab=inventado cae a Actividad sin romper", async () => {
      renderPage("?tab=inventado");

      expect(await findTab("Actividad reciente")).toHaveAttribute("aria-selected", "true");
      expect(await findLinkTo("/sales/sale-a001")).toBeInTheDocument();
    });

    it("?tab=saldos monta la pestaña Saldos de Pagos", async () => {
      renderPage("?tab=saldos");

      expect(await findTab("Saldos")).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByRole("region", { name: "Por cobrar" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Por pagar" })).toBeInTheDocument();
    });

    it("cambiar de pestaña escribe ?tab= y conserva returnTo", async () => {
      renderPage(`?${RETURN_TO}`);

      fireEvent.click(await findTab("Ventas"));

      expect(screen.getByRole("tab", { name: "Ventas" })).toHaveAttribute("aria-selected", "true");
      expect(window.location.search).toBe(`?${RETURN_TO}&tab=ventas`);

      fireEvent.click(screen.getByRole("tab", { name: "Actividad reciente" }));

      expect(window.location.search).toBe(`?${RETURN_TO}`);
    });

    it("sin permiso de compras ni de cobro no hay Compras, Saldos ni Productos", async () => {
      mockAuth.role = "contador";
      mockAuth.permissions = ["contacts.view", "payments.view"];
      renderPage("?tab=saldos");

      // La pestaña pedida no existe para este rol: cae a la inicial.
      expect(await findTab("Actividad reciente")).toHaveAttribute("aria-selected", "true");
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Actividad reciente",
        "Ventas",
        "Pagos",
      ]);
    });
  });

  describe("resumen de la cabecera", () => {
    it("cliente: total vendido y por cobrar, nada de compras", async () => {
      contactType = "cliente";
      renderPage();

      // 25 ventas de ref 10 (todas caben en la consulta del resumen).
      await waitFor(() => expect(metricCard("Total vendido (REF)")).toHaveTextContent("ref 250.00"));
      expect(metricCard("Total vendido (REF)")).toHaveTextContent("Histórico del contacto");
      // Saldo: el total de documentos con saldo de Pagos, no una cuenta con las filas.
      await waitFor(() => expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("ref 15.00"));
      expect(metricCard("Pagos Realizados (REF)")).toHaveTextContent("ref 50.00");
      expect(screen.queryByText("Total comprado (REF)")).not.toBeInTheDocument();
      expect(screen.queryByText("Por Pagar (REF)")).not.toBeInTheDocument();
    });

    it("proveedor: total comprado y por pagar, nada de ventas", async () => {
      contactType = "proveedor";
      renderPage();

      // 12 compras de ref 20.
      await waitFor(() =>
        expect(metricCard("Total comprado (REF)")).toHaveTextContent("ref 240.00"),
      );
      await waitFor(() => expect(metricCard("Por Pagar (REF)")).toHaveTextContent("ref 30.00"));
      expect(screen.queryByText("Total vendido (REF)")).not.toBeInTheDocument();
      expect(screen.queryByText("Por Cobrar (REF)")).not.toBeInTheDocument();
    });

    it("ambos: vendido y comprado por separado, por cobrar y por pagar", async () => {
      renderPage();

      await waitFor(() => expect(metricCard("Total vendido (REF)")).toHaveTextContent("ref 250.00"));
      expect(metricCard("Total comprado (REF)")).toHaveTextContent("ref 240.00");
      await waitFor(() => expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("ref 15.00"));
      await waitFor(() => expect(metricCard("Por Pagar (REF)")).toHaveTextContent("ref 30.00"));
    });

    it("pide los totales con el máximo por página y no cambian al paginar una pestaña", async () => {
      renderPage("?tab=ventas");

      await waitFor(() => expect(metricCard("Total vendido (REF)")).toHaveTextContent("ref 250.00"));
      expect(requests).toContain("/api/contacts/c-1/sales?limit=100");

      await findLinkTo("/sales/sale-1");
      clickNextPage();
      await findLinkTo("/sales/sale-11");

      expect(metricCard("Total vendido (REF)")).toHaveTextContent("ref 250.00");
    });

    it("con más filas que las cargadas, la tarjeta dice cuántas sumó", async () => {
      contactType = "cliente";
      totals.sales = 240;
      renderPage();

      await waitFor(() =>
        expect(metricCard("Total vendido (REF)")).toHaveTextContent(
          "Suma de las últimas 100 de 240 ventas",
        ),
      );
      expect(metricCard("Pagos Realizados (REF)")).toHaveTextContent("Histórico del contacto");
    });
  });

  describe("paginación en servidor (D24)", () => {
    it("Pagos: pide la página 2 al servidor, pinta la fila 11 y guarda paymentsPage", async () => {
      renderPage("?tab=pagos");

      await findLinkTo("/payments/pay-1");
      expect(linksTo("/payments/pay-10")).not.toHaveLength(0);
      expect(linksTo("/payments/pay-11")).toHaveLength(0);
      expect(tabRequests("payments")).toEqual(["/api/contacts/c-1/payments?limit=10&skip=0"]);

      clickNextPage();

      expect(await findLinkTo("/payments/pay-11")).toBeInTheDocument();
      expect(linksTo("/payments/pay-1")).toHaveLength(0);
      expect(tabRequests("payments")).toContain("/api/contacts/c-1/payments?limit=10&skip=10");
      expect(window.location.search).toBe("?tab=pagos&paymentsPage=2");
    });

    it("DET-F3: con la API lenta, la página anterior queda atenuada y ocupada y el paginador marca la pedida", async () => {
      const respond = global.fetch;
      let releaseSecondPage = () => {};

      global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/contacts/c-1/payments?limit=10&skip=10")) {
          await new Promise<void>((resolve) => {
            releaseSecondPage = resolve;
          });
        }

        return respond(input, init);
      }) as unknown as typeof fetch;

      renderPage("?tab=pagos");
      await findLinkTo("/payments/pay-1");

      const busyRegion = () => screen.getByRole("table").closest("[aria-busy='true']");
      const currentPage = () =>
        document.querySelector("nav [aria-current='page']")?.textContent?.trim();

      expect(busyRegion()).toBeNull();
      expect(currentPage()).toBe("1");

      clickNextPage();

      // La respuesta sigue en vuelo: la URL ya es la página 2 y aún se ven las filas de la 1.
      await waitFor(() => expect(window.location.search).toBe("?tab=pagos&paymentsPage=2"));
      await waitFor(() => expect(busyRegion()).not.toBeNull());
      expect(linksTo("/payments/pay-1")).not.toHaveLength(0);
      expect(busyRegion()).toHaveClass("opacity-60");
      expect(currentPage()).toBe("2");
      expect(screen.getByText("Mostrando 11 a 20 de 25 pagos")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Siguiente" })[0]).toBeDisabled();

      releaseSecondPage();

      expect(await findLinkTo("/payments/pay-11")).toBeInTheDocument();
      expect(busyRegion()).toBeNull();
      expect(currentPage()).toBe("2");
    });

    it("DET-F3: Actividad también se marca ocupada mientras llega la página pedida", async () => {
      const respond = global.fetch;
      let releaseSecondPage = () => {};

      global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/contacts/c-1/activity?limit=10&skip=10")) {
          await new Promise<void>((resolve) => {
            releaseSecondPage = resolve;
          });
        }

        return respond(input, init);
      }) as unknown as typeof fetch;

      renderPage();

      const firstLink = await findLinkTo("/sales/sale-a001");

      clickNextPage();

      await waitFor(() => expect(firstLink.closest("[aria-busy='true']")).not.toBeNull());
      expect(document.querySelector("nav [aria-current='page']")).toHaveTextContent("2");

      releaseSecondPage();

      expect(await findLinkTo("/sales/sale-a011")).toBeInTheDocument();
      expect(document.querySelector("[aria-busy='true']")).toBeNull();
    });

    it("la URL con paymentsPage=3 abre directamente la tercera página", async () => {
      renderPage("?tab=pagos&paymentsPage=3");

      expect(await findLinkTo("/payments/pay-21")).toBeInTheDocument();
      expect(tabRequests("payments")).toEqual(["/api/contacts/c-1/payments?limit=10&skip=20"]);
    });

    it("Ventas, Compras y Actividad también paginan en servidor", async () => {
      renderPage("?tab=ventas&salesPage=2");

      expect(await findLinkTo("/sales/sale-11")).toBeInTheDocument();
      expect(tabRequests("sales")).toEqual(["/api/contacts/c-1/sales?limit=10&skip=10"]);

      fireEvent.click(screen.getByRole("tab", { name: "Compras" }));
      await findLinkTo("/purchases/purchase-1");
      clickNextPage();

      expect(await findLinkTo("/purchases/purchase-11")).toBeInTheDocument();
      expect(tabRequests("purchases")).toContain("/api/contacts/c-1/purchases?limit=10&skip=10");

      fireEvent.click(screen.getByRole("tab", { name: "Actividad reciente" }));
      await findLinkTo("/sales/sale-a001");
      clickNextPage();

      expect(await findLinkTo("/sales/sale-a011")).toBeInTheDocument();
      expect(tabRequests("activity")).toContain("/api/contacts/c-1/activity?limit=10&skip=10");
    });

    it("cada sublista tiene su campo de página: mover una no mueve las otras", async () => {
      renderPage("?tab=ventas&salesPage=2&paymentsPage=3");

      await findLinkTo("/sales/sale-11");
      clickNextPage();
      await findLinkTo("/sales/sale-21");

      const params = new URLSearchParams(window.location.search);

      expect(params.get("salesPage")).toBe("3");
      expect(params.get("paymentsPage")).toBe("3");

      fireEvent.click(screen.getByRole("tab", { name: "Pagos" }));

      expect(await findLinkTo("/payments/pay-21")).toBeInTheDocument();
      expect(new URLSearchParams(window.location.search).get("salesPage")).toBe("3");
    });

    it("una página fuera de rango cae a la última válida", async () => {
      renderPage("?tab=pagos&paymentsPage=9999");

      expect(await findLinkTo("/payments/pay-21")).toBeInTheDocument();
      expect(linksTo("/payments/pay-25")).not.toHaveLength(0);
      expect(new URLSearchParams(window.location.search).get("paymentsPage")).toBe("3");
    });

    it("Productos del proveedor: página y búsqueda en la URL con campos propios", async () => {
      renderPage("?tab=productos&productsPage=2&salesPage=2");

      expect(await findLinkTo("/products/prod-11")).toBeInTheDocument();
      expect(
        requests.some(
          (request) =>
            request.startsWith("/api/suppliers/c-1/products?") && request.includes("skip=10"),
        ),
      ).toBe(true);

      fireEvent.change(screen.getByRole("searchbox", { name: "Buscar productos del proveedor" }), {
        target: { value: "arroz" },
      });

      await waitFor(() => {
        const params = new URLSearchParams(window.location.search);

        expect(params.get("productsSearch")).toBe("arroz");
        // Buscar vuelve a la página 1 de ESTA lista y no toca la de ventas.
        expect(params.get("productsPage")).toBeNull();
        expect(params.get("salesPage")).toBe("2");
      });
      expect(
        requests.some(
          (request) =>
            request.startsWith("/api/suppliers/c-1/products?") && request.includes("search=arroz"),
        ),
      ).toBe(true);
    });
  });

  describe("estados por pestaña", () => {
    it("vacío", async () => {
      totals.payments = 0;
      renderPage("?tab=pagos");

      expect(await screen.findByText("Sin pagos registrados")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
    });

    it("403: aviso de permiso, sin reintento", async () => {
      forbidden = ["payments"];
      renderPage("?tab=pagos");

      expect(
        await screen.findByText("No tienes permiso para ver los pagos de este contacto"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Reintentar/i })).not.toBeInTheDocument();
    });

    it("error: mensaje del servidor con reintento que vuelve a pedir", async () => {
      failing = ["sales"];
      renderPage("?tab=ventas");

      expect(await screen.findByText("Se cayó el servidor")).toBeInTheDocument();

      failing = [];
      fireEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

      expect(await findLinkTo("/sales/sale-1")).toBeInTheDocument();
    });

    it("Actividad vacía y con 403", async () => {
      forbidden = ["activity"];
      renderPage();

      expect(
        await screen.findByText("No tienes permiso para ver la actividad de este contacto"),
      ).toBeInTheDocument();
    });
  });

  describe("volver y enlaces salientes", () => {
    it("Volver sin returnTo va a la lista de contactos", async () => {
      renderPage();

      expect(await screen.findByRole("link", { name: "Volver" })).toHaveAttribute(
        "href",
        "/contacts",
      );
    });

    it("Volver encadenado: regresa al detalle de origen con SU returnTo", async () => {
      const origin = `/sales/s-1?returnTo=${encodeURIComponent("/sales?page=2")}`;

      renderPage(`?returnTo=${encodeURIComponent(origin)}`);

      expect(await screen.findByRole("link", { name: "Volver" })).toHaveAttribute("href", origin);
    });

    it("Volver descarta un returnTo externo", async () => {
      renderPage(`?returnTo=${encodeURIComponent("https://evil.example/x")}`);

      expect(await screen.findByRole("link", { name: "Volver" })).toHaveAttribute(
        "href",
        "/contacts",
      );
    });

    it("ventas, compras, pagos, actividad y productos enlazan con returnTo al detalle tal como está", async () => {
      renderPage(`?tab=ventas&salesPage=2&${RETURN_TO}`);

      const detailUrl = (tab: string, extra = "") =>
        `/contacts/c-1?tab=${tab}${extra}&${RETURN_TO}`;

      // La URL del detalle entera: pestaña, página y el returnTo con el que se llegó.
      expect(returnToOf(await findLinkTo("/sales/sale-11"))).toEqual(
        normalizeUrl(detailUrl("ventas", "&salesPage=2")),
      );

      fireEvent.click(screen.getByRole("tab", { name: "Compras" }));
      expect(returnToOf(await findLinkTo("/purchases/purchase-1"))).toEqual(
        normalizeUrl(detailUrl("compras", "&salesPage=2")),
      );

      fireEvent.click(screen.getByRole("tab", { name: "Pagos" }));
      expect(returnToOf(await findLinkTo("/payments/pay-1"))).toEqual(
        normalizeUrl(detailUrl("pagos", "&salesPage=2")),
      );

      fireEvent.click(screen.getByRole("tab", { name: "Productos" }));
      expect(returnToOf(await findLinkTo("/products/prod-1"))).toEqual(
        normalizeUrl(detailUrl("productos", "&salesPage=2")),
      );

      fireEvent.click(screen.getByRole("tab", { name: "Actividad reciente" }));
      expect(returnToOf(await findLinkTo("/sales/sale-a001"))).toEqual(
        normalizeUrl(`/contacts/c-1?salesPage=2&${RETURN_TO}`),
      );
    });

    it("Pagos: la columna Documento enlaza la venta o la compra del pago con returnTo encadenado", async () => {
      renderPage(`?tab=pagos&${RETURN_TO}`);

      const detailUrl = `/contacts/c-1?tab=pagos&${RETURN_TO}`;
      const saleLink = await findLinkTo("/sales/sale-doc-1");
      const purchaseLink = await findLinkTo("/purchases/purchase-doc-2");

      expect(screen.getAllByRole("columnheader", { name: "Documento" })).not.toHaveLength(0);
      expect(saleLink).toHaveTextContent("Venta");
      expect(purchaseLink).toHaveTextContent("Compra");
      expect(saleLink.getAttribute("href")).toBe(
        `/sales/sale-doc-1?returnTo=${encodeURIComponent(detailUrl)}`,
      );
      // El contacto sigue sabiendo volver a su lista de origen.
      expect(returnToOf(saleLink)).toEqual(normalizeUrl(detailUrl));
      expect(returnToOf(purchaseLink)).toEqual(normalizeUrl(detailUrl));
      // pay-3 no abona ningún documento: su celda no enlaza a ninguna venta ni compra.
      expect(linksTo("/sales/sale-doc-3")).toHaveLength(0);
      expect(linksTo("/purchases/purchase-doc-3")).toHaveLength(0);
      expect(await findLinkTo("/payments/pay-3")).toBeInTheDocument();
    });

    it("Pagos: sin permiso para ver el documento, la columna lo nombra sin enlazarlo", async () => {
      mockAuth.permissions = ADMIN_PERMISSIONS.filter(
        (permission) => permission !== "sales.view" && permission !== "purchases.view",
      );
      renderPage("?tab=pagos");

      await findLinkTo("/payments/pay-1");

      expect(screen.getAllByText("Venta").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Compra").length).toBeGreaterThan(0);
      expect(linksTo("/sales/sale-doc-1")).toHaveLength(0);
      expect(linksTo("/purchases/purchase-doc-2")).toHaveLength(0);
    });

    it("Pagos: con permiso de ventas y sin el de compras solo enlaza las ventas", async () => {
      mockAuth.permissions = ADMIN_PERMISSIONS.filter(
        (permission) => permission !== "purchases.view",
      );
      renderPage("?tab=pagos");

      expect(await findLinkTo("/sales/sale-doc-1")).toBeInTheDocument();
      expect(linksTo("/purchases/purchase-doc-2")).toHaveLength(0);
    });

    it("sin permiso para el detalle de destino, la fila no enlaza", async () => {
      mockAuth.permissions = ADMIN_PERMISSIONS.filter((permission) => permission !== "sales.view");
      renderPage("?tab=ventas");

      expect(await screen.findAllByText("F-0001")).not.toHaveLength(0);
      expect(linksTo("/sales/sale-1")).toHaveLength(0);
    });
  });
});
