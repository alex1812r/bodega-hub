import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ConfirmActionModal, type ConfirmActionModalProps } from "./ConfirmActionModal";

type HarnessProps = Partial<ConfirmActionModalProps>;

function renderModal(props: HarnessProps = {}) {
  const onConfirm = props.onConfirm ?? jest.fn();
  const onOpenChange = props.onOpenChange ?? jest.fn();

  const view = render(
    <ConfirmActionModal
      confirmLabel="Anular venta"
      description="La venta quedará anulada."
      open
      title="Anular venta V-0012"
      {...props}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  );

  return { ...view, onConfirm, onOpenChange };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

async function flushDeferredClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("ConfirmActionModal", () => {
  it("renders title, description and the explicit action labels", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Anular venta V-0012" });

    expect(within(dialog).getByText("La venta quedará anulada.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Anular venta" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled();
    expect(screen.queryByText("Qué va a pasar")).not.toBeInTheDocument();
  });

  it("lists effects with and without before/after values", () => {
    renderModal({
      effects: [
        { after: "17", before: "12", label: "Stock de Harina PAN", tone: "positive" },
        { after: "Anulada", label: "Estado de la venta", tone: "danger" },
        { before: "Bs 1.200,00", label: "Pago en efectivo" },
        { label: "El historial se conserva" },
      ],
    });

    const list = screen.getByRole("list", { name: "Qué va a pasar" });
    const items = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(4);

    expect(items[0]).toHaveTextContent("Stock de Harina PAN");
    expect(within(items[0]).getByText("12")).toBeVisible();
    expect(within(items[0]).getByText("17")).toBeVisible();
    expect(within(items[0]).getByText("pasa a")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("data-tone", "positive");

    expect(within(items[1]).getByText("Anulada")).toBeVisible();
    expect(within(items[1]).queryByText("pasa a")).not.toBeInTheDocument();
    expect(items[1]).toHaveAttribute("data-tone", "danger");

    expect(within(items[2]).getByText("Bs 1.200,00")).toBeVisible();
    expect(within(items[2]).queryByText("pasa a")).not.toBeInTheDocument();

    expect(items[3]).toHaveTextContent(/^El historial se conserva$/);
    expect(items[3]).toHaveAttribute("data-tone", "neutral");
  });

  it("renders custom effects through renderEffects", () => {
    renderModal({
      effects: [{ label: "No debe verse" }],
      renderEffects: () => <p>Vuelven Bs 500,00 a la caja principal</p>,
    });

    expect(screen.getByText("Qué va a pasar")).toBeVisible();
    expect(screen.getByText("Vuelven Bs 500,00 a la caja principal")).toBeVisible();
    expect(screen.queryByText("No debe verse")).not.toBeInTheDocument();
  });

  it("focuses Cancel first in the danger variant", () => {
    renderModal({ variant: "danger" });

    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("focuses the confirm button first in the default variant", () => {
    renderModal();

    expect(screen.getByRole("button", { name: "Anular venta" })).toHaveFocus();
  });

  it("focuses the typed confirmation field when one is required", () => {
    renderModal({ requireTypedConfirmation: "ANULAR", variant: "danger" });

    expect(screen.getByRole("textbox", { name: "Palabra de confirmación" })).toHaveFocus();
  });

  it.each(["anular", "ANULAR", " Anular "])(
    "enables the confirm button when the user types %p",
    async (typed) => {
      const user = userEvent.setup();
      const { onConfirm } = renderModal({ requireTypedConfirmation: "ANULAR" });
      const confirmButton = screen.getByRole("button", { name: "Anular venta" });
      const field = screen.getByRole("textbox", { name: "Palabra de confirmación" });

      expect(confirmButton).toBeDisabled();
      expect(field).toHaveAccessibleDescription(/Escribe ANULAR para habilitar «Anular venta»/);

      await user.type(field, "anul");
      expect(confirmButton).toBeDisabled();

      await user.clear(field);
      await user.type(field, typed);
      expect(confirmButton).toBeEnabled();

      await user.click(confirmButton);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores Enter in the typed field until the word matches", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({ requireTypedConfirmation: "ANULAR" });
    const field = screen.getByRole("textbox", { name: "Palabra de confirmación" });

    await user.type(field, "anu{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(field, "lar{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks confirm, cancel and Escape while pending", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = renderModal({ isPending: true });

    const confirmButton = screen.getByRole("button", { name: "Procesando..." });

    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();

    await user.click(confirmButton);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Cerrar modal" }));
    await flushDeferredClose();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("runs onConfirm once on double click while the promise is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirm = jest.fn(() => pending.promise);
    const { onOpenChange } = renderModal({ onConfirm });

    await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Procesando..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();

    await user.keyboard("{Escape}");
    await flushDeferredClose();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(await screen.findByRole("button", { name: "Anular venta" })).toBeEnabled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("runs onConfirm once when Enter is pressed repeatedly", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirm = jest.fn(() => pending.promise);
    renderModal({ onConfirm });

    expect(screen.getByRole("button", { name: "Anular venta" })).toHaveFocus();
    await user.keyboard("{Enter}{Enter}{Enter}");

    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
  });

  it("stays open after a rejected promise and allows a retry", async () => {
    const user = userEvent.setup();
    const onConfirm = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("La caja está cerrada"))
      .mockResolvedValueOnce(undefined);
    const { onOpenChange } = renderModal({ onConfirm });

    await user.click(screen.getByRole("button", { name: "Anular venta" }));

    const retryButton = await screen.findByRole("button", { name: "Anular venta" });
    await waitFor(() => expect(retryButton).toBeEnabled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.click(retryButton);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the error message as is", () => {
    renderModal({ error: "No hay stock suficiente para revertir (PT409)" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /^No hay stock suficiente para revertir \(PT409\)$/,
    );
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = renderModal({ variant: "danger" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes with the cancel button using a custom label", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = renderModal({ cancelLabel: "Volver" });

    await user.click(screen.getByRole("button", { name: "Volver" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("clears the typed word when reopened", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(true);

      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Reabrir
          </button>
          <ConfirmActionModal
            confirmLabel="Anular venta"
            description="La venta quedará anulada."
            onConfirm={jest.fn()}
            onOpenChange={setOpen}
            open={open}
            requireTypedConfirmation="ANULAR"
            title="Anular venta V-0012"
          />
        </>
      );
    }

    render(<Harness />);

    await user.type(screen.getByRole("textbox", { name: "Palabra de confirmación" }), "anular");
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeEnabled();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reabrir" }));

    expect(await screen.findByRole("textbox", { name: "Palabra de confirmación" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeDisabled();
  });
});
