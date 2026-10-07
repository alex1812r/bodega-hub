import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { ProductDetailPackConversionCard } from "./ProductDetailPackConversionCard";

const packConversion = {
  id: "ppc-cigars",
  linkedProduct: { currentStock: 3, id: "prod-cigar-unit", name: "Cigarro suelto" },
  role: "pack",
  unitsPerPack: 10,
} as unknown as ProductPackConversionSummary;

const conversionResult = { data: { conversionId: "conv-1", unitQuantity: 10 } };

function renderCard(onConverted = jest.fn(), productStock = 5) {
  render(
    <ProductDetailPackConversionCard
      onConverted={onConverted}
      packConversion={packConversion}
      productId="prod-cigar-pack"
      productName="Caja cigarros (x10)"
      productStock={productStock}
    />,
    { wrapper: createQueryWrapper() },
  );

  return onConverted;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir empaque" }));
  await screen.findByLabelText("Cantidad de empaques");
}

function getForm() {
  const form = document.getElementById("open-pack-form");

  if (!form) {
    throw new Error("El formulario de abrir empaque no esta montado.");
  }

  return form;
}

describe("ProductDetailPackConversionCard · idempotencia (C6)", () => {
  it("doble envio = un solo POST, con clave, y el boton queda deshabilitado", async () => {
    const api = installFetchStub(() => null);
    const release = api.holdNextPost(conversionResult);
    const onConverted = renderCard();

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
    expect(onConverted).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    // El exito lo confirma el servidor: solo entonces se cierra y se avisa.
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la misma clave", async () => {
    const api = installFetchStub(() => null);
    api.networkErrorOnNextPost();
    api.respondToNextPost(conversionResult);
    const onConverted = renderCard();

    await openDialog();
    fireEvent.submit(getForm());
    await screen.findByText("Failed to fetch");
    expect(onConverted).not.toHaveBeenCalled();

    fireEvent.submit(getForm());
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });
});

describe("ProductDetailPackConversionCard · stock insuficiente (STK-607)", () => {
  function getQuantityInput() {
    return screen.getByLabelText<HTMLInputElement>("Cantidad de empaques");
  }

  it("sin stock: aviso propio en español, sin validacion nativa y sin POST", async () => {
    const api = installFetchStub(() => null);
    const onConverted = renderCard(jest.fn(), 0);

    await openDialog();

    expect(screen.getByText("No hay empaques en stock para abrir.")).toBeVisible();
    expect(getQuantityInput()).toHaveAttribute("aria-invalid", "true");
    // Sin `max`: el navegador no pinta su burbuja («Minimum value (1) must be less than…»).
    expect(getQuantityInput().validity.valid).toBe(true);

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();
  });

  it("cantidad mayor que el stock: dice cuantos empaques hay y no envia", async () => {
    const api = installFetchStub(() => null);

    renderCard();
    await openDialog();
    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.change(getQuantityInput(), { target: { value: "6" } });

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();
    expect(getQuantityInput().validity.valid).toBe(true);

    fireEvent.submit(getForm());

    expect(api.posts).toHaveLength(0);
  });
});
