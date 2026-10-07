import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

describe("InventoryAdjustmentModal · producto bloqueado y apertura controlada (PRO-03)", () => {
  const lockedProduct = { currentStock: 10, id: "prod-cable", name: "Cable HDMI", sku: "ele-cab-001" };

  it("con lockedProduct muestra el producto fijo, sin selector y sin pedir el catalogo", async () => {
    const gets: string[] = [];
    installFetchStub((url) => {
      gets.push(url);

      return products;
    });

    render(<InventoryAdjustmentModal lockedProduct={lockedProduct} />, {
      wrapper: createQueryWrapper(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));

    const productField = await screen.findByLabelText("Producto");

    expect(productField.tagName).toBe("INPUT");
    expect(productField).toHaveValue("Cable HDMI (ele-cab-001)");
    expect(productField).toBeDisabled();
    expect(productField).toHaveAttribute("readonly");
    expect(screen.queryByRole("option", { name: /Cable HDMI/ })).toBeNull();
    expect(screen.getByText("Stock actual:")).toHaveTextContent("Stock actual: 10");
    expect(gets).toEqual([]);

    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Tipo de movimiento"), {
      target: { value: "ajuste_salida" },
    });

    expect(screen.getByText("6")).toBeVisible();
  });

  it("controlado: abre sin boton propio, envia el producto bloqueado con clave y avisa del cierre", async () => {
    const api = installFetchStub(() => products);
    const onOpenChange = jest.fn();
    api.respondToNextPost({ data: { id: "mov-1" } });

    render(
      <InventoryAdjustmentModal lockedProduct={lockedProduct} onOpenChange={onOpenChange} open />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByRole("dialog", { name: "Ajuste de stock" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar ajuste" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "2" } });
    fireEvent.submit(getForm());
    fireEvent.submit(getForm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      productId: "prod-cable",
      quantityDelta: 2,
      type: "ajuste_entrada",
    });
  });

  it("controlado: cancelar avisa del cierre sin enviar nada", async () => {
    const api = installFetchStub(() => products);
    const onOpenChange = jest.fn();

    render(
      <InventoryAdjustmentModal lockedProduct={lockedProduct} onOpenChange={onOpenChange} open />,
      { wrapper: createQueryWrapper() },
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.posts).toHaveLength(0);
  });

  it("sin controlar tambien avisa de la apertura y del cierre", async () => {
    installFetchStub(() => products);
    const onOpenChange = jest.fn();

    render(<InventoryAdjustmentModal onOpenChange={onOpenChange} />, {
      wrapper: createQueryWrapper(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));
    await screen.findByRole("option", { name: /Cable HDMI/ });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(document.getElementById("inventory-adjustment-form")).toBeNull());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
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

describe("InventoryAdjustmentModal · cantidad entera (SHR-09J)", () => {
  async function renderOpen() {
    const api = installFetchStub(() => products);

    render(<InventoryAdjustmentModal defaultProductId="prod-cable" />, {
      wrapper: createQueryWrapper(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));
    await screen.findByRole("option", { name: /Cable HDMI/ });

    return api;
  }

  it.each(["2.5", "2,5"])("cantidad %p: se ve 2.5, avisa y no envia (ni con Enter ni con el boton)", async (typed) => {
    const user = userEvent.setup();
    const api = await renderOpen();
    const quantity = screen.getByLabelText("Cantidad");

    await user.type(quantity, `${typed}{Enter}`);

    // Antes el separador se perdia: el campo mostraba 25 y se enviaba quantityDelta 25.
    expect(quantity).toHaveValue("2.5");
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();

    // El pie queda fuera del <form>: el envio implicito de Enter se simula aparte.
    fireEvent.submit(getForm());
    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect(api.posts).toHaveLength(0);
    expect(quantity).toHaveValue("2.5");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
  });

  it.each(["Enter", "boton"])("cantidad 3 enviada con %s: un solo POST con el payload de siempre", async (how) => {
    const user = userEvent.setup();
    const api = await renderOpen();
    api.respondToNextPost({ data: { id: "mov-1" } });

    await user.type(screen.getByLabelText("Cantidad"), "3");
    expect(screen.getByLabelText("Cantidad")).not.toHaveAttribute("aria-invalid");

    if (how === "Enter") {
      await user.keyboard("{Enter}");
    } else {
      await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    }

    await waitFor(() => expect(document.getElementById("inventory-adjustment-form")).toBeNull());

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      productId: "prod-cable",
      quantityDelta: 3,
      type: "ajuste_entrada",
    });
  });
});
