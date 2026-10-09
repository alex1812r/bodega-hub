import "@testing-library/jest-dom";
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

import { VaultCashMovementModal } from "./VaultCashMovementModal";

/**
 * CNF-15 · retiro y depósito del baúl: con un monto o una nota tecleados, cerrar
 * pregunta nombrando la operación; vacío, o tras registrar, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mutateAsync = jest.fn();
const vaultQuery = {
  data: { balanceEfectivoVes: 1000, balanceRef: 20, balanceVes: 5000 },
  error: null,
  refetch: jest.fn(),
};

jest.mock("../../hooks/useVault", () => ({
  useVault: () => vaultQuery,
}));

const TITLE = "Retirar efectivo";
const CONFIRM_TITLE = "Confirmar retiro del baúl";

async function renderModal(kind: "deposit" | "withdrawal" = "withdrawal") {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = jest.fn();

  render(
    <ControlledHost onOpenChange={onOpenChange}>
      {(host) => (
        <VaultCashMovementModal kind={kind} mutation={{ isPending: false, mutateAsync }} {...host} />
      )}
    </ControlledHost>,
  );
  await settleDialog();

  return { onOpenChange, user };
}

describe("VaultCashMovementModal · guardia de datos tecleados (CNF-15)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it.each(CLOSE_WAYS)("sin datos, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await renderModal();

    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)("con un monto tecleado, %s pregunta nombrando el retiro y no cierra", async (way) => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await closeModalWith(user, TITLE, way);

    const guard = await findGuardDialog();

    expect(guard).toHaveTextContent(/Retiro del baúl de Bs\.?\s?250,00 sin registrar/);
    expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("solo con una nota también pregunta; el depósito se nombra como depósito", async () => {
    const { user } = await renderModal("deposit");

    await user.type(screen.getByLabelText("Nota (opcional)"), "Fondo de la semana");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent("Depósito al baúl sin registrar");
  });

  it("«Seguir aquí» conserva lo tecleado y devuelve el foco al campo", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.type(screen.getByLabelText("Nota (opcional)"), "Pago al transportista");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(screen.getByLabelText("Monto Bs.")).toHaveValue("250");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Pago al transportista");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("«Salir» cierra y descarta: al reabrir está vacío y cierra sin preguntar", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "reabrir modal" }));
    await settleDialog();

    expect(screen.getByLabelText("Monto Bs.")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("con datos avisa al recargar y pregunta al ir a otra pantalla", async () => {
    const { user } = await renderModal();

    await user.type(screen.getByLabelText("Monto REF"), "5");

    expect(dispatchBeforeUnload()).toBe(true);

    clickLinkToAnotherRoute();

    expect(await findGuardDialog()).toHaveTextContent(/Retiro del baúl de .*5[.,]00 sin registrar/);
  });

  it("cancelar la confirmación interna vuelve al formulario sin disparar el guardia", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const confirm = await screen.findByRole("dialog", { name: CONFIRM_TITLE });

    await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(screen.getByLabelText("Monto Bs.")).toHaveValue("250");
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Esc sobre la confirmación interna solo cierra la confirmación", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("si el guardia pregunta con la confirmación abierta, no se apilan: la confirmación se oculta y vuelve con «Seguir aquí»", async () => {
    const { user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    clickLinkToAnotherRoute();

    await findGuardDialog();
    expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument();

    await answerGuard(user, "Seguir aquí");

    expect(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("tras registrar con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Retirar efectivo",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("si el servidor rechaza, lo tecleado sigue sin registrar y cerrar vuelve a preguntar", async () => {
    mutateAsync.mockRejectedValue(new Error("PT409"));
    const { user } = await renderModal();

    await user.type(screen.getByLabelText("Monto Bs."), "250");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const confirm = await screen.findByRole("dialog", { name: CONFIRM_TITLE });

    await user.click(within(confirm).getByRole("button", { name: "Retirar efectivo" }));
    await within(confirm).findByText("PT409");
    await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    await closeModalWith(user, TITLE, "Cancelar");

    expect(await findGuardDialog()).toHaveTextContent(/Retiro del baúl de .*250,00 sin registrar/);
  });
});
