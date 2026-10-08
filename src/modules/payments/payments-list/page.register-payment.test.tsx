/**
 * PAG-03b · «Registrar pago» en `/payments`: abre el buscador de documentos con saldo
 * y, al elegir, el modal de pago con el documento fijo. Con un enlace profundo
 * (`?saleId=` / `?purchaseId=`) abre el modal directo. En ningun paso se teclea un ID.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigation = { query: "" };
const mockAuth: { permissions: string[] | "all"; role: string } = {
  permissions: "all",
  role: "admin",
};

jest.mock("next/navigation", () => ({
  usePathname: () => "/payments",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNavigation.query),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) =>
      mockAuth.permissions === "all" || mockAuth.permissions.includes(permission),
    role: mockAuth.role,
  }),
}));
jest.mock("./components/PaymentsExportActions", () => ({
  PaymentsExportActions: () => null,
}));

import { PaymentsListPage } from "./page";

const SALE_DOCUMENT = {
  contact: { id: "cont-customer", name: "Maria Perez" },
  createdAt: "2026-10-01T15:10:00.000Z",
  id: "sale-002",
  number: "F-0002",
  paidVes: 3000,
  pendingRef: 16.62,
  pendingVes: 8475,
  refRateVes: 510,
  status: "pendiente_pago",
  totalRef: 22.5,
  totalVes: 11475,
  type: "sale",
};

const PURCHASE_DOCUMENT = {
  contact: { id: "cont-supplier", name: "Distribuidora Polar" },
  createdAt: "2026-09-20T15:10:00.000Z",
  id: "purchase-002",
  number: "C-0002",
  paidRef: 0,
  paidVes: 0,
  pendingRef: 40.4,
  pendingVes: 20200,
  refRateVes: 500,
  status: "recibido",
  totalRef: 40.4,
  totalVes: 20200,
  type: "purchase",
};

function listedPayment(id: string) {
  return {
    amount: 100,
    amountRef: 0.2,
    amountVes: 100,
    contact: { id: "cont-customer", name: "Cliente Demo", type: "cliente" },
    contactId: "cont-customer",
    createdAt: "2026-10-06T13:32:00.000Z",
    currency: "VES",
    direction: "entrada",
    id,
    method: "efectivo_ves",
    refRateVes: 510,
    relatedDocument: { href: "/sales/sale-009", label: "V-000009" },
    saleId: "sale-009",
    status: "activo",
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("PaymentsListPage · Registrar pago (PAG-03b)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let listItems: ReturnType<typeof listedPayment>[];

  beforeEach(() => {
    mockAuth.permissions = "all";
    mockAuth.role = "admin";
    mockNavigation.query = "";
    window.history.replaceState(null, "", "/payments");
    listItems = [listedPayment("pay-001")];
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
      const [path, search = ""] = String(url).split("?");

      if (init?.method === "POST") {
        return jsonResponse(
          {
            data: {
              ...listedPayment("pay-new"),
              pendingBalanceVes: 0,
              relatedDocument: { href: "/sales/sale-002", label: "F-0002" },
              saleId: "sale-002",
            },
          },
          201,
        );
      }

      if (path === "/api/payments") {
        return jsonResponse({
          data: { items: listItems, limit: 10, skip: 0, total: listItems.length },
        });
      }

      if (path === "/api/payments/open-documents") {
        const items =
          new URLSearchParams(search).get("type") === "purchase"
            ? [PURCHASE_DOCUMENT]
            : [SALE_DOCUMENT];

        return jsonResponse({
          data: {
            items,
            limit: 20,
            skip: 0,
            total: items.length,
            totals: { count: items.length, pendingVes: 0, truncated: false },
          },
        });
      }

      if (path === "/api/settings/payment-methods") {
        return jsonResponse({ data: { enabledPaymentMethods: ["efectivo_ves", "pago_movil"] } });
      }

      if (path === "/api/sales/sale-002") {
        return jsonResponse({
          data: {
            customer: { id: "cont-customer", name: "Maria Perez" },
            id: "sale-002",
            invoiceNumber: "F-0002",
            paidVes: 3000,
            refRateVes: 510,
            totalVes: 11475,
          },
        });
      }

      if (path === "/api/purchases/purchase-002") {
        return jsonResponse({
          data: {
            id: "purchase-002",
            paidVes: 0,
            purchaseNumber: "C-0002",
            refRateVes: 500,
            supplier: { id: "cont-supplier", name: "Distribuidora Polar" },
            totalVes: 20200,
          },
        });
      }

      return jsonResponse({ error: { code: "NOT_FOUND", message: "No encontrado." } }, 404);
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function openAt(query: string) {
    window.history.replaceState(null, "", `/payments?${query}`);
    mockNavigation.query = query;
  }

  function requestsTo(path: string) {
    return fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).split("?")[0] === path && (init as RequestInit | undefined)?.method !== "POST",
    );
  }

  /**
   * Peticiones del BUSCADOR de documentos. El aviso de ventas pendientes (PAG-07)
   * consulta el mismo endpoint al montar la pagina, siempre con `olderThanDays`:
   * esas no cuentan aqui.
   */
  function pickerDocumentRequests() {
    return requestsTo("/api/payments/open-documents").filter(
      ([url]) => !new URLSearchParams(String(url).split("?")[1] ?? "").has("olderThanDays"),
    );
  }

  function posts() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      .map(([url, init]) => ({
        body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
        url: String(url),
      }));
  }

  async function renderPage() {
    // Sin caducidad: lo que se vuelva a pedir es porque el pago lo invalido.
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsListPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(requestsTo("/api/payments").length).toBeGreaterThan(0));
    await screen.findByRole("heading", { name: "Pagos" });

    return userEvent.setup();
  }

  async function openPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole("button", { name: "Registrar pago" })[0]);

    const dialog = await screen.findByRole("dialog", { name: "Registrar pago" });

    await within(dialog).findByRole("listbox");

    return within(dialog);
  }

  /** Etiquetas, nombres accesibles y placeholders de todos los campos a la vista. */
  function fieldTexts() {
    const fields = Array.from(document.querySelectorAll("input, select, textarea"));

    return fields.flatMap((field) => [
      ...Array.from((field as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? ""),
      field.getAttribute("aria-label") ?? "",
      field.getAttribute("placeholder") ?? "",
    ]);
  }

  function expectNoIdField() {
    const texts = fieldTexts().filter(Boolean);

    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((text) => /\bid\b/i.test(text))).toEqual([]);
    expect(texts.filter((text) => /sale-|purchase-/.test(text))).toEqual([]);
  }

  it("«Registrar pago» de la cabecera abre el buscador de documentos con saldo", async () => {
    const user = await renderPage();
    const picker = await openPicker(user);

    expect(picker.getByRole("combobox", { name: "Buscar documento" })).toBeInTheDocument();
    expect(within(picker.getByRole("listbox")).getByText("F-0002")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Cobrar saldo" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("«Registrar pago» del estado vacio abre el mismo buscador", async () => {
    listItems = [];
    const user = await renderPage();

    await screen.findByText("No hay pagos para mostrar");

    const buttons = screen.getAllByRole("button", { name: "Registrar pago" });

    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);

    expect(await screen.findByRole("dialog", { name: "Registrar pago" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Buscar documento" })).toBeInTheDocument();
  });

  it("elegir una venta cierra el buscador y abre el modal de cobro con su saldo; al registrar se refrescan pagos y documentos", async () => {
    const user = await renderPage();
    const picker = await openPicker(user);
    const documentRequestsBefore = pickerDocumentRequests().length;

    await user.click(within(picker.getByRole("listbox")).getByRole("option"));

    const modal = await screen.findByRole("dialog", { name: "Cobrar saldo" });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await within(modal).findByText("Venta F-0002 de Maria Perez.")).toBeInTheDocument();
    expect(await within(modal).findByText(/Saldo pendiente actual/)).toHaveTextContent("8.475,00");
    expectNoIdField();

    await user.click(within(modal).getByRole("button", { name: "Completar saldo" }));
    await user.click(within(modal).getByRole("button", { name: "Registrar cobro" }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual({
      body: {
        amount: 8475,
        clientRequestId: expect.any(String),
        currency: "VES",
        method: "efectivo_ves",
        saleId: "sale-002",
      },
      url: "/api/payments",
    });
    expect(await within(modal).findByText(/Pago registrado/)).toBeInTheDocument();

    await user.click(within(modal).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // El pago nuevo ya esta en la lista, sin recargar la pantalla.
    expect((await screen.findAllByRole("link", { name: "F-0002" })).length).toBeGreaterThan(0);

    // La consulta del buscador quedo invalidada: al reabrirlo se vuelve a pedir.
    await openPicker(user);
    await waitFor(() =>
      expect(pickerDocumentRequests().length).toBeGreaterThan(documentRequestsBefore),
    );
  });

  it("elegir una compra abre el modal de pago de esa compra", async () => {
    const user = await renderPage();
    const picker = await openPicker(user);

    await user.selectOptions(picker.getByLabelText("Tipo de documento"), "Compras por pagar");
    await user.click(await picker.findByText("C-0002"));

    const modal = await screen.findByRole("dialog", { name: "Pagar compra" });

    expect(
      await within(modal).findByText("Compra C-0002 a Distribuidora Polar."),
    ).toBeInTheDocument();
    expect(await within(modal).findByText(/Saldo pendiente actual/)).toHaveTextContent(
      "20.200,00",
    );
  });

  it("cerrar el modal sin pagar lo cierra todo: no vuelve al buscador", async () => {
    const user = await renderPage();
    const picker = await openPicker(user);

    await user.click(within(picker.getByRole("listbox")).getByRole("option"));

    const modal = await screen.findByRole("dialog", { name: "Cobrar saldo" });

    await user.click(within(modal).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts()).toHaveLength(0);
  });

  describe("enlace profundo", () => {
    it("con ?saleId= abre directo el modal de cobro de esa venta, sin buscador", async () => {
      openAt("saleId=sale-002");
      const user = await renderPage();

      await user.click(screen.getAllByRole("button", { name: "Registrar pago" })[0]);

      const modal = await screen.findByRole("dialog", { name: "Cobrar saldo" });

      expect(await within(modal).findByText("Venta F-0002 de Maria Perez.")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Buscar documento" })).not.toBeInTheDocument();
      expect(pickerDocumentRequests()).toHaveLength(0);
      expectNoIdField();
    });

    it("con ?purchaseId= abre directo el modal de pago de esa compra", async () => {
      openAt("purchaseId=purchase-002");
      const user = await renderPage();

      await user.click(screen.getAllByRole("button", { name: "Registrar pago" })[0]);

      const modal = await screen.findByRole("dialog", { name: "Pagar compra" });

      expect(
        await within(modal).findByText("Compra C-0002 a Distribuidora Polar."),
      ).toBeInTheDocument();
      expect(pickerDocumentRequests()).toHaveLength(0);
    });

    it("con venta y compra a la vez no adivina: abre el buscador", async () => {
      openAt("saleId=sale-002&purchaseId=purchase-002");
      const user = await renderPage();

      expect(await openPicker(user)).toBeDefined();
      expect(screen.queryByRole("dialog", { name: "Cobrar saldo" })).not.toBeInTheDocument();
    });
  });

  describe("vendedor", () => {
    beforeEach(() => {
      mockAuth.role = "vendedor";
      mockAuth.permissions = ["payments.view", "sales.create"];
    });

    it("el buscador no ofrece compras y solo pide ventas", async () => {
      const user = await renderPage();
      const picker = await openPicker(user);

      expect(picker.queryByLabelText("Tipo de documento")).not.toBeInTheDocument();
      expect(picker.queryByText("Compras por pagar")).not.toBeInTheDocument();
      expect(
        pickerDocumentRequests().map(([url]) =>
          new URLSearchParams(String(url).split("?")[1]).get("type"),
        ),
      ).toEqual(["sale"]);
    });

    it("un ?purchaseId= en la URL no le abre el pago de la compra: va al buscador de ventas", async () => {
      openAt("purchaseId=purchase-002");
      const user = await renderPage();

      await openPicker(user);

      expect(screen.queryByRole("dialog", { name: "Pagar compra" })).not.toBeInTheDocument();
      expect(requestsTo("/api/purchases/purchase-002")).toHaveLength(0);
    });
  });

  it("sin permiso para registrar pagos no hay boton ni buscador", async () => {
    mockAuth.role = "contador";
    mockAuth.permissions = ["payments.view"];
    await renderPage();

    await screen.findAllByRole("link", { name: "V-000009" });

    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
  });

  it("en /payments no hay ningun campo cuya etiqueta contenga «ID»: ni en la lista, ni en el buscador, ni en el modal", async () => {
    const user = await renderPage();

    await screen.findAllByRole("link", { name: "V-000009" });
    expectNoIdField();
    expect(screen.queryByLabelText(/ID/)).not.toBeInTheDocument();

    const picker = await openPicker(user);

    expectNoIdField();
    expect(screen.queryByLabelText(/ID/)).not.toBeInTheDocument();

    await user.click(within(picker.getByRole("listbox")).getByRole("option"));

    const modal = await screen.findByRole("dialog", { name: "Cobrar saldo" });

    await within(modal).findByText(/Saldo pendiente actual/);
    expectNoIdField();
    expect(screen.queryByLabelText(/ID/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contexto")).not.toBeInTheDocument();
  });
});
