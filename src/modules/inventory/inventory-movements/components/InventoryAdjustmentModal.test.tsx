import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

const products = {
  items: [{ currentStock: 10, id: "prod-cable", name: "Cable HDMI", sku: "ELE-CAB-001" }],
  limit: 100,
  skip: 0,
  total: 1,
};

async function openAndFill(quantity = "2") {
  fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));
  await screen.findByRole("option", { name: /Cable HDMI/ });
  fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: quantity } });
}

function getForm() {
  const form = document.getElementById("inventory-adjustment-form");

  if (!form) {
    throw new Error("El formulario de ajuste no esta montado.");
  }

  return form;
}

describe("InventoryAdjustmentModal · tipos del ajuste libre (R4)", () => {
  it("no ofrece devolucion de cliente ni a proveedor", async () => {
    installFetchStub(() => products);

    render(<InventoryAdjustmentModal defaultProductId="prod-cable" />, {
      wrapper: createQueryWrapper(),
    });
    await openAndFill();

    const typeOptions = within(screen.getByLabelText("Tipo de movimiento"))
      .getAllByRole<HTMLOptionElement>("option")
      .map((option) => option.value)
      .filter(Boolean);

    expect(typeOptions).toEqual(["ajuste_entrada", "ajuste_salida", "inventario_inicial"]);
    expect(screen.queryByRole("option", { name: /devoluci/i })).toBeNull();
  });
});

describe("InventoryAdjustmentModal · idempotencia (C6)", () => {
  it("doble envio = un solo POST, con clave, y el boton queda deshabilitado", async () => {
    const api = installFetchStub(() => products);
    const release = api.holdNextPost({ data: { id: "mov-1" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-cable" />, {
      wrapper: createQueryWrapper(),
    });
    await openAndFill();

    fireEvent.submit(getForm());
    fireEvent.submit(getForm());

    await waitFor(() => expect(screen.getByRole("button", { name: "Registrando..." })).toBeDisabled());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/adjustments");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      productId: "prod-cable",
      quantityDelta: 2,
    });

    await act(async () => {
      release();
    });
    // El exito lo confirma el servidor: solo entonces se cierra el dialogo.
    await waitFor(() => expect(document.getElementById("inventory-adjustment-form")).toBeNull());
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la clave; tras el exito se renueva", async () => {
    const api = installFetchStub(() => products);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "mov-1" } });
    api.respondToNextPost({ data: { id: "mov-2" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-cable" />, {
      wrapper: createQueryWrapper(),
    });
    await openAndFill();

    fireEvent.submit(getForm());
    await screen.findByText("Failed to fetch");
    expect(document.getElementById("inventory-adjustment-form")).not.toBeNull();

    fireEvent.submit(getForm());
    await waitFor(() => expect(document.getElementById("inventory-adjustment-form")).toBeNull());

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);

    await openAndFill();
    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(3));

    expect(api.posts[2]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("tras un 4xx definitivo, cambiar el contenido estrena clave", async () => {
    const api = installFetchStub(() => products);
    api.respondToNextPost({ error: { code: "BAD_REQUEST", message: "Dato invalido" } }, 400);
    api.respondToNextPost({ data: { id: "mov-1" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-cable" />, {
      wrapper: createQueryWrapper(),
    });
    await openAndFill("2");

    fireEvent.submit(getForm());
    await screen.findByText("Dato invalido");

    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "3" } });
    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.quantityDelta).toBe(3);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});
