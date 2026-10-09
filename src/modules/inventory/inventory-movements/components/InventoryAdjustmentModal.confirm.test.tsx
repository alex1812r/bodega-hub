/**
 * CNF-08 · ajuste de stock: el formulario no envía; abre una confirmación con
 * el efecto (stock actual → resultante, delta con signo), el tipo y el motivo.
 * Sin motivo o con una salida que dejaría el stock en negativo no se llega a
 * la confirmación. El error del servidor se dice dentro de ella, sin perder lo
 * tecleado en el formulario de debajo.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import {
  buildStockAdjustmentConfirmEffects,
  InventoryAdjustmentModal,
} from "./InventoryAdjustmentModal";

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const lockedProduct = { currentStock: 10, id: "prod-cable", name: "Cable HDMI", sku: "ELE-CAB-001" };
const formId = "inventory-adjustment-form";
const CONFIRM_TITLE = "Confirmar ajuste de stock";
const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);

function renderModal(onOpenChange?: (open: boolean) => void) {
  const api = installFetchStub(() => {
    throw new Error("GET inesperado en el test");
  });

  render(<InventoryAdjustmentModal lockedProduct={lockedProduct} onOpenChange={onOpenChange} open />, {
    wrapper: createQueryWrapper(),
  });

  return api;
}

function fill({ quantity, reason, type }: { quantity: string; reason?: string; type?: string }) {
  fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: quantity } });
  if (type) {
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), { target: { value: type } });
  }
  if (reason !== undefined) {
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: reason } });
  }
}

function submitForm() {
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);
}

function queryConfirm() {
  return screen.queryByRole("dialog", { name: CONFIRM_TITLE });
}

async function openConfirm() {
  submitForm();

  return screen.findByRole("dialog", { name: CONFIRM_TITLE });
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Registrar movimiento" });
}

async function cancelConfirm(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(queryConfirm()).not.toBeInTheDocument());
}

/** Deja pasar un cierre diferido que no debería ocurrir. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("buildStockAdjustmentConfirmEffects", () => {
  it("entrada: +N con el stock antes → después, en tono favorable", () => {
    expect(
      buildStockAdjustmentConfirmEffects("Cable HDMI", {
        delta: 3,
        stockAfter: 13,
        stockBefore: 10,
        wouldBeNegative: false,
      }),
    ).toEqual([{ after: "13", before: "Stock 10", label: "+3 Cable HDMI", tone: "positive" }]);
  });

  it("salida: −N con el stock antes → después, en tono de aviso", () => {
    expect(
      buildStockAdjustmentConfirmEffects("Cable HDMI", {
        delta: -4,
        stockAfter: 6,
        stockBefore: 10,
        wouldBeNegative: false,
      }),
    ).toEqual([{ after: "6", before: "Stock 10", label: "−4 Cable HDMI", tone: "warning" }]);
  });
});

describe("InventoryAdjustmentModal · confirmación con el efecto (CNF-08)", () => {
  it("entrada: muestra producto, tipo, motivo y el stock actual → resultante con el delta", async () => {
    const api = renderModal();
    fill({ quantity: "3", reason: "  Conteo físico del pasillo 3  " });

    const dialog = await openConfirm();
    const effects = within(dialog).getAllByRole("listitem");

    expect(api.posts).toHaveLength(0);
    expect(within(dialog).getByText("Cable HDMI (ELE-CAB-001)")).toBeVisible();
    expect(within(dialog).getByText("Ajuste entrada")).toBeVisible();
    expect(within(dialog).getByText("Conteo físico del pasillo 3")).toBeVisible();
    expect(effects).toHaveLength(1);
    expect(effects[0]).toHaveTextContent(/\+3 Cable HDMI\s*Stock 10\s*pasa a\s*13$/);
    expect(effects[0]).toHaveAttribute("data-tone", "positive");
  });

  it("salida: muestra −N y el stock resultante; sacar todo el stock (queda en 0) se permite", async () => {
    renderModal();
    fill({ quantity: "10", reason: "Merma", type: "ajuste_salida" });

    const dialog = await openConfirm();
    const effects = within(dialog).getAllByRole("listitem");

    expect(within(dialog).getByText("Ajuste salida")).toBeVisible();
    expect(within(dialog).getByText("Merma")).toBeVisible();
    expect(effects[0]).toHaveTextContent(/−10 Cable HDMI\s*Stock 10\s*pasa a\s*0$/);
    expect(effects[0]).toHaveAttribute("data-tone", "warning");
  });

  it("cancelar no envía nada y el formulario conserva lo tecleado", async () => {
    const api = renderModal();
    fill({ quantity: "4", reason: "Merma", type: "ajuste_salida" });

    await cancelConfirm(await openConfirm());

    expect(api.posts).toHaveLength(0);
    expect(document.getElementById(formId)).not.toBeNull();
    expect(screen.getByLabelText("Cantidad")).toHaveValue("4");
    expect(screen.getByLabelText("Tipo de movimiento")).toHaveValue("ajuste_salida");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Merma");
  });

  it("confirmar envía UNA petición aunque haya doble clic, con el motivo y el payload de siempre", async () => {
    const onOpenChange = jest.fn();
    const api = renderModal(onOpenChange);
    const release = api.holdNextPost({ data: { id: "mov-1" } });
    fill({ quantity: "4", reason: " Merma ", type: "ajuste_salida" });

    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Registrar movimiento|Procesando/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/adjustments");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: uuid,
      productId: "prod-cable",
      quantityDelta: -4,
      reason: "Merma",
      type: "ajuste_salida",
    });

    await act(async () => {
      release();
    });
    // Tras el éxito, lo de siempre: se cierra y el formulario queda limpio.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(1);
  });
});

describe("InventoryAdjustmentModal · lo que no llega a la confirmación (CNF-08)", () => {
  // Los tres últimos (CNF-F7 · CAOS-11): caracteres que no se ven tampoco son un motivo.
  it.each([
    "",
    "   ",
    "​​",
    " ​ ‍⁠ ",
    "﻿ ",
  ])("motivo %p: avisa en el campo y no abre la confirmación", async (reason) => {
    const api = renderModal();
    fill({ quantity: "3", reason });

    // Antes de intentar enviar no hay aviso.
    expect(screen.queryByText("Indica el motivo del ajuste.")).not.toBeInTheDocument();

    submitForm();
    await flush();

    expect(screen.getByText("Indica el motivo del ajuste.")).toBeVisible();
    expect(screen.getByLabelText("Motivo")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Motivo")).toHaveAccessibleDescription("Indica el motivo del ajuste.");
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);

    // Al escribirlo, el aviso se va y la confirmación abre.
    fill({ quantity: "3", reason: "Conteo" });
    expect(screen.queryByText("Indica el motivo del ajuste.")).not.toBeInTheDocument();
    expect(await openConfirm()).toBeInTheDocument();
  });

  it("salida mayor que el stock: avisa «Stock insuficiente» y no abre la confirmación", async () => {
    const api = renderModal();
    fill({ quantity: "11", reason: "Merma", type: "ajuste_salida" });

    // La vista previa del formulario ya lo decía.
    expect(screen.getByText("(stock insuficiente)")).toBeVisible();

    submitForm();
    await flush();

    expect(screen.getByText("Stock insuficiente: hay 10 en stock.")).toBeVisible();
    expect(screen.getByLabelText("Cantidad")).toHaveAttribute("aria-invalid", "true");
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    expect(screen.getByLabelText("Motivo")).toHaveValue("Merma");

    // La misma cantidad como entrada no deja el stock en negativo: sí confirma.
    fill({ quantity: "11", type: "ajuste_entrada" });
    expect(screen.queryByText("Stock insuficiente: hay 10 en stock.")).not.toBeInTheDocument();
    expect(await openConfirm()).toHaveTextContent(/\+11 Cable HDMI\s*Stock 10\s*pasa a\s*21/);
  });
});

describe("InventoryAdjustmentModal · error del servidor en la confirmación (CNF-08)", () => {
  // Texto de `adjust_stock` (20261011b) para una entrada a un producto inactivo.
  const inactiveMessage =
    "El producto esta inactivo: reactivalo antes de registrar una entrada de stock";

  it("el PT409 se muestra tal cual dentro de la confirmación; al cancelarla, el formulario sigue intacto", async () => {
    const api = renderModal();
    api.respondToNextPost({ error: { code: "CONFLICT", message: inactiveMessage } }, 409);
    api.respondToNextPost({ data: { id: "mov-1" } });
    fill({ quantity: "3", reason: "Conteo físico" });

    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(inactiveMessage);
    // La confirmación sigue abierta con su efecto y se puede reintentar.
    expect(within(dialog).getByRole("listitem")).toHaveTextContent(/\+3 Cable HDMI/);
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());

    await cancelConfirm(dialog);

    expect(screen.getByLabelText("Cantidad")).toHaveValue("3");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Conteo físico");
    // El rechazo sigue a la vista en el formulario.
    expect(within(document.getElementById(formId) as HTMLElement).getByRole("alert")).toHaveTextContent(
      inactiveMessage,
    );

    // Reintentar lo mismo viaja con la misma clave (409: resultado no definitivo).
    const secondDialog = await openConfirm();

    expect(within(secondDialog).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(confirmButton(secondDialog));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body).toEqual(api.posts[0]?.body);
  });
});
