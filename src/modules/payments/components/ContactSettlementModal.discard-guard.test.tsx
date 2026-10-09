import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  answerGuard,
  CLOSE_WAYS,
  clickLinkToAnotherRoute,
  closeModalWith,
  ControlledHost,
  dispatchBeforeUnload,
  findGuardDialog,
  queryDialogByTitle,
  queryGuardDialog,
  settleDialog,
} from "@/shared/hooks/useFormModalDiscardGuard.testUtils";
import { formatVesBs } from "@/shared/utils/currency";

import { ContactSettlementModal } from "./ContactSettlementModal";

/**
 * CNF-15 · «Abonar» (cobro o pago repartido): con datos tecleados, cerrar
 * pregunta nombrando el abono; el monto de «Completar total pendiente» no cuenta
 * hasta que se edita; sin datos y con el abono registrado, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ profile: { storeId: "store-1", user: { id: "user-admin" } } }),
}));

// Cada cambio de paso espera en tiempo real la guarda de doble clic (~700 ms).
jest.setTimeout(20_000);

const TITLE = "Abonar";
/** `toHaveTextContent` compara con los espacios normalizados; el formateador usa espacios duros. */
function money(value: number) {
  return formatVesBs(value).replace(/\s+/g, " ");
}

const GUARD_LABEL = `Cobro de ${money(100)} a Maria Perez sin registrar`;

type User = ReturnType<typeof userEvent.setup>;
type Dialog = ReturnType<typeof within>;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function openDocument(id: string, number: string, pendingVes: number, type: "purchase" | "sale") {
  return {
    createdAt: "2026-09-01T14:00:00.000Z",
    id,
    number,
    paidVes: 0,
    pendingVes,
    refRateVes: 40,
    status: "pendiente_pago",
    totalRef: pendingVes / 40,
    totalVes: pendingVes,
    type,
  };
}

describe("ContactSettlementModal · guardia de datos tecleados (CNF-15)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;

        return jsonResponse({ data: { ...body, id: `pay-${body.clientRequestId}` } }, 201);
      }

      if (String(url).includes("/api/settings/payment-methods")) {
        return jsonResponse({
          data: { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd", "pago_movil"] },
        });
      }

      if (String(url).includes("/api/exchange-rates/current")) {
        return jsonResponse({ data: { id: "rate-1", rateVes: 50, source: "BCV" } });
      }

      if (String(url).includes("/api/payments/open-documents")) {
        const type = String(url).includes("type=purchase") ? "purchase" : "sale";
        const items = [
          openDocument("doc-1", type === "sale" ? "F-0001" : "C-0001", 300, type),
          openDocument("doc-2", type === "sale" ? "F-0002" : "C-0002", 130.5, type),
        ];

        return jsonResponse({
          data: {
            items,
            limit: 100,
            skip: 0,
            total: items.length,
            totals: { count: items.length, pendingVes: 430.5, truncated: false },
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

  async function openModal(type: "purchase" | "sale" = "sale", contactName = "Maria Perez") {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onSettled = jest.fn();
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ControlledHost onOpenChange={onOpenChange}>
          {(host) => (
            <ContactSettlementModal
              {...host}
              contactId="contact-1"
              contactName={contactName}
              onSettled={onSettled}
              type={type}
            />
          )}
        </ControlledHost>
      </QueryClientProvider>,
    );

    const dialog = within(await screen.findByRole("dialog", { name: TITLE }));

    await waitFor(() => expect(dialog.getByRole("button", { name: "Ver reparto" })).toBeEnabled());
    await settleDialog();

    return { dialog, onOpenChange, onSettled, user };
  }

  /** Tras cada cambio de paso el pie ignora los clics ~700 ms y lo anuncia con `aria-disabled`. */
  async function press(dialog: Dialog, user: User, name: string) {
    const button = await dialog.findByRole("button", { name });

    await waitFor(() => expect(button).toBeEnabled());
    await waitFor(() =>
      expect(
        dialog
          .queryAllByRole("button")
          .filter((item: HTMLElement) => item.getAttribute("aria-disabled") === "true"),
      ).toHaveLength(0),
    );
    await user.click(button);
  }

  it.each(CLOSE_WAYS)("sin datos, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await openModal();

    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)(
    "con un monto tecleado, %s pregunta nombrando el cobro y no cierra",
    async (way) => {
      const { dialog, onOpenChange, user } = await openModal();

      await user.type(dialog.getByLabelText("Monto"), "100");

      expect(dispatchBeforeUnload()).toBe(true);

      await closeModalWith(user, TITLE, way);

      const guard = await findGuardDialog();

      expect(guard).toHaveTextContent(GUARD_LABEL);
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    },
  );

  it("el monto de «Completar total pendiente» no cuenta hasta que se edita", async () => {
    const { dialog, onOpenChange, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Completar total pendiente" }));

    expect(dialog.getByLabelText("Monto")).toHaveValue("430.5");
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();

    await user.clear(dialog.getByLabelText("Monto"));
    await user.type(dialog.getByLabelText("Monto"), "430");

    expect(dispatchBeforeUnload()).toBe(true);

    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(
      `Cobro de ${money(430)} a Maria Perez sin registrar`,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("precargado con «Completar total pendiente» y sin tocar: Esc cierra directo", async () => {
    const { dialog, onOpenChange, user } = await openModal();

    await user.click(dialog.getByRole("button", { name: "Completar total pendiente" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cambiar el método cuenta como dato tecleado", async () => {
    const { dialog, user } = await openModal();

    await user.selectOptions(dialog.getByLabelText("Metodo"), "efectivo_usd");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent("Cobro a Maria Perez sin registrar");
  });

  it("«Seguir aquí» conserva lo tecleado y devuelve el foco al campo", async () => {
    const { dialog, onOpenChange, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await user.type(dialog.getByLabelText("Notas"), "Abono de la semana");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(dialog.getByLabelText("Monto")).toHaveValue("100");
    expect(dialog.getByLabelText("Notas")).toHaveValue("Abono de la semana");
    expect(dialog.getByLabelText("Notas")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(postCount()).toBe(0);
  });

  it("«Salir» descarta: al reabrir el formulario está limpio y cierra sin preguntar", async () => {
    const { dialog, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(dispatchBeforeUnload()).toBe(false);

    await user.click(screen.getByRole("button", { name: "reabrir modal" }));

    const reopened = within(await screen.findByRole("dialog", { name: TITLE }));

    expect(await reopened.findByLabelText("Monto")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("«Volver» desde el reparto (paso de confirmación interno) regresa al formulario sin disparar el guardia", async () => {
    const { dialog, onOpenChange, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await press(dialog, user, "Ver reparto");

    expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();

    await press(dialog, user, "Volver");

    expect(dialog.getByLabelText("Monto")).toHaveValue("100");
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(postCount()).toBe(0);
  });

  it("en el reparto, Esc también pregunta y «Seguir aquí» deja el reparto a la vista", async () => {
    const { dialog, onOpenChange, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await press(dialog, user, "Ver reparto");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);

    await answerGuard(user, "Seguir aquí");

    expect(dialog.getByRole("list", { name: "Reparto del abono" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("tras registrar el abono con éxito el guardia queda inactivo y «Cerrar» no pregunta", async () => {
    const { dialog, onOpenChange, onSettled, user } = await openModal();

    await user.type(dialog.getByLabelText("Monto"), "100");
    await press(dialog, user, "Ver reparto");
    await press(dialog, user, "Confirmar abono");

    expect(await dialog.findByText(/Abono registrado: 1 pago por/)).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(postCount()).toBe(1);
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();

    await press(dialog, user, "Cerrar");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("proveedor: nombra el pago con su monto y el contacto", async () => {
    const { dialog, user } = await openModal("purchase", "Distribuidora X");

    await user.type(dialog.getByLabelText("Monto"), "120");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(
      `Pago de ${money(120)} a Distribuidora X sin registrar`,
    );
  });
});
