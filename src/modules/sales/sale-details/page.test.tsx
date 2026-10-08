/**
 * STK-607 · el rechazo de una accion del detalle (anular / devolver) debe quedar
 * a la vista en el momento del fallo: junto a la cabecera, que es donde esta el
 * menu «Acciones», y no al final de la pagina (bajo el pliegue).
 *
 * PAG-02 · «Cobrar saldo» en la cabecera abre el modal de cobro sin salir del
 * detalle; solo aparece si la venta admite cobros y el usuario puede registrarlos.
 *
 * PAG-F2 · «Volver» regresa a la lista de origen que viaja en `returnTo`.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission } from "@/shared/auth/permissions";

let mockPermissions: Permission[] = [];
/** Query de la URL del detalle, la que lee «Volver». */
let mockSearch = "";
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("next/navigation", () => ({
  usePathname: () => "/sales/sale-stk607",
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockPermissions.includes(permission),
  }),
}));

// jspdf necesita TextEncoder, que jsdom no trae; el PDF no interviene aqui.
jest.mock("./services/exportSaleInvoicePdf", () => ({
  exportSaleInvoicePdf: jest.fn(),
}));

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import type { SaleDetail } from "../hooks/useSales";
import { SaleDetailsPage } from "./page";

const PAID_SALE: SaleDetail = {
  createdAt: "2026-10-06T13:32:00.000Z",
  customerId: "cont-customer",
  discountRef: 0,
  id: "sale-stk607",
  invoiceNumber: "V-20261006-000013",
  items: [],
  paidVes: 2617.18,
  payments: [],
  refRateVes: 872.39,
  status: "pagada",
  subtotalRef: 3,
  taxRef: 0,
  totalRef: 3,
  totalVes: 2617.18,
  userId: "user-seller",
};

const CANCEL_REJECTION =
  "La venta V-20261006-000013 tiene 1 pago(s) activo(s) por Bs 2617.18. Anula primero los pagos y luego cancela la venta.";
const RETURN_REJECTION = "La venta V-20261006-000013 ya no tiene unidades por devolver.";

function installSaleApi() {
  const mutations: Array<{ method: string; url: string }> = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET") {
      return Promise.resolve(
        jsonResponse({ data: url === `/api/sales/${PAID_SALE.id}` ? PAID_SALE : {} }),
      );
    }

    mutations.push({ method, url });

    return Promise.resolve(
      jsonResponse(
        {
          error: {
            code: "CONFLICT",
            message: url.endsWith("/cancel") ? CANCEL_REJECTION : RETURN_REJECTION,
          },
        },
        409,
      ),
    );
  }) as unknown as typeof fetch;

  return mutations;
}

async function confirmAction(menuItem: string, confirmLabel: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Acciones de la venta" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: menuItem }));
  fireEvent.click(await screen.findByRole("button", { name: confirmLabel }));
}

/** El aviso va despues de la cabecera y antes de cualquier tarjeta del detalle. */
function expectRightBelowHeader(message: HTMLElement) {
  const header = screen.getByRole("heading", { level: 1 });
  const firstCard = screen.getByText("Historial de Pagos");

  expect(header.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(message.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    message.compareDocumentPosition(screen.getByText("Total (VES)")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

describe("SaleDetailsPage · errores de las acciones (STK-607)", () => {
  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
  });

  it("anular una venta pagada: el 409 se muestra junto a la cabecera, no al final", async () => {
    const mutations = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await confirmAction("Anular venta", "Anular venta");

    const message = await screen.findByText(CANCEL_REJECTION);

    expect(mutations).toEqual([{ method: "PATCH", url: `/api/sales/${PAID_SALE.id}/cancel` }]);
    expect(screen.getByText("No pudimos actualizar la venta")).toBeInTheDocument();
    expect(screen.getByText("Pagada")).toBeInTheDocument();
    expectRightBelowHeader(message);
  });

  it("devolucion rechazada: mismo aviso, mismo sitio", async () => {
    const mutations = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await confirmAction("Devolucion", "Registrar devolucion");

    const message = await screen.findByText(RETURN_REJECTION);

    expect(mutations).toEqual([{ method: "POST", url: `/api/sales/${PAID_SALE.id}/return` }]);
    expectRightBelowHeader(message);
  });
});

const PENDING_SALE: SaleDetail = {
  ...PAID_SALE,
  id: "sale-pag02",
  invoiceNumber: "V-20261007-000021",
  paidVes: 1000,
  status: "pendiente_pago",
  totalVes: 2600,
};

type PostedPayment = { amount: number; currency?: string; method: string; saleId?: string };

/** API con estado: cada cobro sube lo pagado de la venta y queda en su historial. */
function installCollectApi(initialSale: SaleDetail) {
  let sale = initialSale;
  const posted: PostedPayment[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST" && url === "/api/payments") {
      const body = JSON.parse(String(init.body)) as PostedPayment;
      const paidVes = sale.paidVes + body.amount;
      const payment: SaleDetail["payments"][number] = {
        amount: body.amount,
        amountRef: body.amount / sale.refRateVes,
        amountVes: body.amount,
        contactId: sale.customerId,
        createdAt: "2026-10-07T15:00:00.000Z",
        direction: "entrada",
        id: `pay-${posted.length + 1}`,
        method: "efectivo_ves",
        refRateVes: sale.refRateVes,
        saleId: sale.id,
      };

      posted.push(body);
      sale = {
        ...sale,
        paidVes,
        payments: [...sale.payments, payment],
        status: paidVes >= sale.totalVes ? "pagada" : "pendiente_pago",
      };

      return Promise.resolve(
        jsonResponse({ data: { ...payment, pendingBalanceVes: sale.totalVes - paidVes } }, 201),
      );
    }

    if (url === `/api/sales/${sale.id}`) {
      return Promise.resolve(jsonResponse({ data: sale }));
    }

    if (url.includes("/api/settings/payment-methods")) {
      return Promise.resolve(
        jsonResponse({ data: { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd"] } }),
      );
    }

    return Promise.resolve(jsonResponse({ data: {} }));
  }) as unknown as typeof fetch;

  return posted;
}

async function renderSale(sale: SaleDetail) {
  const posted = installCollectApi(sale);

  render(<SaleDetailsPage saleId={sale.id} />, { wrapper: createQueryWrapper() });
  await screen.findByRole("heading", { level: 1 });

  return posted;
}

function collectButton() {
  return screen.queryByRole("button", { name: "Cobrar saldo" });
}

async function openCollectModal() {
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Cobrar saldo" }));

  const dialog = await screen.findByRole("dialog", { name: "Cobrar saldo" });

  await within(dialog).findByText(/Saldo pendiente actual/);

  return { dialog: within(dialog), user };
}

describe("SaleDetailsPage · cobrar saldo (PAG-02)", () => {
  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
  });

  it.each<[string, Permission[]]>([
    ["payments.manage", ["payments.manage"]],
    ["sales.create", ["sales.create"]],
  ])("con saldo pendiente y %s muestra «Cobrar saldo» en la cabecera", async (_name, permissions) => {
    mockPermissions = permissions;
    await renderSale(PENDING_SALE);

    const header = screen.getByRole("heading", { level: 1 }).closest("header");

    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Cobrar saldo" }),
    ).toBeInTheDocument();
  });

  it.each<[string, SaleDetail]>([
    ["sin saldo", PAID_SALE],
    ["anulada", { ...PENDING_SALE, status: "cancelada" }],
    ["devuelta", { ...PENDING_SALE, status: "devuelta" }],
    ["en borrador", { ...PENDING_SALE, status: "borrador" }],
  ])("venta %s: no ofrece «Cobrar saldo»", async (_name, sale) => {
    await renderSale(sale);

    expect(collectButton()).not.toBeInTheDocument();
  });

  it("sin payments.manage ni sales.create no ofrece «Cobrar saldo»", async () => {
    mockPermissions = ["sales.view", "payments.view"];
    await renderSale(PENDING_SALE);

    expect(screen.getByText("Saldo Pendiente VES")).toBeInTheDocument();
    expect(collectButton()).not.toBeInTheDocument();
  });

  it("el menu «Acciones» ya no manda a /payments para cobrar", async () => {
    await renderSale(PENDING_SALE);

    fireEvent.click(screen.getByRole("button", { name: "Acciones de la venta" }));

    expect(await screen.findByRole("menuitem", { name: "Imprimir factura" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Registrar pago" })).not.toBeInTheDocument();
  });

  it("abre el modal de cobro con la venta y su saldo, sin navegar", async () => {
    const posted = await renderSale(PENDING_SALE);
    const { dialog } = await openCollectModal();

    expect(dialog.getByText("Venta V-20261007-000021.")).toBeInTheDocument();
    expect(dialog.getByText(/Saldo pendiente actual:.*1\.600,00/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Registrar cobro" })).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  it("cobrar el saldo completo cierra el modal, refresca resumen y pagos y quita el boton", async () => {
    const posted = await renderSale(PENDING_SALE);

    expect(screen.getByText("No hay pagos registrados para esta venta.")).toBeInTheDocument();

    const { dialog, user } = await openCollectModal();

    await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
    await user.click(dialog.getByRole("button", { name: "Registrar cobro" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(collectButton()).not.toBeInTheDocument());

    expect(posted).toEqual([
      expect.objectContaining({ amount: 1600, method: "efectivo_ves", saleId: PENDING_SALE.id }),
    ]);
    expect(screen.queryByText("Saldo Pendiente VES")).not.toBeInTheDocument();
    expect(screen.queryByText("No hay pagos registrados para esta venta.")).not.toBeInTheDocument();
    expect(screen.getByText("Pagada")).toBeInTheDocument();
  });

  it("un abono parcial deja el modal abierto y el detalle con el saldo que queda", async () => {
    const posted = await renderSale(PENDING_SALE);
    const { dialog, user } = await openCollectModal();

    await user.type(dialog.getByLabelText("Monto"), "600");
    await user.click(dialog.getByRole("button", { name: "Registrar cobro" }));

    expect(
      await dialog.findByText(/Pago registrado\. Saldo pendiente:.*1\.000,00/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Saldo Pendiente VES").parentElement).toHaveTextContent("1.000,00"),
    );

    expect(posted).toEqual([expect.objectContaining({ amount: 600, saleId: PENDING_SALE.id })]);
    expect(screen.queryByText("No hay pagos registrados para esta venta.")).not.toBeInTheDocument();
    // Con el modal abierto el fondo queda fuera del arbol accesible.
    expect(
      screen.getByRole("button", { hidden: true, name: "Cobrar saldo" }),
    ).toBeInTheDocument();
  });
});

describe("SaleDetailsPage · «Volver» (PAG-F2)", () => {
  const PAYMENTS_LIST = "/payments?from=2026-05-01&method=pago_movil";

  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
  });

  afterEach(() => {
    mockSearch = "";
  });

  async function backHref(search: string) {
    mockSearch = search;
    await renderSale(PAID_SALE);

    return screen.getByRole("link", { name: "Volver" }).getAttribute("href");
  }

  it("con returnTo vuelve a la URL exacta de la lista de origen", async () => {
    expect(await backHref(`returnTo=${encodeURIComponent(PAYMENTS_LIST)}`)).toBe(PAYMENTS_LIST);
  });

  it("sin returnTo vuelve al listado de ventas", async () => {
    expect(await backHref("")).toBe("/sales");
  });

  it.each(["https://evil.example/payments", "//evil.example", "/api/payments"])(
    "no sigue un returnTo que no es una ruta interna segura (%s)",
    async (returnTo) => {
      expect(await backHref(`returnTo=${encodeURIComponent(returnTo)}`)).toBe("/sales");
    },
  );
});

// PAG-F6 U2: un re-pedido fallido sustituia todo el detalle (y el modal de cobro abierto)
// por la pantalla de error, aunque la venta ya estuviera cargada.
describe("SaleDetailsPage · re-pedido fallido (PAG-F6 U2)", () => {
  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
  });

  function failSaleRequests(failure: () => Promise<Response>) {
    const working = global.fetch;

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === `/api/sales/${PENDING_SALE.id}` ? failure() : working(input, init),
    ) as unknown as typeof fetch;
  }

  it.each<[string, () => Promise<Response>]>([
    ["se corta la red", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "responde 500",
      () =>
        Promise.resolve(
          jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo interno." } }, 500),
        ),
    ],
  ])(
    "con la venta cargada, si al abrir «Cobrar saldo» %s el detalle y el modal siguen en pantalla",
    async (_name, failure) => {
      await renderSale(PENDING_SALE);
      failSaleRequests(failure);

      fireEvent.click(screen.getByRole("button", { name: "Cobrar saldo" }));

      const dialog = await screen.findByRole("dialog", { name: "Cobrar saldo" });

      expect(
        await within(dialog).findByText(/No se pudo comprobar el saldo pendiente/),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Cobrar saldo" })).toBeInTheDocument();
      expect(screen.queryByText("No pudimos cargar la venta")).not.toBeInTheDocument();
      expect(screen.getByText("Historial de Pagos")).toBeInTheDocument();
    },
  );

  it("sin venta cargada sigue mostrando la pantalla de error", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo interno." } }, 500),
      ),
    ) as unknown as typeof fetch;

    render(<SaleDetailsPage saleId={PENDING_SALE.id} />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("No pudimos cargar la venta")).toBeInTheDocument();
    expect(screen.getByText("Fallo interno.")).toBeInTheDocument();
    expect(screen.queryByText("Historial de Pagos")).not.toBeInTheDocument();
  });
});
