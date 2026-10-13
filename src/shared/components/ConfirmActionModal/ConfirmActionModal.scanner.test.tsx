import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmActionModal, type ConfirmActionModalProps } from "./ConfirmActionModal";

function renderModal(props: Partial<ConfirmActionModalProps> = {}) {
  const onConfirm = jest.fn();
  const onOpenChange = jest.fn();
  const onScannerInput = jest.fn();

  render(
    <ConfirmActionModal
      confirmLabel="Recibir mercancía"
      description="La mercancía entra al inventario."
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onScannerInput={onScannerInput}
      open
      title="Recibir compra C-0007"
      {...props}
    />,
  );

  return { onConfirm, onOpenChange, onScannerInput };
}

/** Teclea carácter a carácter dejando pasar `gapMs` antes de cada tecla. */
async function press(keys: string[], gapMs: number) {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime, delay: null });

  for (const key of keys) {
    act(() => {
      jest.advanceTimersByTime(gapMs);
    });
    await user.keyboard(key);
  }
}

/** El lector: `gapMs` por tecla y Enter al final, sobre lo que tenga el foco. */
function scan(code: string, gapMs: number) {
  return press([...code.split(""), "{Enter}"], gapMs);
}

function confirmButton(name = "Recibir mercancía") {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ConfirmActionModal · un lector de códigos no pulsa ningún botón (CNF-F7 · CAOS-01, CAOS-07)", () => {
  it.each([
    ["13 dígitos a 5 ms", "7591234567895", 5],
    ["13 dígitos a 120 ms", "7591234567895", 120],
    ["13 dígitos a 300 ms (lector lento)", "7591234567895", 300],
    ["5 dígitos a 80 ms (código corto)", "12345", 80],
    ["SKU con letras y guiones a 80 ms", "HER-TAL-001", 80],
    ["SKU con letras y guiones a 5 ms", "AB-12", 5],
    ["3 caracteres a 80 ms (el mínimo)", "A1B", 80],
  ])("foco inicial en confirmar · %s: no confirma, no cierra y avisa de lo leído", async (_label, code, gapMs) => {
    const { onConfirm, onOpenChange, onScannerInput } = renderModal();

    expect(confirmButton()).toHaveFocus();

    await scan(code, gapMs);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onScannerInput).toHaveBeenCalledTimes(1);
    expect(onScannerInput.mock.calls[0][0]).toBe(code);
    expect(onScannerInput.mock.calls[0][1].keyTimes).toHaveLength(code.length);
  });

  it("foco movido a mano al botón de confirmar de una acción peligrosa: el lector tampoco confirma", async () => {
    const { onConfirm } = renderModal({ confirmLabel: "Anular venta", variant: "danger" });

    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    act(() => confirmButton("Anular venta").focus());

    await scan("7591234567895", 300);
    await scan("HER-TAL-001", 80);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("foco en «Cancelar» o en la X: el Enter del lector no cierra el diálogo", async () => {
    const { onOpenChange } = renderModal({ variant: "danger" });

    await scan("7591234567895", 5);
    act(() => screen.getByRole("button", { name: "Cerrar modal" }).focus());
    await scan("7591234567895", 120);

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("un código con espacios: el espacio de la ráfaga tampoco pulsa el botón enfocado", async () => {
    const { onConfirm, onScannerInput } = renderModal();

    await scan("AB 12 CD", 20);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onScannerInput).toHaveBeenCalledWith("AB 12 CD", expect.anything());
  });

  it("sin `onScannerInput` la lectura simplemente se ignora", async () => {
    const { onConfirm } = renderModal({ onScannerInput: undefined });

    await scan("7591234567895", 120);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("un Enter humano sobre el botón enfocado confirma una vez", async () => {
    const { onConfirm, onScannerInput } = renderModal();

    await press(["{Enter}"], 500);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onScannerInput).not.toHaveBeenCalled();
  });

  it("un Espacio humano sobre el botón enfocado confirma una vez", async () => {
    const { onConfirm } = renderModal();

    await press([" "], 500);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Enter con calma después de una lectura ya ignorada: confirma (la ráfaga no se arrastra)", async () => {
    const { onConfirm } = renderModal();

    await scan("7591234567895", 5);
    expect(onConfirm).not.toHaveBeenCalled();

    await press(["{Enter}"], 500);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("teclas sueltas y, pasado el margen, Enter: es una persona y confirma", async () => {
    const { onConfirm } = renderModal();

    await press(["1", "2", "3", "4"], 80);
    await press(["{Enter}"], 450);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("palabra de confirmación tecleada + Enter en su campo: confirma como siempre", async () => {
    const { onConfirm, onScannerInput } = renderModal({
      confirmLabel: "Anular venta",
      requireTypedConfirmation: "ANULAR",
      variant: "danger",
    });

    expect(screen.getByLabelText("Palabra de confirmación")).toHaveFocus();

    // Tecleada deprisa a propósito: en un campo de texto no se mide el ritmo.
    await scan("anular", 60);

    expect(screen.getByLabelText("Palabra de confirmación")).toHaveValue("anular");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onScannerInput).not.toHaveBeenCalled();
  });

  it("un motivo tecleado en un campo del contexto y Enter: la tecla llega al campo", async () => {
    const onKeyDown = jest.fn();
    const { onConfirm, onScannerInput } = renderModal({
      children: <textarea aria-label="Motivo" onKeyDown={(event) => onKeyDown(event.key)} />,
    });

    act(() => screen.getByLabelText("Motivo").focus());
    await scan("merma", 60);

    expect(screen.getByLabelText("Motivo")).toHaveValue("merma\n");
    expect(onKeyDown).toHaveBeenLastCalledWith("Enter");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onScannerInput).not.toHaveBeenCalled();
  });

  it("con el diálogo cerrado no se escucha el teclado", async () => {
    const { onScannerInput } = renderModal({ open: false });

    await scan("7591234567895", 5);

    expect(onScannerInput).not.toHaveBeenCalled();
  });
});

describe("ConfirmActionModal · el sufijo del lector tampoco pulsa nada (CNF-F10 · CAOS-13)", () => {
  it.each([
    ["CR+LF (dos Enter seguidos)", ["{Enter}"], 5],
    ["Enter×3", ["{Enter}", "{Enter}"], 5],
    ["Enter×3 de un lector lento (200 ms entre cada uno)", ["{Enter}", "{Enter}"], 200],
    ["Enter + Tab + Enter", ["{Tab}", "{Enter}"], 5],
    ["Enter + Espacio", [" "], 5],
    ["Enter + Espacio + Enter", [" ", "{Enter}"], 5],
  ])("%s: no confirma, no cierra y el foco no se mueve", async (_label, suffix, gapMs) => {
    const { onConfirm, onOpenChange, onScannerInput } = renderModal();

    await scan("7501234567890", 5);
    await press(suffix, gapMs);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(confirmButton()).toHaveFocus();
    expect(onScannerInput).toHaveBeenCalledTimes(1);
  });

  it("acción peligrosa con el foco en confirmar: el segundo Enter del lector tampoco ejecuta", async () => {
    const { onConfirm } = renderModal({ confirmLabel: "Anular venta", variant: "danger" });

    act(() => confirmButton("Anular venta").focus());
    await scan("7501234567890", 5);
    await press(["{Enter}"], 5);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("pasado el enfriamiento, un Enter humano confirma una vez", async () => {
    const { onConfirm } = renderModal();

    await scan("7501234567890", 5);
    await press(["{Enter}"], 5);
    expect(onConfirm).not.toHaveBeenCalled();

    await press(["{Enter}"], 500);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("pasado el enfriamiento, Tab vuelve a mover el foco y Espacio vuelve a pulsar", async () => {
    const { onConfirm, onOpenChange } = renderModal();

    await scan("7501234567890", 5);
    await press(["{Enter}"], 5);
    await press(["{Shift>}{Tab}{/Shift}"], 500);

    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await press([" "], 500);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sin lectura delante no hay enfriamiento: un Enter nada más abrir confirma", async () => {
    const { onConfirm, onScannerInput } = renderModal();

    await press(["{Enter}"], 5);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onScannerInput).not.toHaveBeenCalled();
  });
});
