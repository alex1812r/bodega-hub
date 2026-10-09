/**
 * CNF-02/03 · anular y devolver confirman con su efecto real (impact) antes de
 * ejecutar. El rechazo de la RPC (STK-607) queda a la vista en el momento del
 * fallo: dentro del modal de confirmación, que no se cierra.
 *
 * PAG-02 · «Cobrar saldo» en la cabecera abre el modal de cobro sin salir del
 * detalle; solo aparece si la venta admite cobros y el usuario puede registrarlos.
 *
 * PAG-F2 · «Volver» regresa a la lista de origen que viaja en `returnTo`.
 *
 * DET-03 · cabecera con UNA accion primaria segun el estado real de la venta,
 * secciones colapsables (recibo cerrado por defecto) y «Volver» que conserva el
 * `returnTo` anidado.
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
import { formatVesBs } from "@/shared/utils/currency";

import type { SaleDetail } from "../hooks/useSales";
import type { SaleImpact, SaleImpactAction } from "../services/saleImpact";
import { SaleDetailsPage } from "./page";
import { exportSaleInvoicePdf } from "./services/exportSaleInvoicePdf";

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

// Cada seccion recuerda abierto/cerrado en localStorage: sin limpiar, un test heredaria el del anterior.
beforeEach(() => {
  window.localStorage.clear();
});

/** Resumen de la cabecera: estado, cifras y accion primaria. */
function summary() {
  return within(screen.getByRole("region", { hidden: true, name: "Resumen de la venta" }));
}

/** Tarjeta de una cifra de la cabecera («Total», «Pagado», «Saldo»). */
function figure(label: string) {
  return summary().getByText(label).parentElement as HTMLElement;
}

/** Boton que abre o cierra una seccion; su nombre incluye el resumen cuando esta cerrada. */
function sectionToggle(title: string) {
  return screen.getByRole("button", {
    hidden: true,
    name: (name) => name === title || name.startsWith(`${title} `),
  });
}

// Carrera entre el efecto y la ejecución: al abrir el modal la venta no tenía
// pagos activos; al confirmar, la RPC ya los encuentra y rechaza.
const CANCEL_REJECTION =
  "La venta V-20261006-000013 tiene 1 pago(s) activo(s) por Bs 2617.18. Anula primero los pagos y luego cancela la venta.";
const RETURN_REJECTION = "La venta V-20261006-000013 ya no tiene unidades por devolver.";

function saleImpact(action: SaleImpactAction, overrides: Partial<SaleImpact> = {}): SaleImpact {
  return {
    action,
    allowed: true,
    document: {
      contactName: "Cliente de mostrador",
      id: PAID_SALE.id,
      number: PAID_SALE.invoiceNumber,
      status: "pagada",
      statusAfter: action === "cancel" ? "cancelada" : "devuelta",
    },
    inexact: null,
    paidVes: 0,
    paidVesAfter: 0,
    payments: [],
    reason: null,
    reasonCode: null,
    refund: action === "return" ? { byMethod: [], changeToRecover: [], netVes: 0 } : null,
    stock: [
      {
        inexact: null,
        isActive: true,
        productId: "prod-harina",
        productName: "Harina PAN 1 kg",
        quantityDelta: 3,
        sku: "HAR-1",
        stockAfter: 10,
        stockBefore: 7,
      },
    ],
    ...overrides,
  } as SaleImpact;
}

/**
 * API del detalle: la venta, su impact (`impactFor`) y las mutaciones. Sin
 * `saleAfterMutation` la RPC rechaza con 409; con él, la acción se aplica y la
 * venta queda así también para los re-pedidos.
 */
function installSaleApi(
  options: {
    impactFor?: (action: SaleImpactAction) => SaleImpact;
    saleAfterMutation?: SaleDetail;
  } = {},
) {
  const mutations: Array<{ method: string; url: string }> = [];
  const impacts: string[] = [];
  let sale = PAID_SALE;

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "GET" && url.startsWith(`/api/sales/${PAID_SALE.id}/impact?action=`)) {
      const action = url.endsWith("=cancel") ? "cancel" : "return";

      impacts.push(url);

      return Promise.resolve(
        jsonResponse({ data: (options.impactFor ?? saleImpact)(action) }),
      );
    }

    if (method === "GET") {
      return Promise.resolve(
        jsonResponse({ data: url === `/api/sales/${PAID_SALE.id}` ? sale : {} }),
      );
    }

    mutations.push({ method, url });

    if (options.saleAfterMutation) {
      sale = options.saleAfterMutation;

      return Promise.resolve(jsonResponse({ data: sale }));
    }

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

  return { impacts, mutations };
}

async function openAction(menuItem: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Acciones de la venta" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: menuItem }));
}

/** El modal de confirmación ya con el efecto calculado (antes hay otro, de carga). */
async function effectDialog(name: string) {
  await screen.findByText("Qué va a pasar");

  return within(screen.getByRole("dialog", { name }));
}

describe("SaleDetailsPage · anular y devolver confirman con su efecto (CNF-02/03)", () => {
  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage", "payments.view"];
  });

  it("«Anular venta» abre la confirmación con el efecto y no anula hasta confirmar", async () => {
    const { impacts, mutations } = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await openAction("Anular venta");

    const dialog = await effectDialog("Anular venta");

    expect(await dialog.findByText("Harina PAN 1 kg")).toBeInTheDocument();
    expect(dialog.getByText("+3 und")).toBeInTheDocument();
    expect(impacts).toEqual([`/api/sales/${PAID_SALE.id}/impact?action=cancel`]);
    expect(mutations).toEqual([]);

    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mutations).toEqual([]);
  });

  it("anular rechazado por la RPC: el 409 se muestra tal cual dentro del modal, que no se cierra", async () => {
    const { mutations } = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await openAction("Anular venta");

    const dialog = await effectDialog("Anular venta");
    const confirm = await dialog.findByRole("button", { name: "Anular venta" });

    // Doble clic: una sola petición.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(await dialog.findByRole("alert")).toHaveTextContent(CANCEL_REJECTION);
    expect(mutations).toEqual([{ method: "PATCH", url: `/api/sales/${PAID_SALE.id}/cancel` }]);
    expect(screen.getByRole("dialog", { name: "Anular venta" })).toBeInTheDocument();
    expect(summary().getByText("Pagada")).toBeInTheDocument();
  });

  it("devolución rechazada por la RPC: mismo aviso, dentro de su modal", async () => {
    const { impacts, mutations } = installSaleApi();

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await openAction("Devolución");

    const dialog = await effectDialog("Devolver venta");

    fireEvent.click(await dialog.findByRole("button", { name: "Devolver venta" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(RETURN_REJECTION);
    expect(impacts).toEqual([`/api/sales/${PAID_SALE.id}/impact?action=return`]);
    expect(mutations).toEqual([{ method: "POST", url: `/api/sales/${PAID_SALE.id}/return` }]);
    expect(screen.getByRole("dialog", { name: "Devolver venta" })).toBeInTheDocument();
  });

  it("anular con éxito: cierra el modal y el detalle queda anulado", async () => {
    const { mutations } = installSaleApi({
      saleAfterMutation: { ...PAID_SALE, status: "cancelada" },
    });

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await openAction("Anular venta");

    const dialog = await effectDialog("Anular venta");

    fireEvent.click(await dialog.findByRole("button", { name: "Anular venta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mutations).toEqual([{ method: "PATCH", url: `/api/sales/${PAID_SALE.id}/cancel` }]);
    expect(await summary().findByText("Anulada")).toBeInTheDocument();
  });

  it("con un pago activo no ofrece anular: motivo, pago culpable, enlace a los pagos y «Devolver la venta»", async () => {
    const blocked = (action: SaleImpactAction) =>
      action === "return"
        ? saleImpact("return")
        : saleImpact("cancel", {
            allowed: false,
            document: {
              contactName: "Cliente de mostrador",
              id: PAID_SALE.id,
              number: PAID_SALE.invoiceNumber,
              status: "pagada",
              statusAfter: "pagada",
            },
            paidVes: 2617.18,
            paidVesAfter: 2617.18,
            payments: [
              {
                amount: 2617.18,
                amountRef: 3,
                amountVes: 2617.18,
                changeVes: 0,
                currency: "VES",
                description: "Sigue activo: hay que anularlo antes de anular la venta.",
                effects: [],
                inexact: null,
                method: "pago_movil",
                netVes: 2617.18,
                outcome: "blocks_action",
                paymentId: "pay-1",
                status: "activo",
                statusAfter: "activo",
              },
            ],
            reason: CANCEL_REJECTION,
            reasonCode: "CONFLICT",
          } as Partial<SaleImpact>);
    const { mutations } = installSaleApi({ impactFor: blocked });

    render(<SaleDetailsPage saleId={PAID_SALE.id} />, { wrapper: createQueryWrapper() });
    await openAction("Anular venta");

    const dialog = within(
      await screen.findByRole("dialog", { name: "No se puede anular la venta" }),
    );

    expect(dialog.getByRole("alert")).toHaveTextContent(CANCEL_REJECTION);
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();

    const paymentsLink = new URL(
      dialog.getByRole("link", { name: "Ver pagos de la venta" }).getAttribute("href") ?? "",
      "http://localhost",
    );

    expect(paymentsLink.pathname).toBe("/payments");
    expect(paymentsLink.searchParams.get("saleId")).toBe(PAID_SALE.id);
    expect(paymentsLink.searchParams.get("returnTo")).toBe("/sales/sale-stk607");

    fireEvent.click(dialog.getByRole("button", { name: "Devolver la venta" }));

    expect(await screen.findByRole("dialog", { name: "Devolver venta" })).toBeInTheDocument();
    expect(mutations).toEqual([]);
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

    expect(figure("Saldo")).toHaveTextContent(formatVesBs(1600));
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
    expect(figure("Saldo")).toHaveTextContent(formatVesBs(0));
    expect(summary().getByRole("button", { name: "Recibo" })).toBeInTheDocument();
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
      expect(figure("Saldo")).toHaveTextContent(formatVesBs(1000)),
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
      expect(sectionToggle("Pagos")).toBeInTheDocument();
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
    expect(screen.queryByRole("region", { name: "Resumen de la venta" })).not.toBeInTheDocument();
  });
});

const UNPAID_SALE: SaleDetail = { ...PENDING_SALE, id: "sale-det03-unpaid", paidVes: 0 };
/** Marcada como pagada pero con saldo: el servidor todavía la deja cobrar. */
const PAID_WITH_BALANCE_SALE: SaleDetail = { ...PENDING_SALE, id: "sale-det03-short", status: "pagada" };

function payment(id: string, overrides: Partial<SaleDetail["payments"][number]> = {}) {
  return {
    amount: 1000,
    amountRef: 1.15,
    amountVes: 1000,
    contactId: PAID_SALE.customerId,
    createdAt: "2026-10-06T14:00:00.000Z",
    direction: "entrada" as const,
    id,
    method: "efectivo_ves" as const,
    refRateVes: PAID_SALE.refRateVes,
    saleId: PAID_SALE.id,
    ...overrides,
  };
}

describe("SaleDetailsPage · acción primaria según el estado (DET-03)", () => {
  let print: jest.SpyInstance;

  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
    print = jest.spyOn(window, "print").mockImplementation(() => undefined);
  });

  afterEach(() => {
    print.mockRestore();
  });

  it("la cabecera resume total, pagado, saldo y estado", async () => {
    await renderSale(PENDING_SALE);

    expect(figure("Total")).toHaveTextContent(formatVesBs(2600));
    expect(figure("Pagado")).toHaveTextContent(formatVesBs(1000));
    expect(figure("Saldo")).toHaveTextContent(formatVesBs(1600));
    expect(summary().getByText("Pendiente de Pago")).toBeInTheDocument();
  });

  it.each<[string, SaleDetail]>([
    ["pendiente de pago sin abonos", UNPAID_SALE],
    ["parcialmente pagada", PENDING_SALE],
    ["pagada con saldo", PAID_WITH_BALANCE_SALE],
  ])("%s: la única acción primaria es «Cobrar saldo»", async (_name, sale) => {
    await renderSale(sale);

    expect(summary().getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Cobrar saldo",
    ]);
  });

  it("pagada: la única acción primaria es «Recibo», que imprime el recibo", async () => {
    await renderSale(PAID_SALE);

    expect(summary().getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Recibo",
    ]);
    expect(summary().queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(summary().getByRole("button", { name: "Recibo" }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it.each<[string, SaleDetail["status"], string]>([
    ["anulada", "cancelada", "Venta anulada: no admite cobros."],
    ["devuelta", "devuelta", "Venta devuelta: no admite cobros."],
  ])("%s con saldo: nunca «Cobrar», ofrece «Recibo» y avisa del estado", async (_name, status, notice) => {
    await renderSale({ ...PENDING_SALE, status });

    expect(summary().getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Recibo",
    ]);
    expect(summary().getByRole("status")).toHaveTextContent(notice);
    expect(collectButton()).not.toBeInTheDocument();
  });

  it("borrador: sin acción primaria, solo el aviso del estado", async () => {
    await renderSale({ ...PENDING_SALE, status: "borrador" });

    expect(summary().queryByRole("button")).not.toBeInTheDocument();
    expect(summary().getByRole("status")).toHaveTextContent(
      "Venta en borrador: todavía no admite cobros.",
    );
  });

  it("con saldo pero sin permiso de cobro cae a «Recibo» y lo explica", async () => {
    mockPermissions = ["sales.view", "payments.view"];
    await renderSale(PENDING_SALE);

    expect(summary().getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Recibo",
    ]);
    expect(summary().getByRole("status")).toHaveTextContent(
      "Saldo pendiente. No tienes permiso para registrar cobros.",
    );
  });
});

describe("SaleDetailsPage · secciones colapsables (DET-03)", () => {
  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
  });

  function screenReceipt() {
    return document.getElementById("sale-receipt-screen-preview") as HTMLElement;
  }

  it("la vista previa del recibo abre colapsada y se despliega al pulsarla", async () => {
    await renderSale(PAID_SALE);

    const toggle = sectionToggle("Vista previa del recibo");

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screenReceipt()).not.toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screenReceipt()).toBeVisible();
    expect(window.localStorage.getItem("sale-detail:receipt-open")).toBe("open");
  });

  it("el recibo que se imprime no depende de la sección: sigue fuera de ella, uno solo", async () => {
    await renderSale(PAID_SALE);

    const printable = document.querySelectorAll("#sale-receipt-preview");

    expect(printable).toHaveLength(1);
    expect(printable[0].closest("[hidden]")).toBeNull();
    expect(printable[0]).toHaveTextContent("Factura: #V-20261006-000013");
    expect(printable[0].innerHTML).toBe(screenReceipt().innerHTML);
  });

  it("con saldo: Productos y Pagos abiertas, Cliente / Vendedor cerrada con su resumen", async () => {
    await renderSale(PENDING_SALE);

    expect(sectionToggle("Productos")).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle("Pagos")).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle("Cliente / Vendedor")).toHaveAttribute("aria-expanded", "false");
    expect(sectionToggle("Cliente / Vendedor")).toHaveTextContent("cont-customer · vendió Vendedor Demo");
    expect(screen.getByText("Total (VES)")).toBeVisible();
  });

  it("sin saldo: Pagos cerrada con el resumen «N pagos · cobrado X» (los anulados no cuentan)", async () => {
    await renderSale({
      ...PAID_SALE,
      payments: [
        payment("pay-1", { amountVes: 2000 }),
        payment("pay-2", { amountVes: 617.18 }),
        payment("pay-void", { status: "anulado" }),
      ],
    });

    const toggle = sectionToggle("Pagos");

    expect(sectionToggle("Productos")).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent(`2 pagos · cobrado ${formatVesBs(2617.18)}`);
  });

  it("venta con saldo y sin pagos: estado vacío a la vista dentro de Pagos", async () => {
    await renderSale(UNPAID_SALE);

    expect(sectionToggle("Pagos")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("No hay pagos registrados para esta venta.")).toBeVisible();
  });

  it("venta sin saldo y sin pagos: Pagos cerrada lo dice en el resumen y conserva el estado vacío", async () => {
    await renderSale({ ...PAID_SALE, paidVes: 0, totalVes: 0 });

    const toggle = sectionToggle("Pagos");

    expect(toggle).toHaveTextContent("Sin pagos registrados");

    fireEvent.click(toggle);

    expect(screen.getByText("No hay pagos registrados para esta venta.")).toBeVisible();
  });

  it("recuerda lo que el usuario dejó abierto o cerrado, por sección", async () => {
    window.localStorage.setItem("sale-detail:products-open", "closed");
    window.localStorage.setItem("sale-detail:parties-open", "open");
    await renderSale(PENDING_SALE);

    expect(sectionToggle("Productos")).toHaveAttribute("aria-expanded", "false");
    expect(sectionToggle("Productos")).toHaveTextContent("0 productos · total");
    expect(sectionToggle("Cliente / Vendedor")).toHaveAttribute("aria-expanded", "true");
    expect(sectionToggle("Pagos")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("SaleDetailsPage · el menú «…» conserva sus acciones (DET-03)", () => {
  async function menuItems() {
    fireEvent.click(screen.getByRole("button", { name: "Acciones de la venta" }));
    await screen.findByRole("menuitem", { name: "Imprimir factura" });

    return screen.getAllByRole("menuitem").map((item) => item.textContent);
  }

  it.each<[string, SaleDetail]>([
    ["con saldo", PENDING_SALE],
    ["pagada", PAID_SALE],
    ["anulada", { ...PAID_SALE, status: "cancelada" }],
    ["devuelta", { ...PAID_SALE, status: "devuelta" }],
  ])("venta %s con sales.create: imprimir, PDF, devolución y anular", async (_name, sale) => {
    mockPermissions = ["sales.create", "payments.manage"];
    await renderSale(sale);

    expect(await menuItems()).toEqual([
      "Imprimir factura",
      "Descargar PDF",
      "Devolución",
      "Anular venta",
    ]);
  });

  it.each<[string, SaleDetail["status"], boolean]>([
    ["con saldo", "pendiente_pago", true],
    ["pagada", "pagada", true],
    ["anulada", "cancelada", false],
    ["devuelta", "devuelta", false],
    ["en borrador", "borrador", false],
  ])(
    "venta %s: «Devolución» y «Anular venta» habilitadas = %s (CNF-02/03)",
    async (_name, status, enabled) => {
      mockPermissions = ["sales.create", "payments.manage"];
      await renderSale({ ...PAID_SALE, status });
      await menuItems();

      for (const label of ["Devolución", "Anular venta"]) {
        const item = screen.getByRole("menuitem", { name: label });

        if (enabled) {
          expect(item).toBeEnabled();
        } else {
          expect(item).toBeDisabled();
        }
      }
      expect(screen.getByRole("menuitem", { name: "Imprimir factura" })).toBeEnabled();
      expect(screen.getByRole("menuitem", { name: "Descargar PDF" })).toBeEnabled();
    },
  );

  it("«Imprimir factura» y «Descargar PDF» se ejecutan directo, sin confirmación (CNF-13)", async () => {
    const print = jest.spyOn(window, "print").mockImplementation(() => undefined);

    mockPermissions = ["sales.create"];
    await renderSale(PAID_SALE);
    await menuItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Imprimir factura" }));

    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await menuItems();
    fireEvent.click(screen.getByRole("menuitem", { name: "Descargar PDF" }));

    await waitFor(() => expect(exportSaleInvoicePdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    print.mockRestore();
  });

  it("sin sales.create: imprimir y PDF", async () => {
    mockPermissions = ["sales.view"];
    await renderSale(PAID_SALE);

    expect(await menuItems()).toEqual(["Imprimir factura", "Descargar PDF"]);
  });
});

describe("SaleDetailsPage · «Volver» con returnTo encadenado (DET-03)", () => {
  const PRODUCTS_LIST = "/products?q=harina&page=2";
  // Kardex del producto, que a su vez sabe volver a la lista de productos con sus filtros.
  const PRODUCT_DETAIL = `/products/prod-1?tab=historial&returnTo=${encodeURIComponent(PRODUCTS_LIST)}`;

  beforeEach(() => {
    mockPermissions = ["sales.create", "payments.manage"];
  });

  afterEach(() => {
    mockSearch = "";
  });

  async function backHref(returnTo: string) {
    mockSearch = `returnTo=${encodeURIComponent(returnTo)}`;
    await renderSale(PAID_SALE);

    return screen.getByRole("link", { name: "Volver" }).getAttribute("href");
  }

  it("vuelve al detalle de origen SIN quitarle su returnTo: desde allí se sigue volviendo a la lista filtrada", async () => {
    const href = await backHref(PRODUCT_DETAIL);

    expect(href).toBe(PRODUCT_DETAIL);
    expect(new URLSearchParams(href?.split("?")[1]).get("returnTo")).toBe(PRODUCTS_LIST);
  });

  it("un returnTo anidado inseguro invalida el destino entero", async () => {
    expect(
      await backHref(`/products/prod-1?returnTo=${encodeURIComponent("https://evil.example")}`),
    ).toBe("/sales");
  });
});

describe("SaleDetailsPage · enlaces cruzados (DET-05)", () => {
  const LIST = "/sales?status=pagada&page=2";
  const DETAIL_URL = `/sales/sale-stk607?returnTo=${encodeURIComponent(LIST)}`;
  const SALE_WITH_LINES: SaleDetail = {
    ...PAID_SALE,
    items: [
      {
        product: { id: "prod-arroz", name: "Arroz Mary 1 kg", sku: "ARR-001" } as NonNullable<
          SaleDetail["items"][number]["product"]
        >,
        productId: "prod-arroz",
        quantity: 2,
        saleId: PAID_SALE.id,
        subtotalRef: 3,
        subtotalVes: 2617.18,
        unitCostRefSnapshot: 1,
        unitPriceRef: 1.5,
      },
    ],
  };

  beforeEach(() => {
    mockSearch = `returnTo=${encodeURIComponent(LIST)}`;
  });

  afterEach(() => {
    mockSearch = "";
  });

  function movementsLink() {
    return screen.queryByRole("link", { name: "Ver movimientos de stock" });
  }

  it("el producto de cada renglón enlaza a su detalle y vuelve a esta venta con su lista", async () => {
    mockPermissions = ["products.view"];
    await renderSale(SALE_WITH_LINES);

    expect(screen.getByRole("link", { name: "Arroz Mary 1 kg" })).toHaveAttribute(
      "href",
      `/products/prod-arroz?returnTo=${encodeURIComponent(DETAIL_URL)}`,
    );
  });

  it("sin products.view el producto va en texto plano", async () => {
    mockPermissions = ["inventory.view"];
    await renderSale(SALE_WITH_LINES);

    // El nombre sale también en el recibo: basta con que ninguno enlace.
    expect(screen.getAllByText("Arroz Mary 1 kg").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Arroz Mary 1 kg" })).not.toBeInTheDocument();
  });

  it.each<SaleDetail["status"]>(["pagada", "pendiente_pago", "devuelta", "cancelada"])(
    "venta %s con inventory.view: «Ver movimientos de stock» filtra por la venta",
    async (status) => {
      mockPermissions = ["inventory.view"];
      await renderSale({ ...SALE_WITH_LINES, status });

      expect(movementsLink()).toHaveAttribute(
        "href",
        `/inventory/movements?saleId=sale-stk607&returnTo=${encodeURIComponent(DETAIL_URL)}`,
      );
    },
  );

  it("un borrador no movió stock: no ofrece el enlace", async () => {
    mockPermissions = ["inventory.view"];
    await renderSale({ ...SALE_WITH_LINES, status: "borrador" });

    expect(movementsLink()).not.toBeInTheDocument();
  });

  it("sin inventory.view no ofrece el enlace", async () => {
    mockPermissions = ["products.view", "sales.create"];
    await renderSale(SALE_WITH_LINES);

    expect(movementsLink()).not.toBeInTheDocument();
  });
});
