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
