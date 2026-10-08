/**
 * PAG-01 · pagar una compra desde su detalle: la accion primaria «Pagar» abre el
 * modal de pago sin navegar, en tres clics queda registrado y el saldo y el
 * historial se refrescan sin recargar.
 *
 * PAG-F2 · «Volver» regresa a la lista de origen que viaja en `returnTo`.
 *
 * PRO-10 · el detalle de compra monta el aviso de reprecio con el id de la compra cargada.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRouterPush = jest.fn();
/** Query de la URL del detalle, la que lee «Volver». */
let mockSearch = "";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/purchase-pag01",
  useRouter: () => ({ back: jest.fn(), push: mockRouterPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aqui.
jest.mock("./services/exportPurchaseDetailPdf", () => ({
  exportPurchaseDetailPdf: jest.fn(),
}));

// PRO-10: el aviso tiene su propia suite; aqui solo importa que se monte y con que compra.
jest.mock("../../products/components/price-review/PurchaseRepriceNotice", () => ({
  PurchaseRepriceNotice: ({ purchaseId }: { purchaseId: string }) => (
    <div data-purchase-id={purchaseId} data-testid="purchase-reprice-notice" />
  ),
}));

import { authQueryKeys } from "@/modules/auth/hooks/useCurrentUser";
import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { type Permission, type UserRole, getRolePermissions } from "@/shared/auth/permissions";
import type { PaymentMock } from "@/shared/mocks/erp-data";
import { formatVes } from "@/shared/utils/currency";

import type { PurchaseDetails } from "../hooks/usePurchases";
import { PurchaseDetailsPage } from "./page";

const RATE_VES = 500;
const PURCHASE: PurchaseDetails = {
  createdAt: "2026-10-06T13:32:00.000Z",
  discountRef: 0,
  id: "purchase-pag01",
  items: [],
  paidRef: 0,
  paidVes: 0,
  payments: [],
  purchaseNumber: "C-20261006-000007",
  refRateVes: RATE_VES,
  status: "recibido",
  subtotalRef: 40,
  supplier: {
    id: "cont-supplier",
    name: "Distribuidora Polar",
  } as PurchaseDetails["supplier"],
  supplierId: "cont-supplier",
  taxRef: 0,
  totalRef: 40,
  totalVes: 20000,
  userId: "user-admin",
};

type Session = { permissions?: readonly Permission[]; role: UserRole };

/**
 * API de prueba con estado: POST /api/payments abona la compra, de modo que el
 * GET que dispara la invalidacion devuelve ya el saldo y el historial nuevos.
 */
function installApi(
  initial: Partial<PurchaseDetails>,
  session: Session,
  options: { postFailsAfterSaving?: string } = {},
) {
  let purchase: PurchaseDetails = { ...PURCHASE, ...initial };
  const posts: Array<{ body: Record<string, unknown>; url: string }> = [];
  let purchaseGets = 0;

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const amountVes = Number(body.amount);
      const payment: PaymentMock = {
        amount: amountVes,
        amountRef: amountVes / RATE_VES,
        amountVes,
        contactId: purchase.supplierId,
        createdAt: "2026-10-07T15:00:00.000Z",
        currency: "VES",
        direction: "salida",
        id: `pay-${posts.length + 1}`,
        method: "efectivo_ves",
        purchaseId: purchase.id,
        refRateVes: RATE_VES,
      };

      posts.push({ body, url });
      purchase = {
        ...purchase,
        paidRef: (purchase.paidRef ?? 0) + payment.amountRef,
        paidVes: purchase.paidVes + amountVes,
        payments: [...purchase.payments, payment],
      };

      // Resultado incierto: el pago quedo guardado pero la respuesta es un 500.
      if (options.postFailsAfterSaving) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: "INTERNAL_ERROR", message: options.postFailsAfterSaving } },
            500,
          ),
        );
      }

      return Promise.resolve(
        jsonResponse(
          { data: { ...payment, pendingBalanceVes: purchase.totalVes - purchase.paidVes } },
          201,
        ),
      );
    }

    if (url === `/api/purchases/${PURCHASE.id}`) {
      purchaseGets += 1;

      return Promise.resolve(jsonResponse({ data: purchase }));
    }

    if (url.includes("/api/auth/me")) {
      return Promise.resolve(
        jsonResponse({
          data: {
            permissions: session.permissions ?? getRolePermissions(session.role),
            role: session.role,
          },
        }),
      );
    }

    if (url.includes("/api/settings/payment-methods")) {
      return Promise.resolve(
        jsonResponse({ data: { enabledPaymentMethods: ["efectivo_ves", "pago_movil"] } }),
      );
    }

    return Promise.resolve(jsonResponse({ data: null }));
  }) as unknown as typeof fetch;

  return { posts, purchaseGets: () => purchaseGets };
}

/** Pinta el detalle y espera a la compra y a los permisos: sin ellos no hay boton. */
async function renderPage(
  initial: Partial<PurchaseDetails> = {},
  session: Session = { role: "admin" },
  options: { postFailsAfterSaving?: string } = {},
) {
  const api = installApi(initial, session, options);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <PurchaseDetailsPage purchaseId={PURCHASE.id} />
    </QueryClientProvider>,
  );

  await screen.findByRole("heading", { name: /C-20261006-000007/ });
  await waitFor(() =>
    expect(queryClient.getQueryState(authQueryKeys.me())?.status).toBe("success"),
  );

  return { ...api, user: userEvent.setup() };
}

/** El importe lleva espacios duros: se compara con los espacios normalizados. */
function modalBalance(amountVes: number) {
  const expected = `Saldo pendiente actual: ${formatVes(amountVes)}`.replace(/s+/g, " ");

  return (_content: string, element: Element | null) =>
    element?.tagName === "P" && element.textContent?.replace(/s+/g, " ").trim() === expected;
}

function payButton() {
  return screen.queryByRole("button", { name: "Pagar" });
}

beforeEach(() => {
  mockRouterPush.mockReset();
});

describe("PurchaseDetailsPage · Pagar (PAG-01)", () => {
  describe("visibilidad de «Pagar»", () => {
    it.each<UserRole>(["admin", "contador"])("%s con saldo pendiente lo ve", async (role) => {
      await renderPage({}, { role });

      expect(payButton()).toBeInTheDocument();
    });

    it("va en la cabecera, antes del menu de acciones", async () => {
      await renderPage();

      const header = screen.getByRole("heading", { name: /C-20261006-000007/ }).closest("header");
      const pay = within(header as HTMLElement).getByRole("button", { name: "Pagar" });
      const menu = within(header as HTMLElement).getByRole("button", { name: /^Acciones de/ });

      expect(pay.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("PAG-03b: el menu de acciones ya no ofrece «Registrar pago» ni lleva a /payments", async () => {
      const { user } = await renderPage();

      await user.click(screen.getByRole("button", { name: /^Acciones de/ }));

      const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);

      expect(items).toContain("Descargar PDF");
      expect(items).not.toContain("Registrar pago");
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("sin saldo pendiente no aparece", async () => {
      await renderPage({ paidRef: 40, paidVes: 20000 });

      expect(payButton()).not.toBeInTheDocument();
    });

    it.each(["cancelado", "devuelto"] as const)(
      "compra en estado %s: no aparece aunque quede saldo",
      async (status) => {
        await renderPage({ status });

        expect(payButton()).not.toBeInTheDocument();
      },
    );

    it("vendedor no lo ve", async () => {
      await renderPage({}, { role: "vendedor" });

      expect(payButton()).not.toBeInTheDocument();
    });

    it("vendedor con payments.manage concedido tampoco: el BFF le niega pagos de compra", async () => {
      await renderPage(
        {},
        { permissions: [...getRolePermissions("vendedor"), "payments.manage"], role: "vendedor" },
      );

      expect(payButton()).not.toBeInTheDocument();
    });

    it("sin payments.manage no aparece", async () => {
      await renderPage(
        {},
        {
          permissions: getRolePermissions("admin").filter(
            (permission) => permission !== "payments.manage",
          ),
          role: "admin",
        },
      );

      expect(payButton()).not.toBeInTheDocument();
    });
  });

  it("abre el modal de la compra con su saldo, sin navegar", async () => {
    const { posts, user } = await renderPage({ paidRef: 10, paidVes: 5000 });

    await user.click(screen.getByRole("button", { name: "Pagar" }));

    const dialog = await screen.findByRole("dialog", { name: "Pagar compra" });

    expect(
      await within(dialog).findByText(modalBalance(15000)),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Compra C-20261006-000007 a Distribuidora Polar."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^ID /)).not.toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it("tres clics saldan la compra: se cierra el modal, se refresca el detalle y «Pagar» desaparece", async () => {
    const { posts, purchaseGets, user } = await renderPage();
    const getsBefore = purchaseGets();

    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("No hay pagos registrados para esta compra.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pagar" }));
    await user.click(await screen.findByRole("button", { name: "Completar saldo" }));
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(posts).toEqual([
      {
        body: {
          amount: 20000,
          clientRequestId: expect.any(String),
          currency: "VES",
          method: "efectivo_ves",
          purchaseId: PURCHASE.id,
        },
        url: "/api/payments",
      },
    ]);

    // Estado de pago e historial salen del GET que dispara la invalidacion.
    expect(await screen.findByText("Pagado")).toBeInTheDocument();
    expect(screen.queryByText("Pendiente")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No hay pagos registrados para esta compra."),
    ).not.toBeInTheDocument();
    expect(purchaseGets()).toBeGreaterThan(getsBefore);
    expect(payButton()).not.toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("abono parcial: el modal sigue abierto con el saldo que resta y el detalle se refresca", async () => {
    const { posts, user } = await renderPage();

    await user.click(screen.getByRole("button", { name: "Pagar" }));

    const dialog = await screen.findByRole("dialog", { name: "Pagar compra" });

    await within(dialog).findByText(modalBalance(20000));
    await user.type(within(dialog).getByLabelText("Monto"), "5000");
    await user.click(within(dialog).getByRole("button", { name: "Registrar pago" }));

    expect(
      await within(dialog).findByText(modalBalance(15000)),
    ).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ amount: 5000, purchaseId: PURCHASE.id });
    expect(await screen.findByText("Pago parcial")).toBeInTheDocument();
    expect(
      screen.queryByText("No hay pagos registrados para esta compra."),
    ).not.toBeInTheDocument();
    // Con el modal abierto la pagina queda fuera del arbol accesible.
    expect(screen.getByRole("button", { hidden: true, name: "Pagar" })).toBeInTheDocument();
  });
});

describe("PurchaseDetailsPage · pago de resultado incierto (PAG-F3)", () => {
  it("si el pago quedo guardado y saldo la compra, el modal sigue montado con el error y «Pagar» desaparece", async () => {
    const message = "Fallo interno al confirmar el pago";
    const { posts, user } = await renderPage(
      {},
      { role: "admin" },
      { postFailsAfterSaving: message },
    );

    await user.click(screen.getByRole("button", { name: "Pagar" }));
    await user.click(await screen.findByRole("button", { name: "Completar saldo" }));
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    // El re-pedido tras el 500 trae la compra ya saldada.
    expect(await screen.findByText("Pagado", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(posts).toHaveLength(1);

    const dialog = screen.getByRole("dialog", { name: "Pagar compra" });

    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("button", { hidden: true, name: "Pagar" })).not.toBeInTheDocument();

    // Al cerrarlo ya no queda nada que pagar: el modal se desmonta.
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(payButton()).not.toBeInTheDocument();
  });
});

describe("PurchaseDetailsPage · «Volver» (PAG-F2)", () => {
  const PAYMENTS_LIST = "/payments?from=2026-05-01&method=pago_movil";

  afterEach(() => {
    mockSearch = "";
  });

  async function backHref(search: string) {
    mockSearch = search;
    await renderPage();

    return screen.getByRole("link", { name: "Volver" }).getAttribute("href");
  }

  it("con returnTo vuelve a la URL exacta de la lista de origen", async () => {
    expect(await backHref(`returnTo=${encodeURIComponent(PAYMENTS_LIST)}`)).toBe(PAYMENTS_LIST);
  });

  it("sin returnTo vuelve al listado de compras", async () => {
    expect(await backHref("")).toBe("/purchases");
  });

  it.each(["https://evil.example/payments", "//evil.example", "/api/payments"])(
    "no sigue un returnTo que no es una ruta interna segura (%s)",
    async (returnTo) => {
      expect(await backHref(`returnTo=${encodeURIComponent(returnTo)}`)).toBe("/purchases");
    },
  );
});

// PAG-F6 U2: un re-pedido fallido sustituia todo el detalle (y el modal de pago abierto)
// por la pantalla de error, aunque la compra ya estuviera cargada.
describe("PurchaseDetailsPage · re-pedido fallido (PAG-F6 U2)", () => {
  const serverFailure = () =>
    Promise.resolve(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo interno." } }, 500),
    );

  it("con la compra cargada, si al abrir «Pagar» la compra responde 500 el detalle y el modal siguen en pantalla", async () => {
    const { user } = await renderPage();
    const working = global.fetch;

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === `/api/purchases/${PURCHASE.id}` ? serverFailure() : working(input, init),
    ) as unknown as typeof fetch;

    await user.click(screen.getByRole("button", { name: "Pagar" }));

    const dialog = await screen.findByRole("dialog", { name: "Pagar compra" });

    expect(
      await within(dialog).findByText(/No se pudo comprobar el saldo pendiente/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Pagar compra" })).toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar la compra")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { hidden: true, name: /C-20261006-000007/ }),
    ).toBeInTheDocument();
  });

  it("sin compra cargada sigue mostrando la pantalla de error", async () => {
    global.fetch = jest.fn(serverFailure) as unknown as typeof fetch;

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PurchaseDetailsPage purchaseId={PURCHASE.id} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("No pudimos cargar la compra")).toBeInTheDocument();
    expect(screen.getByText("Fallo interno.")).toBeInTheDocument();
  });
});

describe("PurchaseDetailsPage · aviso de reprecio (PRO-10)", () => {
  it("monta el aviso con el id de la compra", async () => {
    await renderPage();

    expect(screen.getByTestId("purchase-reprice-notice")).toHaveAttribute(
      "data-purchase-id",
      PURCHASE.id,
    );
  });

  it("no lo monta mientras la compra carga ni si falla", async () => {
    installApi({}, { role: "admin" });
    const { unmount } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PurchaseDetailsPage purchaseId={PURCHASE.id} />
      </QueryClientProvider>,
    );

    // Primer pintado: la compra todavia no llego.
    expect(screen.queryByRole("heading", { name: /C-20261006-000007/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("purchase-reprice-notice")).not.toBeInTheDocument();
    unmount();

    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500)),
    ) as unknown as typeof fetch;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PurchaseDetailsPage purchaseId={PURCHASE.id} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("No pudimos cargar la compra")).toBeInTheDocument();
    expect(screen.queryByTestId("purchase-reprice-notice")).not.toBeInTheDocument();
  });
});
