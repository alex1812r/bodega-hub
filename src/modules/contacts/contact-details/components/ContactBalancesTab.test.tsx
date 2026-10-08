import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission, UserRole } from "@/shared/auth/permissions";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import {
  ContactBalancesTab,
  type ContactBalancesTabProps,
  getContactBalanceSections,
} from "./ContactBalancesTab";

// El modal de abono lleva un guardia de proceso (`useProcessGuard`) que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

type MockProfile = { storeId: string | null; user: { id: string } };

const ADMIN_PROFILE: MockProfile = { storeId: "store-1", user: { id: "user-admin" } };
// PAG-F8: el abono por confirmar se guarda por tienda y usuario de la sesión.
const mockAuth: { profile: MockProfile } = { profile: ADMIN_PROFILE };

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ profile: mockAuth.profile }),
}));

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const SALES = [
  {
    createdAt: "2026-09-01T15:10:00.000Z",
    id: "sale-internal-1",
    number: "F-0001",
    paidVes: 3000,
    pendingRef: 16.62,
    pendingVes: 8475,
    refRateVes: 510,
    status: "pendiente_pago",
    totalRef: 22.5,
    totalVes: 11475,
    type: "sale",
  },
  {
    createdAt: "2026-09-05T15:10:00.000Z",
    id: "sale-internal-2",
    number: "F-0002",
    paidVes: 0,
    pendingRef: 10,
    pendingVes: 5100,
    refRateVes: 510,
    status: "pendiente_pago",
    totalRef: 10,
    totalVes: 5100,
    type: "sale",
  },
];

const PURCHASES = [
  {
    createdAt: "2026-09-20T15:10:00.000Z",
    id: "purchase-internal-1",
    number: "C-000128",
    paidRef: 10.4,
    paidVes: 5200,
    pendingRef: 30,
    pendingVes: 15000,
    refRateVes: 500,
    status: "recibido",
    totalRef: 40.4,
    totalVes: 20200,
    type: "purchase",
  },
];

type Reply = { items: unknown[]; truncated?: boolean } | { error: string; status: number };

describe("getContactBalanceSections", () => {
  function access(permissions: Permission[], role?: UserRole) {
    return { can: (permission: Permission) => permissions.includes(permission), role };
  }

  const admin = access(["payments.manage", "purchases.view", "sales.create"], "admin");

  it("cliente: solo por cobrar; proveedor: solo por pagar; ambos: las dos", () => {
    expect(getContactBalanceSections("cliente", admin)).toEqual(["sale"]);
    expect(getContactBalanceSections("proveedor", admin)).toEqual(["purchase"]);
    expect(getContactBalanceSections("ambos", admin)).toEqual(["sale", "purchase"]);
  });

  it("vendedor: solo ventas, aunque el contacto sea tambien proveedor", () => {
    const seller = access(["sales.create", "payments.manage", "purchases.view"], "vendedor");

    expect(getContactBalanceSections("ambos", seller)).toEqual(["sale"]);
    expect(getContactBalanceSections("proveedor", seller)).toEqual([]);
  });

  it("las compras exigen payments.manage y purchases.view a la vez", () => {
    expect(
      getContactBalanceSections("proveedor", access(["payments.manage"], "contador")),
    ).toEqual([]);
    expect(
      getContactBalanceSections("proveedor", access(["purchases.view", "sales.create"], "admin")),
    ).toEqual([]);
    expect(
      getContactBalanceSections(
        "proveedor",
        access(["payments.manage", "purchases.view"], "contador"),
      ),
    ).toEqual(["purchase"]);
  });

  it("sin permisos de cobro ni de pago no hay ninguna seccion", () => {
    expect(getContactBalanceSections("ambos", access(["purchases.view"], "admin"))).toEqual([]);
    expect(getContactBalanceSections("ambos", access(["payments.manage"]))).toEqual(["sale"]);
  });
});

describe("ContactBalancesTab", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let replies: Record<"purchase" | "sale", Reply>;
  let cardsLayout: boolean;
  /** Estados HTTP con los que responden los siguientes POST; el pago se guarda igual. */
  let lostPostResponses: number[];

  beforeEach(() => {
    replies = { purchase: { items: PURCHASES }, sale: { items: SALES } };
    cardsLayout = false;
    lostPostResponses = [];
    mockAuth.profile = ADMIN_PROFILE;
    window.sessionStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: cardsLayout,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url);

      // Como el servidor: el documento pagado deja de tener saldo y sale de la lista.
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        const type = body.purchaseId ? "purchase" : "sale";
        const reply = replies[type];

        if (!("error" in reply)) {
          replies[type] = {
            items: (reply.items as { id: string }[]).filter(
              (item) => item.id !== (body.purchaseId ?? body.saleId),
            ),
          };
        }

        const lostStatus = lostPostResponses.shift();

        if (lostStatus !== undefined) {
          return jsonResponse({ error: { code: "TEST", message: "ERR_RESPONSE_LOST" } }, lostStatus);
        }

        return jsonResponse({ data: { ...body, id: `pay-${body.clientRequestId}` } }, 201);
      }

      if (href.includes("/api/payments/open-documents")) {
        const type = new URL(href, "http://localhost").searchParams.get("type") as
          | "purchase"
          | "sale";
        const reply = replies[type];

        if ("error" in reply) {
          return jsonResponse({ error: { code: "TEST", message: reply.error } }, reply.status);
        }

        const items = reply.items as { pendingRef: number; pendingVes: number }[];

        return jsonResponse({
          data: {
            items,
            limit: 100,
            skip: 0,
            total: items.length,
            totals: {
              count: items.length,
              pendingRef: items.reduce((sum, item) => sum + item.pendingRef, 0),
              pendingVes: items.reduce((sum, item) => sum + item.pendingVes, 0),
              truncated: reply.truncated ?? false,
            },
          },
        });
      }

      if (href.includes("/api/settings/payment-methods")) {
        return jsonResponse({ data: { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd"] } });
      }

      if (href.includes("/api/exchange-rates/current")) {
        return jsonResponse({ data: { id: "rate-1", rateVes: 510 } });
      }

      if (href.includes("/api/sales/")) {
        return jsonResponse({
          data: {
            customer: { id: "cont-customer", name: "Maria Perez" },
            id: "sale-internal-2",
            invoiceNumber: "F-0002",
            paidVes: 0,
            refRateVes: 510,
            totalVes: 5100,
          },
        });
      }

      if (href.includes("/api/purchases/")) {
        return jsonResponse({
          data: {
            id: "purchase-internal-1",
            paidVes: 5200,
            purchaseNumber: "C-000128",
            refRateVes: 500,
            supplier: { id: "cont-both", name: "Maria Perez" },
            totalVes: 20200,
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

  function renderTab(props: Partial<ContactBalancesTabProps> = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return {
      queryClient,
      ...render(
        <QueryClientProvider client={queryClient}>
          <ContactBalancesTab
            contactId="cont-both"
            contactName="Maria Perez"
            returnHref="/contacts/cont-both"
            sections={["sale"]}
            {...props}
          />
        </QueryClientProvider>,
      ),
    };
  }

  /**
   * PAG-F8: tras cada envío las acciones del pie del modal quedan deshabilitadas
   * ~400 ms. Como haría el usuario, se pulsa el botón cuando ya está habilitado.
   */
  async function press(
    dialog: ReturnType<typeof within>,
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) {
    const button = await dialog.findByRole("button", { name });

    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
  }

  function openDocumentRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/api/payments/open-documents"))
      .map((url) => new URL(url, "http://localhost").searchParams);
  }

  it("cliente: lista las ventas por cobrar con su total y no pide compras", async () => {
    renderTab({ sections: ["sale"] });

    const section = within(screen.getByRole("region", { name: "Por cobrar" }));

    expect(await section.findByRole("link", { name: "F-0001" })).toBeInTheDocument();
    expect(section.getByRole("link", { name: "F-0002" })).toBeInTheDocument();
    expect(
      section.getByText(`${formatRefUsd(26.62)} · ${formatVesBs(13575)}`),
    ).toBeInTheDocument();
    expect(section.getByText(/en 2 ventas/)).toBeInTheDocument();
    // Total, pagado y saldo de la primera venta.
    const row = within(section.getByRole("link", { name: "F-0001" }).closest("tr")!);
    expect(row.getByText(formatVesBs(11475))).toBeInTheDocument();
    expect(row.getByText(formatVesBs(3000))).toBeInTheDocument();
    expect(row.getByText(formatRefUsd(16.62))).toBeInTheDocument();
    expect(row.getByText(formatVesBs(8475))).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Por pagar" })).not.toBeInTheDocument();
    const requests = openDocumentRequests();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((params) => params.get("type") === "sale")).toBe(true);
    expect(requests.every((params) => params.get("contactId") === "cont-both")).toBe(true);
  });

  it("proveedor: lista las compras por pagar y no pide ventas", async () => {
    renderTab({ sections: ["purchase"] });

    const section = within(screen.getByRole("region", { name: "Por pagar" }));

    expect(await section.findByRole("link", { name: "#C-000128" })).toBeInTheDocument();
    expect(section.getByText(`${formatRefUsd(30)} · ${formatVesBs(15000)}`)).toBeInTheDocument();
    expect(section.getByText(/en 1 compra$/)).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Pagar #C-000128" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Por cobrar" })).not.toBeInTheDocument();
    expect(openDocumentRequests().every((params) => params.get("type") === "purchase")).toBe(true);
  });

  it("contacto de ambos tipos: pinta las dos secciones", async () => {
    renderTab({ sections: ["sale", "purchase"] });

    expect(
      await within(screen.getByRole("region", { name: "Por cobrar" })).findByRole("link", {
        name: "F-0001",
      }),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole("region", { name: "Por pagar" })).findByRole("link", {
        name: "#C-000128",
      }),
    ).toBeInTheDocument();
  });

  it("enlaza cada documento a su detalle con returnTo al contacto y no muestra ids internos", async () => {
    const { container } = renderTab({ sections: ["sale", "purchase"] });

    expect(await screen.findByRole("link", { name: "F-0001" })).toHaveAttribute(
      "href",
      "/sales/sale-internal-1?returnTo=%2Fcontacts%2Fcont-both",
    );
    expect(await screen.findByRole("link", { name: "#C-000128" })).toHaveAttribute(
      "href",
      "/purchases/purchase-internal-1?returnTo=%2Fcontacts%2Fcont-both",
    );
    expect(container.textContent).not.toMatch(/sale-internal|purchase-internal|cont-both/);
  });

  it("a 390 px pinta tarjetas con el documento enlazado y su accion", async () => {
    cardsLayout = true;
    renderTab({ sections: ["sale"] });

    expect(await screen.findByRole("link", { name: "F-0001" })).toHaveAttribute(
      "href",
      "/sales/sale-internal-1?returnTo=%2Fcontacts%2Fcont-both",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar F-0001" })).toBeInTheDocument();
  });

  it("sin documentos: estado vacio y sin boton Abonar", async () => {
    replies.sale = { items: [] };
    renderTab({ sections: ["sale"] });

    expect(await screen.findByText("Sin saldos pendientes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abonar" })).not.toBeInTheDocument();
  });

  it("error: muestra el mensaje del servidor y reintenta", async () => {
    replies.sale = { error: "No se pudo leer los saldos.", status: 500 };
    renderTab({ sections: ["sale"] });

    expect(await screen.findByText("No se pudo leer los saldos.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abonar" })).not.toBeInTheDocument();

    replies.sale = { items: SALES };
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("link", { name: "F-0001" })).toBeInTheDocument();
  });

  it("avisa cuando el servidor trunco la lectura", async () => {
    replies.sale = { items: SALES, truncated: true };
    renderTab({ sections: ["sale"] });

    expect(await screen.findByRole("status")).toHaveTextContent(
      /la lista y el total pueden estar incompletos/,
    );
  });

  it("Abonar abre el modal de abono con el contacto y el tipo de la seccion", async () => {
    const user = userEvent.setup();
    renderTab({ sections: ["sale", "purchase"] });

    const payable = within(screen.getByRole("region", { name: "Por pagar" }));
    await payable.findByRole("link", { name: "#C-000128" });
    await user.click(payable.getByRole("button", { name: "Abonar" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));

    expect((await dialog.findAllByText(/Maria Perez/)).length).toBeGreaterThan(0);
    // Lo abonable es el saldo de las compras del contacto (Bs 15.000), no el de sus ventas.
    expect(
      await dialog.findByText(
        (_content, element) => element?.textContent === `Máximo: ${formatVesBs(15000)}`,
      ),
    ).toBeInTheDocument();
    expect(
      openDocumentRequests().every((params) => params.get("contactId") === "cont-both"),
    ).toBe(true);
  });

  it("Abonar de las ventas abre el abono de las ventas por cobrar", async () => {
    const user = userEvent.setup();
    renderTab({ sections: ["sale", "purchase"] });

    const receivable = within(screen.getByRole("region", { name: "Por cobrar" }));
    await receivable.findByRole("link", { name: "F-0001" });
    await user.click(receivable.getByRole("button", { name: "Abonar" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));

    expect(
      await dialog.findByText(
        (_content, element) => element?.textContent === `Máximo: ${formatVesBs(13575)}`,
      ),
    ).toBeInTheDocument();
  });

  it("Cobrar de una fila abre el modal de pago de ese documento", async () => {
    const user = userEvent.setup();
    renderTab({ sections: ["sale"] });

    await user.click(await screen.findByRole("button", { name: "Cobrar F-0002" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Cobrar saldo" }));

    await dialog.findByText(/Saldo pendiente actual/);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/sales/sale-internal-2")),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/sales/sale-internal-1")),
    ).toBe(false);
  });

  it("Pagar de una fila abre el modal de pago de esa compra", async () => {
    const user = userEvent.setup();
    renderTab({ sections: ["purchase"] });

    await user.click(await screen.findByRole("button", { name: "Pagar #C-000128" }));

    expect(await screen.findByRole("dialog", { name: "Pagar compra" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/api/purchases/purchase-internal-1"),
        ),
      ).toBe(true),
    );
  });

  // PAG-F4 A: saldar todo vacía la lista de la sección; el modal no puede irse con ella.
  it.each([
    { payments: 2, section: "Por cobrar", type: "sale" },
    { payments: 1, section: "Por pagar", type: "purchase" },
  ] as const)(
    "Abonar todo lo pendiente ($section): el modal sigue abierto con el resultado aunque la lista quede vacia",
    async ({ payments, section, type }) => {
      const user = userEvent.setup();
      renderTab({ sections: [type] });

      const region = within(screen.getByRole("region", { name: section }));
      await user.click(await region.findByRole("button", { name: "Abonar" }));

      const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));
      const complete = await dialog.findByRole("button", { name: "Completar total pendiente" });
      await waitFor(() => expect(complete).toBeEnabled());
      await user.click(complete);
      await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
      await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));

      // La lista de la pestaña ya se refrescó sin documentos...
      expect(await region.findByText("Sin saldos pendientes")).toBeInTheDocument();
      // ...y el modal sigue ahí, con su resultado.
      expect(screen.getByRole("dialog", { name: "Abonar" })).toBeInTheDocument();
      expect(
        dialog.getByText(new RegExp(`Abono registrado: ${payments} pagos? por`)),
      ).toBeInTheDocument();

      // Al cerrarlo, sin saldos no queda botón para abonar.
      await press(dialog, user, "Cerrar");
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Abonar" })).not.toBeInTheDocument(),
      );
      expect(screen.queryByRole("button", { name: "Abonar" })).not.toBeInTheDocument();
    },
  );

  // PAG-F7 U1: el pago se guardó pero la respuesta se perdió. La lista se refresca
  // (queda vacía) y "Abonar" tiene que seguir ahí para confirmar ese abono.
  it("abono por confirmar: Saldos se refresca tras el fallo y «Abonar» sigue montado, abre en ese abono y no duplica", async () => {
    const user = userEvent.setup();

    replies.sale = { items: [SALES[1]] };
    lostPostResponses = [500];
    renderTab({ sections: ["sale"] });

    const region = within(screen.getByRole("region", { name: "Por cobrar" }));

    await user.click(await region.findByRole("button", { name: "Abonar" }));

    let dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));
    const complete = await dialog.findByRole("button", { name: "Completar total pendiente" });

    await waitFor(() => expect(complete).toBeEnabled());
    await user.click(complete);
    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));
    await dialog.findByRole("alert");

    // Saldos ya muestra el saldo real: el pago entró y la venta salió de la lista.
    expect(await region.findByText("Sin saldos pendientes")).toBeInTheDocument();

    await press(dialog, user, "Cerrar");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Abonar" })).not.toBeInTheDocument(),
    );

    await user.click(region.getByRole("button", { name: "Abonar" }));
    dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));

    expect(dialog.queryByLabelText("Monto")).not.toBeInTheDocument();
    await press(dialog, user, "Reintentar pendientes");
    expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();

    const keys = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      .map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { clientRequestId: string }).clientRequestId);

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);

    // Resuelto y sin saldos: al cerrar ya no queda nada que abonar.
    await press(dialog, user, "Cerrar");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Abonar" })).not.toBeInTheDocument(),
    );
  });

  it("abono por confirmar guardado: tras recargar, «Abonar» está aunque la lista venga vacía", async () => {
    const user = userEvent.setup();

    replies.sale = { items: [SALES[1]] };
    lostPostResponses = [500];

    const first = renderTab({ sections: ["sale"] });

    await user.click(await screen.findByRole("button", { name: "Abonar" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));
    const complete = await dialog.findByRole("button", { name: "Completar total pendiente" });

    await waitFor(() => expect(complete).toBeEnabled());
    await user.click(complete);
    await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
    await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));
    await dialog.findByRole("alert");
    first.unmount();

    renderTab({ sections: ["sale"] });

    expect(await screen.findByText("Sin saldos pendientes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abonar" }));
    expect(
      await within(await screen.findByRole("dialog", { name: "Abonar" })).findByRole("button", {
        name: "Reintentar pendientes",
      }),
    ).toBeEnabled();
  });

  describe("PAG-F8: aviso de abono por confirmar", () => {
    const NOTICE = /Hay un abono por confirmar/;

    async function leaveUnconfirmedSettlement(user: ReturnType<typeof userEvent.setup>) {
      replies.sale = { items: [SALES[1]] };
      lostPostResponses = [500];

      const view = renderTab({ sections: ["sale"] });

      await user.click(await screen.findByRole("button", { name: "Abonar" }));

      const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));
      const complete = await dialog.findByRole("button", { name: "Completar total pendiente" });

      await waitFor(() => expect(complete).toBeEnabled());
      await user.click(complete);
      await user.click(dialog.getByRole("button", { name: "Ver reparto" }));
      await user.click(dialog.getByRole("button", { name: "Confirmar abono" }));
      await dialog.findByRole("alert");

      return { dialog, view };
    }

    it("sin abono por confirmar no hay aviso", async () => {
      renderTab({ sections: ["sale"] });

      expect(await screen.findByRole("link", { name: "F-0001" })).toBeInTheDocument();
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it("tras recargar avisa en la pestaña y su botón abre el modal en ese abono; resuelto, el aviso se va", async () => {
      const user = userEvent.setup();
      const { view } = await leaveUnconfirmedSettlement(user);

      view.unmount();
      renderTab({ sections: ["sale"] });

      const region = within(screen.getByRole("region", { name: "Por cobrar" }));
      const notice = await region.findByText(NOTICE);

      expect(notice.closest('[role="status"]')).not.toBeNull();
      await user.click(region.getByRole("button", { name: "Revisar abono" }));

      const dialog = within(await screen.findByRole("dialog", { name: "Abonar" }));

      expect(dialog.queryByLabelText("Monto")).not.toBeInTheDocument();
      // Con el modal abierto el aviso sobra.
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

      await press(dialog, user, "Reintentar pendientes");
      expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
      await press(dialog, user, "Cerrar");
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Abonar" })).not.toBeInTheDocument(),
      );
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it("al cerrar el modal con el abono por confirmar el aviso aparece sin recargar", async () => {
      const user = userEvent.setup();
      const { dialog } = await leaveUnconfirmedSettlement(user);

      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      await press(dialog, user, "Cerrar");

      expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    });

    it("otro usuario en la misma pestaña no ve el aviso ni el abono", async () => {
      const user = userEvent.setup();
      const { view } = await leaveUnconfirmedSettlement(user);

      view.unmount();
      mockAuth.profile = { storeId: "store-1", user: { id: "user-seller" } };
      renderTab({ sections: ["sale"] });

      expect(await screen.findByText("Sin saldos pendientes")).toBeInTheDocument();
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Abonar" })).not.toBeInTheDocument();
    });
  });

  it("Cobrar de una fila: si el documento sale de la lista con el modal abierto, el modal no se desmonta", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderTab({ sections: ["sale"] });

    await user.click(await screen.findByRole("button", { name: "Cobrar F-0002" }));
    const dialog = await screen.findByRole("dialog", { name: "Cobrar saldo" });

    replies.sale = { items: [] };
    await act(() => queryClient.invalidateQueries({ queryKey: ["payments"] }));

    expect(await screen.findByText("Sin saldos pendientes")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Cobrar saldo" })).toBe(dialog);
  });
});
