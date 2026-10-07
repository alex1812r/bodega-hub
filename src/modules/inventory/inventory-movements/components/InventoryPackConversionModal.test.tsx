import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

const packConversions = [
  {
    id: "ppc-cigars",
    linkedProduct: { currentStock: 3, id: "prod-cigar-unit", name: "Cigarro suelto" },
    packProduct: { currentStock: 5, id: "prod-cigar-pack", name: "Caja cigarros (x10)" },
    role: "pack",
    unitsPerPack: 10,
  },
];

const conversionResult = { data: { conversionId: "conv-1", unitQuantity: 10 } };

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
  await screen.findByText(/Stock empaque: 5/);
}

function getForm() {
  const form = document.getElementById("inventory-pack-conversion-form");

  if (!form) {
    throw new Error("El formulario de conversion no esta montado.");
  }

  return form;
}

describe("InventoryPackConversionModal · aviso de cantidad (SHR-09G)", () => {
  function getQuantityInput() {
    return screen.getByLabelText<HTMLInputElement>("Cantidad de empaques");
  }

  async function renderOpen(conversions = packConversions) {
    const api = installFetchStub(() => conversions);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
    await screen.findByText(/Stock empaque: /);

    return api;
  }

  it("al abrir no muestra ningun aviso", async () => {
    await renderOpen();

    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Indica una cantidad mayor a cero.")).not.toBeInTheDocument();
  });

  it.each(["0", ""])("cantidad %p: avisa y no envia", async (value) => {
    const api = await renderOpen();

    fireEvent.change(getQuantityInput(), { target: { value } });

    expect(screen.getByText("Indica una cantidad mayor a cero.")).toBeVisible();
    expect(getQuantityInput()).toHaveAttribute("aria-invalid", "true");
    expect(getQuantityInput()).toHaveAccessibleDescription("Indica una cantidad mayor a cero.");

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
    expect(screen.getByText("Indica una cantidad mayor a cero.")).toBeVisible();
  });

  it("cantidad mayor que el stock: dice cuantos empaques hay y no envia", async () => {
    const api = await renderOpen();

    fireEvent.change(getQuantityInput(), { target: { value: "6" } });

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();
    expect(getQuantityInput()).toHaveAccessibleDescription("Solo hay 5 empaque(s) en stock.");
    // Sin `max`: la cantidad tecleada no se corrige en silencio.
    fireEvent.blur(getQuantityInput());
    expect(getQuantityInput()).toHaveValue("6");

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
  });

  it("empaque sin stock: el aviso aparece al intentar enviar, no antes", async () => {
    const api = await renderOpen([
      { ...packConversions[0], packProduct: { ...packConversions[0].packProduct, currentStock: 0 } },
    ]);

    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.submit(getForm());

    expect(screen.getByText("No hay empaques en stock para abrir.")).toBeVisible();
    expect(api.posts).toHaveLength(0);
  });

  it("cantidad valida: un solo POST con el mismo payload de siempre", async () => {
    const api = await renderOpen();
    api.respondToNextPost(conversionResult);

    fireEvent.change(getQuantityInput(), { target: { value: "2" } });
    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.submit(getForm());
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 2,
    });
  });
});

describe("InventoryPackConversionModal · idempotencia (C6)", () => {
  it("doble envio = un solo POST, con clave, y el boton queda deshabilitado", async () => {
    const api = installFetchStub(() => packConversions);
    const release = api.holdNextPost(conversionResult);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    await openDialog();

    fireEvent.submit(getForm());
    fireEvent.submit(getForm());

    await waitFor(() => expect(screen.getByRole("button", { name: "Convirtiendo..." })).toBeDisabled());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 1,
    });

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la misma clave", async () => {
    const api = installFetchStub(() => packConversions);
    api.networkErrorOnNextPost();
    api.respondToNextPost(conversionResult);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    await openDialog();

    fireEvent.submit(getForm());
    await screen.findByText("Failed to fetch");

    fireEvent.submit(getForm());
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });
});
