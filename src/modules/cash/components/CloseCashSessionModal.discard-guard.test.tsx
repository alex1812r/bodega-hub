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

import { CloseCashSessionModal } from "./CloseCashSessionModal";

/**
 * CNF-15 · cierre de caja: lo contado se precarga con el teórico y eso no cuenta
 * como tecleado; al cambiar un monto, cerrar pregunta nombrando la caja.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mutateAsync = jest.fn();

jest.mock("../hooks/useCash", () => ({
  useCloseCashSession: () => ({ isPending: false, mutateAsync }),
}));

jest.mock("../../settings/hooks/useSettings", () => ({
  useCashCloseSettings: () => ({ data: { cashCloseDiffAlertVes: 0 } }),
}));

const TITLE = "Cerrar caja";
const CONFIRM_TITLE = "Cerrar caja con faltante";
const GUARD_LABEL = "Cierre de caja «Caja 1» sin terminar";

type User = ReturnType<typeof userEvent.setup>;

async function renderModal() {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = jest.fn();

  render(
    <ControlledHost onOpenChange={onOpenChange}>
      {(host) => (
        <CloseCashSessionModal
          {...host}
          openingRef={10}
          openingVes={500}
          registerName="Caja 1"
          sessionId="session-1"
          theoreticalRef={25.5}
          theoreticalVes={1500.25}
        />
      )}
    </ControlledHost>,
  );
  await settleDialog();

  return { onOpenChange, user };
}

function vesInput() {
  return screen.getByLabelText("Efectivo contado Bs. (cajon completo)");
}

function refInput() {
  return screen.getByLabelText("Efectivo contado REF (cajon completo)");
}

async function count(user: User, input: HTMLElement, value: string) {
  await user.clear(input);
  await user.type(input, value);
}

describe("CloseCashSessionModal · guardia de datos tecleados (CNF-15)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it.each(CLOSE_WAYS)("con lo precargado sin tocar, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await renderModal();

    expect(vesInput()).toHaveValue("1500.25");
    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)("con un monto cambiado, %s pregunta nombrando la caja y no cierra", async (way) => {
    const { onOpenChange, user } = await renderModal();

    await count(user, vesInput(), "1400");

    expect(dispatchBeforeUnload()).toBe(true);

    await closeModalWith(user, TITLE, way);

    const guard = await findGuardDialog();

    expect(guard).toHaveTextContent(GUARD_LABEL);
    expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("teclear y volver al monto precargado no cuenta: cierra directo", async () => {
    const { user } = await renderModal();

    await count(user, refInput(), "20");
    await count(user, refInput(), "25.5");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("«Seguir aquí» conserva lo contado y devuelve el foco al campo", async () => {
    const { onOpenChange, user } = await renderModal();

    await count(user, vesInput(), "1400");
    await count(user, refInput(), "20");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(vesInput()).toHaveValue("1400");
    expect(refInput()).toHaveValue("20");
    expect(refInput()).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("«Salir» descarta: al reabrir vuelve el teórico precargado y cierra sin preguntar", async () => {
    const { user } = await renderModal();

    await count(user, vesInput(), "1400");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "reabrir modal" }));
    await settleDialog();

    expect(vesInput()).toHaveValue("1500.25");
    expect(dispatchBeforeUnload()).toBe(false);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("cancelar la confirmación de faltante vuelve al formulario sin disparar el guardia", async () => {
    const { onOpenChange, user } = await renderModal();

    await count(user, vesInput(), "1400");
    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Cancelar",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(vesInput()).toHaveValue("1400");
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("si el guardia pregunta con la confirmación abierta, no se apilan los tres niveles", async () => {
    const { user } = await renderModal();

    await count(user, vesInput(), "1400");
    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));
    await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    clickLinkToAnotherRoute();

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
    expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument();

    await answerGuard(user, "Seguir aquí");

    expect(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("tras cerrar la caja con éxito (con faltante confirmado) no pregunta y el guardia queda inactivo", async () => {
    const { onOpenChange, user } = await renderModal();

    await count(user, vesInput(), "1400");
    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Cerrar con faltante",
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

  it("tras cerrar la caja con un sobrante (sin confirmación) tampoco pregunta", async () => {
    const { onOpenChange, user } = await renderModal();

    await count(user, vesInput(), "1600");
    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("si el servidor rechaza el cierre, lo contado sigue sin terminar y cerrar pregunta", async () => {
    mutateAsync.mockRejectedValue(new Error("PT409"));
    const { user } = await renderModal();

    await count(user, vesInput(), "1600");
    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));
    await screen.findByText("PT409");
    await closeModalWith(user, TITLE, "Cancelar");

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
  });
});
