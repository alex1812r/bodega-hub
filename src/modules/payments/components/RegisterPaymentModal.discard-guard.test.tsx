import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  answerGuard,
  CLOSE_WAYS,
  clickLinkToAnotherRoute,
  closeModalWith,
  dispatchBeforeUnload,
  findGuardDialog,
  queryDialogByTitle,
  queryGuardDialog,
  settleDialog,
} from "@/shared/hooks/useFormModalDiscardGuard.testUtils";
import { formatVes } from "@/shared/utils/currency";

import { RegisterPaymentModal } from "./RegisterPaymentModal";

/**
 * CNF-15 · pagar una compra / cobrar una venta: con datos tecleados, cerrar
 * pregunta nombrando el pago; un monto puesto por «Completar saldo» no cuenta
 * hasta que se edita; sin datos y tras registrar el pago, cierra sin preguntar.
 * Con el pago en vuelo o por confirmar manda el guardia de PAG-F6 U6.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn() };

jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

// Los flujos con intento por confirmar esperan en tiempo real la guarda de doble clic (~700 ms por paso).
jest.setTimeout(20_000);

const SALE_TITLE = "Cobrar saldo";
/** `toHaveTextContent` compara con los espacios normalizados; el formateador usa espacios duros. */
function money(value: number) {
  return formatVes(value).replace(/\s+/g, " ");
}

const SALE_GUARD_LABEL = `Cobro de ${money(100)} a Maria Perez sin registrar`;

type User = ReturnType<typeof userEvent.setup>;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("RegisterPaymentModal · guardia de datos tecleados (CNF-15)", () => {
  const fetchMock = jest.fn();
  let postReplies: Array<Response | Promise<Response>>;

  beforeEach(() => {
    mockRouter.push.mockReset();
    postReplies = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return (
          postReplies.shift() ?? jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 8375 } })
        );
      }

      if (String(url).includes("/api/settings/payment-methods")) {
        return jsonResponse({
          data: { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd", "pago_movil"] },
        });
      }

      if (String(url).includes("/api/sales/")) {
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

      if (String(url).includes("/api/purchases/")) {
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

      return jsonResponse({ data: null });
    });
    global.fetch = fetchMock;
  });

  function postCount() {
    return fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    ).length;
  }

  async function openModal(ui = <RegisterPaymentModal saleId="sale-002" />, title = SALE_TITLE) {
    const user = userEvent.setup({ delay: null });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
    await user.click(screen.getByRole("button", { name: title }));

    const dialog = within(await screen.findByRole("dialog", { name: title }));

    await dialog.findByText(/Saldo pendiente actual/);
    await settleDialog();

    return { dialog, user };
  }

  async function pressFooter(user: User, name: string) {
    const button = await screen.findByRole("button", { name });

    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
  }

  it.each(CLOSE_WAYS)("sin datos, %s cierra directo, sin pregunta", async (way) => {
    const { user } = await openModal();

    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, SALE_TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(SALE_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it.each(CLOSE_WAYS)(
    "con un monto tecleado, %s pregunta nombrando el cobro y no cierra",
    async (way) => {
      const { dialog, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");

      expect(dispatchBeforeUnload()).toBe(true);

      await closeModalWith(user, SALE_TITLE, way);

      const guard = await findGuardDialog();

      expect(guard).toHaveTextContent(SALE_GUARD_LABEL);
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryDialogByTitle(SALE_TITLE)).toBeInTheDocument();
    },
  );

  it("el monto de «Completar saldo» no cuenta hasta que se edita", async () => {
    const { dialog, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Completar saldo" }));

    expect(dialog.getByLabelText("Monto")).toHaveValue("8475");
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();

    await user.clear(dialog.getByLabelText("Monto"));
    await user.type(dialog.getByLabelText("Monto"), "847");

    expect(dispatchBeforeUnload()).toBe(true);

    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(
      `Cobro de ${money(847)} a Maria Perez sin registrar`,
    );
  });

  it("precargado con «Completar saldo» y sin tocar: Esc cierra directo", async () => {
    const { dialog, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Completar saldo" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(SALE_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("cambiar el método cuenta como dato; volver al inicial, no", async () => {
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Método"), "efectivo_usd");

    expect(dispatchBeforeUnload()).toBe(true);

    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent("Cobro a Maria Perez sin registrar");

    await answerGuard(user, "Seguir aquí");
    await user.selectOptions(dialog.getByLabelText("Método"), "efectivo_ves");

    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("«Seguir aquí» conserva lo tecleado y devuelve el foco al campo", async () => {
    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await user.type(dialog.getByLabelText("Notas"), "Abono en caja");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(dialog.getByLabelText("Monto")).toHaveValue("100");
    expect(dialog.getByLabelText("Notas")).toHaveValue("Abono en caja");
    expect(dialog.getByLabelText("Notas")).toHaveFocus();
    expect(postCount()).toBe(0);
  });

  it("«Salir» descarta: al reabrir el formulario está limpio y cierra sin preguntar", async () => {
    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(SALE_TITLE)).not.toBeInTheDocument());
    expect(dispatchBeforeUnload()).toBe(false);

    await user.click(screen.getByRole("button", { name: SALE_TITLE }));

    const reopened = within(await screen.findByRole("dialog", { name: SALE_TITLE }));

    expect(reopened.getByLabelText("Monto")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(SALE_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("tras registrar con éxito el guardia queda inactivo: ni avisa, ni pregunta al salir ni al cerrar", async () => {
    const onRegistered = jest.fn();
    const { dialog, user } = await openModal(
      <RegisterPaymentModal onRegistered={onRegistered} saleId="sale-002" />,
    );

    await user.type(dialog.getByLabelText("Monto"), "100");
    await pressFooter(user, "Registrar cobro");

    expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(postCount()).toBe(1);
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(SALE_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("con el pago en vuelo se mantiene lo de antes: Esc no cierra ni pregunta, y salir lo atiende «Cobro en curso»", async () => {
    let release: (response: Response) => void = () => undefined;

    postReplies = [
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    ];

    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await pressFooter(user, "Registrar cobro");
    await waitFor(() => expect(postCount()).toBe(1));
    await user.keyboard("{Escape}");
    await settleDialog();

    expect(queryDialogByTitle(SALE_TITLE)).toBeInTheDocument();
    expect(queryGuardDialog()).not.toBeInTheDocument();

    clickLinkToAnotherRoute();

    const guard = await findGuardDialog();

    expect(guard).toHaveTextContent("Cobro en curso");
    expect(guard).not.toHaveTextContent("sin registrar");

    await answerGuard(user, "Seguir aquí");
    release(jsonResponse({ data: { id: "pay-new", pendingBalanceVes: 8375 } }));

    expect(await dialog.findByText(/Pago registrado\. Saldo pendiente:/)).toBeInTheDocument();
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("cancelar la confirmación interna («Descartar intento») no dispara el guardia de datos tecleados", async () => {
    postReplies = [
      jsonResponse({ error: { code: "TEST", message: "Fallo." } }, 500),
      jsonResponse({ error: { code: "TEST", message: "Fallo." } }, 500),
    ];

    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await pressFooter(user, "Registrar cobro");
    await pressFooter(user, "Reintentar");
    await waitFor(() => expect(postCount()).toBe(2));
    await pressFooter(user, "Descartar intento");

    const confirm = await screen.findByRole("dialog", { name: "Descartar intento" });

    await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(queryDialogByTitle("Descartar intento")).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(queryDialogByTitle(SALE_TITLE)).toBeInTheDocument();

    // Con el intento por confirmar el modal se cierra como antes: al reabrir sigue ahí.
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(SALE_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("compra: nombra el pago con su monto y el proveedor", async () => {
    const { dialog, user } = await openModal(
      <RegisterPaymentModal purchaseId="purchase-002" />,
      "Pagar compra",
    );

    await user.type(dialog.getByLabelText("Monto"), "1200");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(
      `Pago de ${money(1200)} a Distribuidora Polar sin registrar`,
    );
  });
});
