import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CashSession } from "@/modules/cash/types";
import {
  answerGuard,
  CLOSE_WAYS,
  closeModalWith,
  ControlledHost,
  dispatchBeforeUnload,
  findGuardDialog,
  queryDialogByTitle,
  queryGuardDialog,
  settleDialog,
} from "@/shared/hooks/useFormModalDiscardGuard.testUtils";

import { VaultTransferFromCashModal } from "./VaultTransferFromCashModal";

/**
 * CNF-15 · transferencia de cierres al baúl: con cierres seleccionados o una
 * nota, cerrar pregunta; sin nada, o tras transferir, cierra sin preguntar.
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
  useTransferFromCash: () => ({ isPending: false, mutateAsync }),
  useVault: () => vaultQuery,
}));

function closure(id: string, name: string): CashSession {
  return {
    closedAt: "2026-10-08T21:00:00.000Z",
    closingRef: 10,
    closingVes: 900,
    id,
    openedAt: "2026-10-08T12:00:00.000Z",
    openingRef: 0,
    openingVes: 0,
    register: {
      createdAt: "2026-10-01T12:00:00.000Z",
      id: `register-${id}`,
      isActive: true,
      name,
      storeId: "store-1",
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    registerId: `register-${id}`,
    status: "closed",
    theoreticalClosingRef: 10,
    theoreticalClosingVes: 900,
  };
}

const mockPendingClosures = [closure("a", "Caja 1"), closure("b", "Caja 2")];

jest.mock("../../../cash/hooks/useCash", () => ({
  usePendingCashClosures: () => ({ data: mockPendingClosures, isLoading: false }),
}));

const TITLE = "Transferir cierres al baúl";
const CONFIRM_TITLE = "Confirmar transferencia al baúl";

async function renderModal() {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = jest.fn();

  render(
    <ControlledHost onOpenChange={onOpenChange}>
      {(host) => <VaultTransferFromCashModal {...host} />}
    </ControlledHost>,
  );
  await settleDialog();

  return { onOpenChange, user };
}

describe("VaultTransferFromCashModal · guardia de datos tecleados (CNF-15)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it.each(CLOSE_WAYS)("sin selección ni nota, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await renderModal();

    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)("con cierres seleccionados, %s pregunta nombrando la transferencia", async (way) => {
    const { onOpenChange, user } = await renderModal();

    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.click(screen.getByRole("checkbox", { name: /Caja 2/ }));

    expect(dispatchBeforeUnload()).toBe(true);

    await closeModalWith(user, TITLE, way);

    expect(await findGuardDialog()).toHaveTextContent(
      "Transferencia de 2 cierres al baúl sin registrar",
    );
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("marcar y desmarcar un cierre vuelve al estado inicial: cierra directo", async () => {
    const { user } = await renderModal();

    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("«Seguir aquí» conserva la selección y la nota", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.type(screen.getByLabelText("Nota (opcional)"), "Cierre del lunes");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(
      "Transferencia de 1 cierre al baúl sin registrar",
    );

    await answerGuard(user, "Seguir aquí");

    expect(screen.getByRole("checkbox", { name: /Caja 1/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Caja 2/ })).not.toBeChecked();
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Cierre del lunes");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("«Salir» descarta la selección: al reabrir no queda nada marcado", async () => {
    const { user } = await renderModal();

    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "reabrir modal" }));

    expect(screen.getByRole("checkbox", { name: /Caja 1/ })).not.toBeChecked();
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("cancelar la confirmación interna vuelve al formulario sin disparar el guardia", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Cancelar",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Caja 1/ })).toBeChecked();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("tras transferir con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.click(screen.getByRole("checkbox", { name: /Caja 1/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Transferir cierres",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });
});
