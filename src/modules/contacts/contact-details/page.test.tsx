/**
 * PAG-04b / PAG-F8 · pestaña Saldos y métricas "Por cobrar / Por pagar" del detalle.
 * PRO-04 · edición desde el detalle del contacto: el error de un guardado
 * fallido no sigue ahí al volver a abrir el modal.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockAuth: { permissions: string[]; role: string } = {
  permissions: [],
  role: "admin",
};

// PAG-F6 U6: al enviar un pago el modal monta el guardia de proceso, que usa el router de Next.
jest.mock("next/navigation", () => ({
  // La ruta real de la prueba: la pestaña activa (`?tab=`) y el `returnTo` salen de la URL.
  usePathname: () => window.location.pathname,
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

import { ToastProvider } from "../../../shared/components/Toast";
import { ContactDetailsPage } from "./page";

const ADMIN_PERMISSIONS = [
  "contacts.view",
  "contacts.manage",
  "payments.manage",
  "payments.view",
  "purchases.view",
  "sales.create",
];

const TAX_ID_TAKEN = "Ya existe un contacto con ese RIF.";

const contact = {
  address: "",
  email: "",
  id: "cont-1",
  isActive: true,
  name: "Ferretería La Central",
  phone: "",
  taxId: "J-00000001-1",
  type: "cliente",
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function page(items: unknown[]) {
  return { items, limit: 100, skip: 0, total: items.length };
}

const SALE_DOCUMENT = {
  createdAt: "2026-09-01T15:10:00.000Z",
  id: "sale-internal-1",
  number: "F-0001",
  paidVes: 0,
  pendingRef: 10,
  pendingVes: 5100,
  refRateVes: 510,
  status: "pendiente_pago",
  totalRef: 10,
  totalVes: 5100,
  type: "sale",
};

const PURCHASE_DOCUMENT = {
  createdAt: "2026-09-20T15:10:00.000Z",
  id: "purchase-internal-1",
  number: "C-000128",
  paidRef: 0,
  paidVes: 0,
  pendingRef: 30,
  pendingVes: 15000,
  refRateVes: 500,
  status: "recibido",
  totalRef: 30,
  totalVes: 15000,
  type: "purchase",
};

describe("ContactDetailsPage · pestaña Saldos (PAG-04b)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let contactType: "ambos" | "cliente" | "proveedor";
  /** Primera página de ventas/compras del contacto, como la devuelve `/api/contacts/:id/...`. */
  let contactSales: unknown[];
  let contactPurchases: unknown[];
  /** Si está puesto, la lista de documentos con saldo de ese tipo viene vacía. */
  let settledTypes: string[];

  beforeEach(() => {
    mockAuth.permissions = ADMIN_PERMISSIONS;
    mockAuth.role = "admin";
    contactType = "ambos";
    contactSales = [];
    contactPurchases = [];
    settledTypes = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url);

      if (init?.method === "POST") {
        return jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 4100 } }, 201);
      }

      if (href.includes("/api/payments/open-documents")) {
        const type = new URL(href, "http://localhost").searchParams.get("type");
        const items = type === "purchase" ? [PURCHASE_DOCUMENT] : [SALE_DOCUMENT];

        if (settledTypes.includes(String(type))) {
          return jsonResponse({
            data: { ...page([]), totals: { count: 0, pendingVes: 0, truncated: false } },
          });
        }

        return jsonResponse({
          data: {
            ...page(items),
            totals: {
              count: items.length,
              pendingRef: items[0].pendingRef,
              pendingVes: items[0].pendingVes,
              truncated: false,
            },
          },
        });
      }

      if (/\/api\/contacts\/[^/]+\/sales/.test(href)) {
        return jsonResponse({ data: page(contactSales) });
      }

      if (/\/api\/contacts\/[^/]+\/purchases/.test(href)) {
        return jsonResponse({ data: page(contactPurchases) });
      }

      if (/\/api\/contacts\/[^/]+\/(activity|sales|purchases|payments)/.test(href)) {
        return jsonResponse({ data: page([]) });
      }

      if (href.includes("/api/contacts/")) {
        return jsonResponse({
          data: {
            address: "Av. Principal",
            email: "maria@example.com",
            id: "cont-internal",
            isActive: true,
            name: "Maria Perez",
            phone: "0414-0000000",
            taxId: "V-12345678",
            type: contactType,
          },
        });
      }

      if (href.includes("/api/settings/payment-methods")) {
        return jsonResponse({ data: { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd"] } });
      }

      if (href.includes("/api/sales/")) {
        return jsonResponse({
          data: {
            customer: { id: "cont-internal", name: "Maria Perez" },
            id: "sale-internal-1",
            invoiceNumber: "F-0001",
            paidVes: 0,
            refRateVes: 510,
            totalVes: 5100,
          },
        });
      }

      return jsonResponse({ data: null });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    window.history.replaceState(null, "", "/contacts/cont-internal");

    return render(
      <QueryClientProvider client={queryClient}>
        <ContactDetailsPage contactId="cont-internal" />
      </QueryClientProvider>,
    );
  }

  function requests(fragment: string) {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method !== "POST")
      .map(([url]) => String(url))
      .filter((url) => url.includes(fragment));
  }

  function openDocumentTypes() {
    return requests("/api/payments/open-documents").map((url) =>
      new URL(url, "http://localhost").searchParams.get("type"),
    );
  }

  async function openBalancesTab() {
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: "Saldos" }));

    return user;
  }

  /** Valor de una tarjeta de métrica de la cabecera, por su etiqueta. */
  function metricCard(label: string) {
    return screen.getByText(label).parentElement?.parentElement as HTMLElement;
  }

  describe("PAG-F8 N2: Por cobrar / Por pagar de la cabecera", () => {
    beforeEach(() => {
      // Ventas y compras abiertas del contacto; sus pagos no caben en la primera página
      // (10), así que la cuenta de siempre daría 628,75 por cobrar y 52,40 por pagar.
      contactSales = [{ id: "sale-old", status: "pendiente_pago", totalRef: 628.75 }];
      contactPurchases = [{ id: "purchase-old", status: "recibido", totalRef: 52.4 }];
    });

    it("salen de los mismos documentos con saldo que la pestaña Saldos, pedidos al cargar", async () => {
      renderPage();

      await waitFor(() => expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("ref 10.00"));
      expect(metricCard("Por Pagar (REF)")).toHaveTextContent("ref 30.00");
      expect(metricCard("Por Cobrar (REF)")).not.toHaveTextContent("ref 628.75");
      // Las demás métricas siguen saliendo de ventas, compras y pagos del contacto.
      expect(metricCard("Total vendido (REF)")).toHaveTextContent("ref 628.75");
      expect(metricCard("Total comprado (REF)")).toHaveTextContent("ref 52.40");

      // Misma consulta que la pestaña (contacto, tipo y límite): una caché, un refresco.
      const queries = requests("/api/payments/open-documents").map((url) => {
        const params = new URL(url, "http://localhost").searchParams;

        return [params.get("contactId"), params.get("type"), params.get("limit")].join("|");
      });

      expect([...queries].sort()).toEqual(["cont-internal|purchase|100", "cont-internal|sale|100"]);

      await openBalancesTab();

      const receivable = within(screen.getByRole("region", { name: "Por cobrar" }));

      expect(await receivable.findByText(/ref 10\.00 ·/)).toBeInTheDocument();
    });

    it("tras abonar todo, la cabecera queda en cero igual que Saldos", async () => {
      settledTypes = ["sale", "purchase"];
      renderPage();

      await waitFor(() =>
        expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("Sin saldo por cobrar"),
      );
      expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("ref 0.00");
      expect(metricCard("Por Pagar (REF)")).toHaveTextContent("ref 0.00");
      expect(metricCard("Por Pagar (REF)")).toHaveTextContent("Sin saldo por pagar");
    });

    it("sin permiso para una sección de Saldos, esa métrica conserva el cálculo de siempre", async () => {
      // Contador sin payments.manage: ve compras pero no tiene pestaña Saldos.
      mockAuth.role = "contador";
      mockAuth.permissions = ["contacts.view", "payments.view", "purchases.view"];
      renderPage();

      await waitFor(() => expect(metricCard("Por Pagar (REF)")).toHaveTextContent("ref 52.40"));
      expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("ref 628.75");
      expect(openDocumentTypes()).toEqual([]);
    });

    it("vendedor: por cobrar sale de Saldos y no se piden compras", async () => {
      mockAuth.role = "vendedor";
      mockAuth.permissions = ["contacts.view", "sales.create"];
      renderPage();

      await waitFor(() => expect(metricCard("Por Cobrar (REF)")).toHaveTextContent("ref 10.00"));
      expect(screen.queryByText("Por Pagar (REF)")).not.toBeInTheDocument();
      expect(openDocumentTypes()).toEqual(["sale"]);
    });
  });

  it("contacto de ambos tipos: por cobrar y por pagar, con returnTo al contacto", async () => {
    renderPage();
    await openBalancesTab();

    const receivable = within(screen.getByRole("region", { name: "Por cobrar" }));
    const payable = within(screen.getByRole("region", { name: "Por pagar" }));

    expect(await receivable.findByRole("link", { name: "F-0001" })).toHaveAttribute(
      "href",
      // Al detalle con su pestaña: "Volver" regresa a Saldos, no a Actividad.
      "/sales/sale-internal-1?returnTo=%2Fcontacts%2Fcont-internal%3Ftab%3Dsaldos",
    );
    expect(await payable.findByRole("link", { name: "#C-000128" })).toHaveAttribute(
      "href",
      "/purchases/purchase-internal-1?returnTo=%2Fcontacts%2Fcont-internal%3Ftab%3Dsaldos",
    );
    expect(screen.getByRole("tabpanel").textContent).not.toMatch(/internal/);
  });

  it("cliente: solo por cobrar", async () => {
    contactType = "cliente";
    renderPage();
    await openBalancesTab();

    expect(await screen.findByRole("link", { name: "F-0001" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Por pagar" })).not.toBeInTheDocument();
    expect(openDocumentTypes().every((type) => type === "sale")).toBe(true);
  });

  it("proveedor: solo por pagar", async () => {
    contactType = "proveedor";
    renderPage();
    await openBalancesTab();

    expect(await screen.findByRole("link", { name: "#C-000128" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Por cobrar" })).not.toBeInTheDocument();
    expect(openDocumentTypes().every((type) => type === "purchase")).toBe(true);
  });

  it("vendedor: solo ventas y ninguna peticion de compras", async () => {
    mockAuth.role = "vendedor";
    mockAuth.permissions = ["contacts.view", "sales.create"];
    renderPage();
    await openBalancesTab();

    expect(await screen.findByRole("link", { name: "F-0001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abonar" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Por pagar" })).not.toBeInTheDocument();
    expect(openDocumentTypes().length).toBeGreaterThan(0);
    expect(openDocumentTypes()).not.toContain("purchase");
    expect(openDocumentTypes()).not.toContain(null);
  });

  it("vendedor ante un proveedor: sin pestaña", async () => {
    mockAuth.role = "vendedor";
    mockAuth.permissions = ["contacts.view", "sales.create"];
    contactType = "proveedor";
    renderPage();

    expect(await screen.findByRole("tab", { name: "Pagos" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Saldos" })).not.toBeInTheDocument();
  });

  it("sin permisos de cobro ni de pago: la pestaña no aparece y no se pide nada", async () => {
    mockAuth.role = "contador";
    mockAuth.permissions = ["contacts.view", "payments.view", "purchases.view"];
    renderPage();

    expect(await screen.findByRole("tab", { name: "Pagos" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Saldos" })).not.toBeInTheDocument();
    expect(openDocumentTypes()).toEqual([]);
  });

  it("tras registrar un cobro se vuelven a leer los saldos y las metricas del contacto", async () => {
    contactType = "cliente";
    renderPage();
    const user = await openBalancesTab();

    await user.click(await screen.findByRole("button", { name: "Cobrar F-0001" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Cobrar saldo" }));

    await dialog.findByText(/Saldo pendiente actual/);
    const before = {
      contact: requests("/api/contacts/cont-internal/sales").length,
      documents: requests("/api/payments/open-documents").length,
      payments: requests("/api/contacts/cont-internal/payments").length,
    };

    await user.type(dialog.getByLabelText("Monto"), "1000");
    await user.click(dialog.getByRole("button", { name: "Registrar cobro" }));

    await waitFor(() => {
      expect(requests("/api/payments/open-documents").length).toBeGreaterThan(before.documents);
      expect(requests("/api/contacts/cont-internal/sales").length).toBeGreaterThan(before.contact);
      expect(requests("/api/contacts/cont-internal/payments").length).toBeGreaterThan(
        before.payments,
      );
    });
  });
});

describe("ContactDetailsPage · edición (PRO-04)", () => {
  const originalMatchMedia = window.matchMedia;
  let patchResponses: Response[];
  let patches: Array<Record<string, unknown>>;

  beforeEach(() => {
    // Admin con todo: la edición exige contacts.manage.
    mockAuth.permissions = ADMIN_PERMISSIONS;
    mockAuth.role = "admin";
    patchResponses = [];
    patches = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)) as Record<string, unknown>);

        return patchResponses.shift() ?? jsonResponse({ data: contact });
      }

      return new URL(String(input), "http://localhost").pathname === "/api/contacts/cont-1"
        ? jsonResponse({ data: contact })
        : jsonResponse({ data: { items: [], limit: 10, skip: 0, total: 0 } });
    }) as unknown as typeof fetch;
    window.history.replaceState(null, "", "/contacts/cont-1");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("tras una edición fallida, cerrar y reabrir no muestra el error viejo ni en el modal ni en la página", async () => {
    const unhandled = jest.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup({ delay: null });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ContactDetailsPage contactId="cont-1" />
        </ToastProvider>
      </QueryClientProvider>,
    );

    async function openEdit() {
      await user.click(await screen.findByRole("button", { name: "Editar" }));

      return within(await screen.findByRole("dialog", { name: "Editar contacto" }));
    }

    let dialog = await openEdit();

    patchResponses.push(jsonResponse({ error: { code: "CONFLICT", message: TAX_ID_TAKEN } }, 409));
    process.on("unhandledRejection", unhandled);

    try {
      await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));

      // El fallo no cierra el modal: se ve el motivo.
      expect(await dialog.findByText(TAX_ID_TAKEN)).toBeVisible();
      // Node avisa de un rechazo sin manejar en el turno siguiente.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(patches).toHaveLength(1);
    expect(screen.getByText("No pudimos actualizar el contacto")).toBeInTheDocument();
    // Editar no es un alta: no hay aviso de "creado".
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openEdit();

    expect(dialog.queryByText(TAX_ID_TAKEN)).not.toBeInTheDocument();
    expect(screen.queryByText("No pudimos actualizar el contacto")).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Ferretería La Central");

    // El reintento guarda y cierra.
    await user.click(dialog.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches).toHaveLength(2);
  });
});
