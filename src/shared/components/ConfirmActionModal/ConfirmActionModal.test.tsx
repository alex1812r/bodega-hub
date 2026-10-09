import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ActionsMenu } from "../ActionsMenu/ActionsMenu";
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

function modalElement(props: HarnessProps, onConfirm: () => void | Promise<void>) {
  return (
    <ConfirmActionModal
      confirmLabel="Anular venta"
      description="La venta quedará anulada."
      onOpenChange={jest.fn()}
      open
      title="Anular venta V-0012"
      {...props}
      onConfirm={onConfirm}
    />
  );
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

    expect(within(items[3]).getByText("El historial se conserva")).toBeVisible();
    expect(items[3]).toHaveAttribute("data-tone", "neutral");
  });

  it.each([
    ["neutral", "lucide-minus", "Información:"],
    ["positive", "lucide-circle-check", "Efecto favorable:"],
    ["warning", "lucide-triangle-alert", "Aviso:"],
    ["danger", "lucide-octagon-alert", "Efecto crítico:"],
  ] as const)(
    "marks the %s tone with its own icon and screen reader text",
    (tone, iconClass, text) => {
      renderModal({ effects: [{ label: "Estado de la venta", tone }] });

      const item = within(screen.getByRole("list", { name: "Qué va a pasar" })).getByRole(
        "listitem",
      );
      const icon = item.querySelector("svg");

      expect(icon).toHaveClass(iconClass);
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(within(item).getByText(text)).toHaveClass("sr-only");
      expect(item).toHaveTextContent(`${text} Estado de la venta`);
    },
  );

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

  it("shows an error that arrives after opening as is", () => {
    const onConfirm = jest.fn();
    const { rerender } = render(modalElement({}, onConfirm));

    rerender(modalElement({ error: "No hay stock suficiente para revertir (PT409)" }, onConfirm));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /^No hay stock suficiente para revertir \(PT409\)$/,
    );
  });

  describe("re-entry lock with a synchronous onConfirm (SHR-07 F1)", () => {
    it("runs onConfirm once on double click and shows the button as busy", async () => {
      const user = userEvent.setup();
      const { onConfirm } = renderModal();

      await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));

      expect(onConfirm).toHaveBeenCalledTimes(1);

      const busyButton = screen.getByRole("button", { name: "Procesando..." });
      expect(busyButton).toBeDisabled();
      expect(busyButton).toHaveAttribute("aria-busy", "true");
    });

    it("runs onConfirm once when Enter is pressed three times on the button", async () => {
      const user = userEvent.setup();
      const { onConfirm } = renderModal();

      expect(screen.getByRole("button", { name: "Anular venta" })).toHaveFocus();
      await user.keyboard("{Enter}{Enter}{Enter}");

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("runs onConfirm once when Enter is pressed three times on the typed field", async () => {
      const user = userEvent.setup();
      const { onConfirm } = renderModal({ requireTypedConfirmation: "ANULAR" });

      await user.type(
        screen.getByRole("textbox", { name: "Palabra de confirmación" }),
        "anular{Enter}{Enter}{Enter}",
      );

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("allows a retry once isPending goes back to false with an error", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      const { rerender } = render(modalElement({}, onConfirm));

      await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);

      rerender(modalElement({ isPending: true }, onConfirm));
      expect(screen.getByRole("button", { name: "Procesando..." })).toBeDisabled();

      rerender(modalElement({ error: "La caja está cerrada", isPending: false }, onConfirm));
      expect(screen.getByRole("alert")).toHaveTextContent("La caja está cerrada");

      await user.click(screen.getByRole("button", { name: "Anular venta" }));
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it("allows a retry as soon as a new error arrives without isPending", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      const { rerender } = render(modalElement({}, onConfirm));

      await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      rerender(modalElement({ error: "Selecciona una caja" }, onConfirm));

      await user.click(screen.getByRole("button", { name: "Anular venta" }));
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it("releases the lock after the safety timeout when nothing observable happens", async () => {
      jest.useFakeTimers();

      try {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        const { onConfirm } = renderModal();

        await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));
        expect(onConfirm).toHaveBeenCalledTimes(1);

        act(() => {
          jest.advanceTimersByTime(900);
        });
        expect(screen.getByRole("button", { name: "Procesando..." })).toBeDisabled();

        act(() => {
          jest.advanceTimersByTime(200);
        });

        await user.click(screen.getByRole("button", { name: "Anular venta" }));
        expect(onConfirm).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps the lock past the safety timeout while isPending is true", async () => {
      jest.useFakeTimers();

      try {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        const onConfirm = jest.fn();
        const { rerender } = render(modalElement({}, onConfirm));

        await user.click(screen.getByRole("button", { name: "Anular venta" }));
        rerender(modalElement({ isPending: true }, onConfirm));

        act(() => {
          jest.advanceTimersByTime(5000);
        });
        expect(screen.getByRole("button", { name: "Procesando..." })).toBeDisabled();

        rerender(modalElement({ isPending: false }, onConfirm));
        await user.click(screen.getByRole("button", { name: "Anular venta" }));
        expect(onConfirm).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("releases the lock when the modal is closed and reopened", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      const { rerender } = render(modalElement({}, onConfirm));

      await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);

      rerender(modalElement({ open: false }, onConfirm));
      rerender(modalElement({ open: true }, onConfirm));

      await user.click(await screen.findByRole("button", { name: "Anular venta" }));
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });
  });

  describe("stale errors (SHR-07 F2)", () => {
    it("hides the error left by a previous attempt until this opening produces one", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      const staleMessage = "El producto tiene stock";
      const { rerender } = render(modalElement({ error: staleMessage }, onConfirm));

      expect(screen.getByRole("dialog")).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Anular venta" }));
      rerender(modalElement({ error: null, isPending: true }, onConfirm));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      rerender(modalElement({ error: staleMessage, isPending: false }, onConfirm));
      expect(screen.getByRole("alert")).toHaveTextContent(staleMessage);

      rerender(modalElement({ error: staleMessage, open: false }, onConfirm));
      rerender(modalElement({ error: staleMessage, open: true }, onConfirm));

      expect(await screen.findByRole("dialog")).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Anular venta" }));
      rerender(modalElement({ error: null, isPending: true }, onConfirm));
      rerender(modalElement({ error: staleMessage, isPending: false }, onConfirm));

      expect(screen.getByRole("alert")).toHaveTextContent(staleMessage);
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });

    it("shows the same message again when the caller never clears it between attempts", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      const staleMessage = "El producto tiene stock";

      render(modalElement({ error: staleMessage }, onConfirm));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Anular venta" }));

      expect(screen.getByRole("alert")).toHaveTextContent(staleMessage);
    });
  });

  describe("focus return (SHR-07 F3)", () => {
    function FocusHarness({ removeTriggerOnConfirm = false }: { removeTriggerOnConfirm?: boolean }) {
      const [open, setOpen] = useState(false);
      const [hasTrigger, setHasTrigger] = useState(true);

      return (
        <>
          {hasTrigger ? (
            <button onClick={() => setOpen(true)} type="button">
              Anular
            </button>
          ) : null}
          <ConfirmActionModal
            confirmLabel="Anular venta"
            description="La venta quedará anulada."
            onConfirm={() => {
              if (removeTriggerOnConfirm) {
                setHasTrigger(false);
              }
              setOpen(false);
            }}
            onOpenChange={setOpen}
            open={open}
            title="Anular venta V-0012"
            variant="danger"
          />
        </>
      );
    }

    type User = ReturnType<typeof userEvent.setup>;

    it.each([
      ["Escape", (user: User) => user.keyboard("{Escape}")],
      ["Cancelar", (user: User) => user.click(screen.getByRole("button", { name: "Cancelar" }))],
      [
        "the close button",
        (user: User) => user.click(screen.getByRole("button", { name: "Cerrar modal" })),
      ],
      [
        "the caller after confirming",
        (user: User) => user.click(screen.getByRole("button", { name: "Anular venta" })),
      ],
    ])("returns focus to the trigger when closed with %s", async (_label, closeModal) => {
      const user = userEvent.setup();
      render(<FocusHarness />);

      const trigger = screen.getByRole("button", { name: "Anular" });
      await user.click(trigger);
      expect(await screen.findByRole("button", { name: "Cancelar" })).toHaveFocus();

      await closeModal(user);

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("leaves focus alone when the trigger is gone after the action", async () => {
      const user = userEvent.setup();
      render(<FocusHarness removeTriggerOnConfirm />);

      await user.click(screen.getByRole("button", { name: "Anular" }));
      await user.click(await screen.findByRole("button", { name: "Anular venta" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
      await flushDeferredClose();
      expect(document.body).toHaveFocus();
    });

    it("returns focus to the menu button when the trigger was a menu item", async () => {
      const user = userEvent.setup();

      function MenuHarness() {
        const [open, setOpen] = useState(false);

        return (
          <>
            <ActionsMenu actions={[{ label: "Desactivar", onSelect: () => setOpen(true) }]} />
            <ConfirmActionModal
              confirmLabel="Desactivar producto"
              description="El producto quedará inactivo."
              onConfirm={jest.fn()}
              onOpenChange={setOpen}
              open={open}
              title="Confirmar desactivación"
              variant="danger"
            />
          </>
        );
      }

      render(<MenuHarness />);

      const menuButton = screen.getByRole("button", { name: "Abrir acciones" });
      await user.click(menuButton);
      await user.click(screen.getByRole("menuitem", { name: "Desactivar" }));
      expect(await screen.findByRole("dialog")).toBeVisible();

      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(menuButton).toHaveFocus());
    });
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

describe("ConfirmActionModal · effect status (CNF-S1)", () => {
  it("loading: announces the wait, offers no confirm button and closes with «Cerrar» or Escape", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = renderModal({
      effects: [{ label: "Stock de Harina PAN" }],
      requireTypedConfirmation: "ANULAR",
      status: "loading",
      statusHint: "Hasta conocerlo no se puede anular.",
      statusMessage: "Calculando el efecto…",
      variant: "danger",
    });
    const dialog = within(screen.getByRole("dialog"));
    const status = dialog.getByRole("status");

    expect(status).toHaveTextContent("Calculando el efecto…");
    expect(status).toHaveTextContent("Hasta conocerlo no se puede anular.");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    expect(dialog.queryByText("Qué va a pasar")).not.toBeInTheDocument();
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("loading: uses a default message and a custom close label", () => {
    renderModal({ closeLabel: "Volver", status: "loading" });

    expect(screen.getByRole("status")).toHaveTextContent("Calculando qué va a pasar…");
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("error: shows the message as is, never a confirm button, and retries on demand", async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    const { onConfirm, onOpenChange } = renderModal({
      onRetry,
      status: "error",
      statusHint: "No se ha cambiado nada.",
      statusMessage: "Venta no encontrada",
    });
    const dialog = within(screen.getByRole("dialog"));

    expect(dialog.getByRole("alert").textContent).toBe("Venta no encontrada");
    expect(dialog.getByText("No se ha cambiado nada.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(dialog.getByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("error: without onRetry there is no «Reintentar», and Escape closes", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderModal({ status: "error" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo calcular el efecto de la acción.",
    );
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("blocked: shows the reason as is, the content and actions passed in, and no confirm button", async () => {
    const user = userEvent.setup();
    const onAlternative = jest.fn();
    const { onConfirm, onOpenChange } = renderModal({
      blockedActions: (
        <button onClick={onAlternative} type="button">
          Devolver la venta
        </button>
      ),
      children: <p>Venta V-0012 de Cliente Demo</p>,
      effects: [{ label: "Stock de Harina PAN" }],
      onRetry: jest.fn(),
      requireTypedConfirmation: "ANULAR",
      status: "blocked",
      statusMessage: "La venta tiene 1 pago(s) activo(s).",
    });
    const dialog = within(screen.getByRole("dialog"));

    expect(dialog.getByRole("alert").textContent).toBe("La venta tiene 1 pago(s) activo(s).");
    expect(dialog.getByText("Venta V-0012 de Cliente Demo")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(dialog.queryByText("Qué va a pasar")).not.toBeInTheDocument();
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Devolver la venta" }));

    expect(onAlternative).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("blockedActions are only offered while blocked", () => {
    renderModal({ blockedActions: <button type="button">Ver pagos</button> });

    expect(screen.queryByRole("button", { name: "Ver pagos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeEnabled();
  });

  it.each(["loading", "error", "blocked"] as const)(
    "%s: stays locked while pending, as in the ready state",
    async (status) => {
      const user = userEvent.setup();
      const { onOpenChange } = renderModal({ isPending: true, onRetry: jest.fn(), status });

      expect(screen.getByRole("button", { name: "Cerrar" })).toBeDisabled();

      await user.keyboard("{Escape}");
      await flushDeferredClose();

      expect(onOpenChange).not.toHaveBeenCalled();
    },
  );

  it("keeps one dialog from loading to ready and moves focus to the control of each state", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const view = render(modalElement({ status: "loading", variant: "danger" }, onConfirm));
    const dialog = screen.getByRole("dialog");

    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    view.rerender(
      modalElement({ onRetry: jest.fn(), status: "error", variant: "danger" }, onConfirm),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    view.rerender(
      modalElement(
        {
          effects: [{ label: "Stock de Harina PAN" }],
          requireTypedConfirmation: "ANULAR",
          status: "ready",
          variant: "danger",
        },
        onConfirm,
      ),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByText("Qué va a pasar")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Palabra de confirmación" })).toHaveFocus();

    await user.keyboard("anular");
    await user.dblClick(screen.getByRole("button", { name: "Anular venta" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("clears the typed word when the status stops being ready", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    const ready = { requireTypedConfirmation: "ANULAR", status: "ready" } as const;
    const view = render(modalElement(ready, onConfirm));

    await user.type(screen.getByRole("textbox", { name: "Palabra de confirmación" }), "anular");
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeEnabled();

    view.rerender(modalElement({ ...ready, status: "loading" }, onConfirm));
    expect(screen.queryByRole("button", { name: "Anular venta" })).not.toBeInTheDocument();

    view.rerender(modalElement(ready, onConfirm));

    expect(screen.getByRole("textbox", { name: "Palabra de confirmación" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Palabra de confirmación" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Anular venta" })).toBeDisabled();

    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger when it opened loading and closes in another state", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      const [status, setStatus] = useState<"loading" | "blocked">("loading");

      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Anular
          </button>
          <ConfirmActionModal
            confirmLabel="Anular venta"
            description="La venta quedará anulada."
            onConfirm={jest.fn()}
            onOpenChange={setOpen}
            open={open}
            status={status}
            title="Anular venta V-0012"
            variant="danger"
          >
            <button onClick={() => setStatus("blocked")} type="button">
              Llega el efecto
            </button>
          </ConfirmActionModal>
        </>
      );
    }

    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Anular" });

    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Llega el efecto" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

// CNF-F1 · F1: la zona «Qué va a pasar» con scroll no se alcanzaba con teclado.
describe("ConfirmActionModal · zona de efectos con scroll y teclado (CNF-F1)", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  let notifyResize: Array<() => void> = [];
  let contentHeight = 0;

  const longEffects = Array.from({ length: 30 }, (_, index) => ({
    after: String(20 + index),
    before: String(10 + index),
    label: `Stock del producto ${index + 1}`,
  }));

  function isEffectsViewport(element: HTMLElement) {
    return element.classList.contains("overflow-y-auto") && element.closest("section") != null;
  }

  beforeEach(() => {
    notifyResize = [];
    contentHeight = 0;

    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize.push(() => callback([], this));
      }

      disconnect() {}

      observe() {}

      unobserve() {}
    };

    // jsdom no calcula el layout: 346 px visibles de `contentHeight`, como en el reporte.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return isEffectsViewport(this) ? contentHeight : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return isEffectsViewport(this) ? 346 : 0;
      },
    });
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;

    if (scrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
    }
    if (clientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
    }
  });

  function layout(height: number) {
    contentHeight = height;
    act(() => {
      notifyResize.forEach((notify) => notify());
    });
  }

  it("cuando los efectos desbordan, la zona con scroll es un grupo con nombre al que llega Tab", async () => {
    const user = userEvent.setup();
    renderModal({ effects: longEffects });
    layout(445);

    const viewport = screen.getByRole("group", { name: "Qué va a pasar" });

    expect(viewport).toHaveClass("overflow-y-auto");
    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport.className).toMatch(/focus-visible:ring-ring/);
    expect(within(viewport).getAllByRole("listitem")).toHaveLength(30);

    const stops: Array<Element | null> = [];
    for (let index = 0; index < 4; index += 1) {
      await user.tab();
      stops.push(document.activeElement);
    }

    expect(stops).toContain(viewport);
  });

  it("también con efectos a medida (`renderEffects`)", () => {
    renderModal({ renderEffects: () => <p>Vuelven Bs 1.200,00 a la caja principal.</p> });
    layout(445);

    const viewport = screen.getByRole("group", { name: "Qué va a pasar" });

    expect(viewport).toHaveAttribute("tabindex", "0");
    expect(viewport).toHaveTextContent("Vuelven Bs 1.200,00 a la caja principal.");
  });

  it("si los efectos caben, la zona no añade una parada de Tab", async () => {
    const user = userEvent.setup();
    renderModal({ effects: longEffects.slice(0, 2) });
    layout(120);

    const viewport = screen.getByRole("list", { name: "Qué va a pasar" }).parentElement;

    expect(viewport).toHaveClass("overflow-y-auto");
    expect(viewport).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("group", { name: "Qué va a pasar" })).not.toBeInTheDocument();

    for (let index = 0; index < 4; index += 1) {
      await user.tab();
      expect(document.activeElement?.tagName).toBe("BUTTON");
    }
  });

  it("deja de ser una parada de Tab cuando el contenido vuelve a caber", () => {
    renderModal({ effects: longEffects });
    layout(445);
    expect(screen.getByRole("group", { name: "Qué va a pasar" })).toHaveAttribute("tabindex", "0");

    layout(300);

    expect(screen.queryByRole("group", { name: "Qué va a pasar" })).not.toBeInTheDocument();
  });

  it("conserva el foco inicial en el botón de la acción", () => {
    renderModal({ effects: longEffects });
    layout(445);

    expect(screen.getByRole("button", { name: "Anular venta" })).toHaveFocus();
  });
});
