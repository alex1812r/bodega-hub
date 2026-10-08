import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockAuth: { permissions: string[]; role: string } = {
  permissions: [],
  role: "admin",
};

// PAG-F6 U6: al enviar un pago el modal monta el guardia de proceso, que usa el router de Next.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockAuth.permissions.includes(permission),
    role: mockAuth.role,
  }),
}));

import { ContactDetailsPage } from "./page";

const ADMIN_PERMISSIONS = [
  "contacts.view",
  "contacts.manage",
  "payments.manage",
  "payments.view",
  "purchases.view",
  "sales.create",
];

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

  beforeEach(() => {
    mockAuth.permissions = ADMIN_PERMISSIONS;
    mockAuth.role = "admin";
    contactType = "ambos";
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
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

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

  it("no pide documentos con saldo hasta abrir la pestaña", async () => {
    renderPage();

    expect(await screen.findByRole("tab", { name: "Saldos" })).toBeInTheDocument();
    expect(openDocumentTypes()).toEqual([]);
  });

  it("contacto de ambos tipos: por cobrar y por pagar, con returnTo al contacto", async () => {
    renderPage();
    await openBalancesTab();

    const receivable = within(screen.getByRole("region", { name: "Por cobrar" }));
    const payable = within(screen.getByRole("region", { name: "Por pagar" }));

    expect(await receivable.findByRole("link", { name: "F-0001" })).toHaveAttribute(
      "href",
      "/sales/sale-internal-1?returnTo=%2Fcontacts%2Fcont-internal",
    );
    expect(await payable.findByRole("link", { name: "#C-000128" })).toHaveAttribute(
      "href",
      "/purchases/purchase-internal-1?returnTo=%2Fcontacts%2Fcont-internal",
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
