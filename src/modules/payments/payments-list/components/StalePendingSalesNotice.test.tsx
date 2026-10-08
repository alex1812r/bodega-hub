/**
 * PAG-07 · aviso de ventas en `pendiente_pago` abandonadas: retienen stock sin
 * vencimiento. El aviso solo informa y da acceso a «Cobrar» y al detalle («Anular»).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

const mockAuth: { permissions: string[] } = { permissions: [] };

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockAuth.permissions.includes(permission),
  }),
}));
jest.mock("../../components/RegisterPaymentModal", () => ({
  RegisterPaymentModal: ({ open, saleId }: { open?: boolean; saleId?: string }) =>
    open ? <div data-sale-id={saleId} role="dialog" /> : null,
}));

import { type OpenDocument, openDocumentsQueryKeys } from "../../hooks/useOpenDocuments";
import { STALE_PENDING_SALE_DAYS, StalePendingSalesNotice } from "./StalePendingSalesNotice";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LIST_HREF = "/payments?method=transferencia&page=2";
const QUERY_FILTERS = { limit: 50, olderThanDays: STALE_PENDING_SALE_DAYS, type: "sale" } as const;

function daysAgo(days: number) {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

/** Fecha Caracas de `iso` como `DD/MM/YYYY`. */
function caracasDate(iso: string) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" })
    .format(new Date(iso))
    .split("-");

  return `${day}/${month}/${year}`;
}

function sale(index: number, overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    contact: { id: `cont-${index}`, name: `Cliente ${index}` },
    createdAt: daysAgo(7 + index),
    id: `sale-${index}`,
    number: `V-00000${index}`,
    paidVes: 0,
    pendingRef: 10 * index,
    pendingVes: 5000 * index,
    refRateVes: 500,
    status: "pendiente_pago",
    totalRef: 10 * index,
    totalVes: 5000 * index,
    type: "sale",
    ...overrides,
  };
}

function listPayload(items: OpenDocument[], overrides: { total?: number; totals?: object } = {}) {
  return {
    items,
    limit: 50,
    skip: 0,
    total: overrides.total ?? items.length,
    totals: {
      count: overrides.total ?? items.length,
      pendingRef: items.reduce((sum, item) => sum + (item.pendingRef ?? 0), 0),
      pendingVes: items.reduce((sum, item) => sum + item.pendingVes, 0),
      truncated: false,
      ...overrides.totals,
    },
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

describe("StalePendingSalesNotice (PAG-07)", () => {
  const fetchMock = jest.fn();
  let respond: () => Promise<Response>;

  beforeEach(() => {
    mockAuth.permissions = ["payments.manage"];
    respond = async () => jsonResponse({ data: listPayload([sale(1), sale(2)]) });
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => respond());
    global.fetch = fetchMock;
  });

  function renderNotice(queryClient?: QueryClient) {
    const client =
      queryClient ??
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
      });

    render(
      <QueryClientProvider client={client}>
        <StalePendingSalesNotice listHref={LIST_HREF} />
      </QueryClientProvider>,
    );

    return client;
  }

  function findNotice() {
    return screen.findByRole("region", { name: "Ventas pendientes de pago" });
  }

  function queryNotice() {
    return screen.queryByRole("region", { name: "Ventas pendientes de pago" });
  }

  async function expectNothingAfterRequest() {
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Deja resolver la respuesta antes de afirmar que no hay aviso.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(queryNotice()).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }

  it("el umbral exportado es de 7 días y es el que se pide al servidor, solo ventas", async () => {
    renderNotice();
    await findNotice();

    expect(STALE_PENDING_SALE_DAYS).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [path, search] = String(fetchMock.mock.calls[0][0]).split("?");
    const params = new URLSearchParams(search);

    expect(path).toBe("/api/payments/open-documents");
    expect(params.get("type")).toBe("sale");
    expect(params.get("olderThanDays")).toBe("7");
    expect(params.get("limit")).toBe("50");
  });

  it("muestra cuántas ventas, el total pendiente en REF y Bs y por qué importa, con la lista cerrada", async () => {
    renderNotice();

    const notice = within(await findNotice());

    expect(notice.getByText("2 ventas llevan 7 días o más pendientes de pago")).toBeInTheDocument();
    expect(notice.getByText(/Total pendiente/)).toHaveTextContent(
      `${formatRefUsd(30)} · ${formatVesBs(15000)}`,
    );
    expect(notice.getByText(/sigue apartada del inventario/)).toHaveTextContent(
      /hasta que la venta se cobre o se anule/,
    );
    expect(notice.getByRole("button", { name: "Ver las ventas" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(notice.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con una sola venta habla en singular", async () => {
    respond = async () => jsonResponse({ data: listPayload([sale(1)]) });
    renderNotice();

    const notice = within(await findNotice());

    expect(notice.getByText("1 venta lleva 7 días o más pendiente de pago")).toBeInTheDocument();
    expect(notice.getByRole("button", { name: "Ver la venta" })).toBeInTheDocument();
  });

  it("al desplegar lista número, cliente, fecha, antigüedad y saldo, sin ids internos", async () => {
    const older = sale(2, { contact: undefined, pendingRef: undefined });

    respond = async () =>
      jsonResponse({ data: listPayload([older, sale(1)], { totals: { pendingRef: 10 } }) });
    renderNotice();

    const notice = await findNotice();
    const user = userEvent.setup();

    await user.click(within(notice).getByRole("button", { name: "Ver las ventas" }));

    const rows = within(notice).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("V-000002");
    expect(rows[0]).toHaveTextContent("Sin cliente");
    expect(rows[0]).toHaveTextContent(`${caracasDate(older.createdAt)} · hace 9 días`);
    expect(rows[0]).toHaveTextContent(`Saldo: ${formatVesBs(10000)}`);
    expect(rows[1]).toHaveTextContent("V-000001");
    expect(rows[1]).toHaveTextContent("Cliente 1");
    expect(rows[1]).toHaveTextContent("hace 8 días");
    expect(rows[1]).toHaveTextContent(`Saldo: ${formatRefUsd(10)} · ${formatVesBs(5000)}`);
    expect(notice.textContent).not.toMatch(/sale-|cont-/);
  });

  it("«Ver venta» lleva al detalle con la URL exacta de la lista como returnTo", async () => {
    renderNotice();

    const notice = await findNotice();

    await userEvent.setup().click(within(notice).getByRole("button", { name: "Ver las ventas" }));

    const link = within(notice).getByRole("link", { name: "Ver venta V-000002" });
    const href = new URL(link.getAttribute("href") ?? "", "http://localhost");

    expect(link).toHaveTextContent("Ver venta");
    expect(href.pathname).toBe("/sales/sale-2");
    expect(href.searchParams.get("returnTo")).toBe(LIST_HREF);
  });

  it("«Cobrar» abre el modal de pago de esa venta", async () => {
    renderNotice();

    const notice = await findNotice();
    const user = userEvent.setup();

    await user.click(within(notice).getByRole("button", { name: "Ver las ventas" }));
    await user.click(within(notice).getByRole("button", { name: "Cobrar venta V-000002" }));

    expect(screen.getByRole("dialog")).toHaveAttribute("data-sale-id", "sale-2");
  });

  it("solo cuenta las ventas en pendiente_pago y descuenta el resto del total", async () => {
    respond = async () =>
      jsonResponse({ data: listPayload([sale(1), sale(2, { status: "pagada" }), sale(3)]) });
    renderNotice();

    const notice = await findNotice();

    expect(
      within(notice).getByText("2 ventas llevan 7 días o más pendientes de pago"),
    ).toBeInTheDocument();
    expect(within(notice).getByText(/Total pendiente/)).toHaveTextContent(
      `${formatRefUsd(40)} · ${formatVesBs(20000)}`,
    );

    await userEvent.setup().click(within(notice).getByRole("button", { name: "Ver las ventas" }));

    expect(within(notice).getAllByRole("listitem")).toHaveLength(2);
    expect(notice).not.toHaveTextContent("V-000002");
  });

  it("si hay más ventas que las cargadas, lo dice", async () => {
    respond = async () =>
      jsonResponse({
        data: listPayload([sale(1), sale(2)], {
          total: 63,
          totals: { pendingRef: 900, pendingVes: 450000 },
        }),
      });
    renderNotice();

    const notice = await findNotice();

    expect(
      within(notice).getByText("63 ventas llevan 7 días o más pendientes de pago"),
    ).toBeInTheDocument();
    expect(within(notice).getByText(/Total pendiente/)).toHaveTextContent(
      `${formatRefUsd(900)} · ${formatVesBs(450000)}`,
    );

    await userEvent.setup().click(within(notice).getByRole("button", { name: "Ver las ventas" }));

    expect(within(notice).getByText(/^y 61 más/)).toBeInTheDocument();
  });

  it("si el servidor truncó la lectura, el conteo se presenta como mínimo", async () => {
    respond = async () =>
      jsonResponse({ data: listPayload([sale(1), sale(2)], { totals: { truncated: true } }) });
    renderNotice();

    expect(
      within(await findNotice()).getByText(
        "Al menos 2 ventas llevan 7 días o más pendientes de pago",
      ),
    ).toBeInTheDocument();
  });

  it("sin ventas abandonadas no pinta nada", async () => {
    respond = async () => jsonResponse({ data: listPayload([]) });
    renderNotice();

    await expectNothingAfterRequest();
  });

  it("si solo hay ventas en otro estado no pinta nada", async () => {
    respond = async () => jsonResponse({ data: listPayload([sale(1, { status: "pagada" })]) });
    renderNotice();

    await expectNothingAfterRequest();
  });

  it("si la consulta falla no pinta nada ni muestra un error propio", async () => {
    respond = async () =>
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo interno." } }, 500);
    renderNotice();

    await expectNothingAfterRequest();
    expect(screen.queryByText("Fallo interno.")).not.toBeInTheDocument();
  });

  it("mientras carga no pinta nada", async () => {
    let release: (response: Response) => void = () => undefined;

    respond = () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      });
    renderNotice();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(queryNotice()).not.toBeInTheDocument();

    release(jsonResponse({ data: listPayload([sale(1)]) }));
    expect(await findNotice()).toBeInTheDocument();
  });

  it("sin payments.manage ni sales.create no hace la petición ni pinta nada", async () => {
    mockAuth.permissions = ["payments.view"];
    renderNotice();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryNotice()).not.toBeInTheDocument();
  });

  it("con sales.create (vendedor) sí se muestra", async () => {
    mockAuth.permissions = ["sales.create"];
    renderNotice();

    expect(await findNotice()).toBeInTheDocument();
  });

  it("al invalidarse los pagos (cobro registrado) se vuelve a pedir y el aviso se actualiza", async () => {
    const client = renderNotice();

    await findNotice();
    respond = async () => jsonResponse({ data: listPayload([sale(1)]) });
    // Lo que hace `useRegisterPayment` al terminar un cobro.
    await act(() => client.invalidateQueries({ queryKey: openDocumentsQueryKeys.all }));

    expect(
      await screen.findByText("1 venta lleva 7 días o más pendiente de pago"),
    ).toBeInTheDocument();

    respond = async () => jsonResponse({ data: listPayload([]) });
    await act(() => client.invalidateQueries({ queryKey: ["payments"] }));

    await waitFor(() => expect(queryNotice()).not.toBeInTheDocument());
  });

  it("al volver a la lista con la caché vigente (venta anulada en su detalle) no enseña lo viejo y vuelve a pedir", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });

    client.setQueryData(openDocumentsQueryKeys.list(QUERY_FILTERS), listPayload([sale(1), sale(2)]));
    respond = async () => jsonResponse({ data: listPayload([sale(1)]) });
    renderNotice(client);

    expect(queryNotice()).not.toBeInTheDocument();
    expect(
      await screen.findByText("1 venta lleva 7 días o más pendiente de pago"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
