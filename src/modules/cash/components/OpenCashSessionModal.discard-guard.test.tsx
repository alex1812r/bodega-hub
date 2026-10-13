import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import { OpenCashSessionModal } from "./OpenCashSessionModal";

/**
 * CNF-15 · apertura de caja: el fondo precargado con el último cierre no cuenta
 * como tecleado; al cambiar un monto, cerrar pregunta nombrando la caja.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mutateAsync = jest.fn();
const mockLastClosure: { data: { closingRef: number; closingVes: number } | null } = { data: null };

jest.mock("../hooks/useCash", () => ({
  useLastUntransferredClosure: () => ({
    data: mockLastClosure.data,
    isFetching: false,
    isLoading: false,
  }),
  useOpenCashSession: () => ({ isPending: false, mutateAsync }),
}));

const TITLE = "Abrir caja";
const GUARD_LABEL = "Apertura de caja «Caja 1» sin terminar";

async function renderModal() {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = jest.fn();

  render(
    <ControlledHost onOpenChange={onOpenChange}>
      {(host) => <OpenCashSessionModal {...host} registerId="reg-1" registerName="Caja 1" />}
    </ControlledHost>,
  );
  await settleDialog();

  return { onOpenChange, user };
}

describe("OpenCashSessionModal · guardia de datos tecleados (CNF-15)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
    mockLastClosure.data = null;
  });

  it.each(CLOSE_WAYS)("sin montos, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await renderModal();

    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)("con un monto tecleado, %s pregunta nombrando la caja y no cierra", async (way) => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Apertura Bs."), "500");

    expect(dispatchBeforeUnload()).toBe(true);

    await closeModalWith(user, TITLE, way);

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("precargado con el último cierre y sin tocar: cierra directo", async () => {
    mockLastClosure.data = { closingRef: 12, closingVes: 800 };
    const { onOpenChange, user } = await renderModal();

    expect(screen.getByLabelText("Apertura Bs.")).toHaveValue("800");
    expect(screen.getByLabelText("Apertura REF")).toHaveValue("12");
    expect(dispatchBeforeUnload()).toBe(false);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("precargado y editado: pregunta; «Seguir aquí» conserva lo tecleado y el foco", async () => {
    mockLastClosure.data = { closingRef: 12, closingVes: 800 };
    const { onOpenChange, user } = await renderModal();

    await user.clear(screen.getByLabelText("Apertura Bs."));
    await user.type(screen.getByLabelText("Apertura Bs."), "750");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);

    await answerGuard(user, "Seguir aquí");

    expect(screen.getByLabelText("Apertura Bs.")).toHaveValue("750");
    expect(screen.getByLabelText("Apertura REF")).toHaveValue("12");
    expect(screen.getByLabelText("Apertura Bs.")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("«Salir» descarta: al reabrir el formulario cierra sin preguntar", async () => {
    const { user } = await renderModal();

    await user.type(screen.getByLabelText("Apertura Bs."), "500");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "reabrir modal" }));
    await settleDialog();

    expect(screen.getByLabelText("Apertura Bs.")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("tras abrir la caja con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const { onOpenChange, user } = await renderModal();

    await user.type(screen.getByLabelText("Apertura Bs."), "500");
    await user.click(screen.getByRole("button", { name: "Abrir caja" }));

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });
});
