import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ProcessGuardModal } from "@/shared/components/ProcessGuard";

import { useFormModalDiscardGuard } from "./useFormModalDiscardGuard";
import {
  answerGuard,
  clickLinkToAnotherRoute,
  dispatchBeforeUnload,
  findGuardDialog,
  queryGuardDialog,
} from "./useFormModalDiscardGuard.testUtils";

/**
 * CNF-15 · guardia de un formulario en modal: pregunta antes de cerrar solo con
 * cambios, nombra el proceso, «Seguir aquí» devuelve el foco y «Salir» cierra.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn() };

jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

function Form({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const { guard, requestClose, trackFocus } = useFormModalDiscardGuard({
    active: name !== "" && !saved,
    label: `Formulario de «${name}» sin guardar`,
  });

  return (
    <div onFocus={trackFocus}>
      <label>
        Nombre
        <input onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label>
        Nota
        <input />
      </label>
      <button onClick={() => requestClose(onClose)} type="button">
        Cerrar
      </button>
      <button onClick={() => setSaved(true)} type="button">
        Guardar
      </button>
      <ProcessGuardModal guard={guard} />
    </div>
  );
}

function renderForm() {
  const user = userEvent.setup({ delay: null });
  const onClose = jest.fn();

  render(<Form onClose={onClose} />);

  return { onClose, user };
}

describe("useFormModalDiscardGuard (CNF-15)", () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
  });

  it("sin cambios cierra en el acto, sin pregunta ni aviso al recargar", async () => {
    const { onClose, user } = renderForm();

    expect(dispatchBeforeUnload()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("con cambios pregunta nombrando el proceso y no cierra; al recargar avisa", async () => {
    const { onClose, user } = renderForm();

    await user.type(screen.getByLabelText("Nombre"), "Harina");

    expect(dispatchBeforeUnload()).toBe(true);

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    const guard = await findGuardDialog();

    expect(guard).toHaveTextContent("Formulario de «Harina» sin guardar");
    expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Seguir aquí» conserva lo tecleado y devuelve el foco al elemento que pidió el cierre", async () => {
    const { onClose, user } = renderForm();

    await user.type(screen.getByLabelText("Nombre"), "Harina");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await answerGuard(user, "Seguir aquí");

    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina");
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("«Salir» cierra una sola vez", async () => {
    const { onClose, user } = renderForm();

    await user.type(screen.getByLabelText("Nombre"), "Harina");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await answerGuard(user, "Salir");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("una pregunta que no viene de cerrar (enlace a otra pantalla) devuelve el foco al último campo", async () => {
    const { onClose, user } = renderForm();

    await user.type(screen.getByLabelText("Nombre"), "Harina");
    await user.click(screen.getByLabelText("Nota"));
    // El foco se pierde (clic en el menú) antes de que el guardia pregunte.
    (document.activeElement as HTMLElement).blur();
    clickLinkToAnotherRoute();

    const guard = await findGuardDialog();

    await user.click(within(guard).getByRole("button", { name: "Seguir aquí" }));

    await waitFor(() => expect(queryGuardDialog()).not.toBeInTheDocument());
    expect(screen.getByLabelText("Nota")).toHaveFocus();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("al dejar de estar activo (proceso terminado) ni pregunta ni avisa", async () => {
    const { onClose, user } = renderForm();

    await user.type(screen.getByLabelText("Nombre"), "Harina");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });
});
