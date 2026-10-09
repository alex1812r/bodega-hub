/**
 * INV-F2 · tarjeta de empaque del detalle (1 a 1): clave de idempotencia solo
 * con el mismo contenido y descartada al cerrar (F1), sin cierre con el envío
 * en vuelo (F2) y error de red en español (F3).
 */
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
import { UNCERTAIN_STOCK_REQUEST_MESSAGE } from "@/modules/inventory/utils/stockRequestError";
import { ToastProvider } from "@/shared/components/Toast";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { ProductDetailPackConversionCard } from "./ProductDetailPackConversionCard";

const packConversion = {
  id: "ppc-cigars",
  linkedProduct: { currentStock: 3, id: "prod-cigar-unit", name: "Cigarro suelto" },
  role: "pack",
  unitsPerPack: 10,
} as unknown as ProductPackConversionSummary;

const converted = { data: { conversionId: "conv-1", unitQuantity: 10 } };
const formId = "open-pack-form";

function renderCard() {
  const api = installFetchStub(() => null);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <ProductDetailPackConversionCard
          packConversion={packConversion}
          productId="prod-cigar-pack"
          productName="Caja cigarros (x10)"
          productStock={5}
        />
      </ToastProvider>
    </QueryWrapper>,
  );

  return api;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir empaque" }));
  await screen.findByLabelText("Cantidad de empaques");
}

function submitForm() {
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);
}

/** Deja pasar el cierre diferido del Modal (setTimeout 0). */
async function flushDeferredClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("ProductDetailPackConversionCard · intento de envío (INV-F2)", () => {
  it("F3 · un error de red se dice en español, no «Failed to fetch»", async () => {
    const api = renderCard();
    api.networkErrorOnNextPost();

    await openDialog();
    submitForm();

    expect(await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).toBeVisible();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });

  it("F1 · respuesta perdida → cerrar → abrir otra caja igual: clave nueva y sin el error anterior", async () => {
    const api = renderCard();
    api.networkErrorOnNextPost();
    api.respondToNextPost(converted);

    await openDialog();
    submitForm();
    await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Abrir empaque" }), { key: "Escape" });
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    await openDialog();
    expect(screen.queryByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).not.toBeInTheDocument();
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("F1 · 409 → otra cantidad: clave nueva", async () => {
    const api = renderCard();
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Clave ya usada" } }, 409);
    api.respondToNextPost(converted);

    await openDialog();
    submitForm();
    await screen.findByText("Clave ya usada");

    fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value: "2" } });
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.packQuantity).toBe(2);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("F2 · con el envío en vuelo Esc no cierra y los campos quedan deshabilitados", async () => {
    const api = renderCard();
    const release = api.holdNextPost(converted);

    await openDialog();
    submitForm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Convirtiendo..." })).toBeDisabled());

    expect(screen.getByLabelText("Cantidad de empaques")).toBeDisabled();
    expect(screen.getByLabelText("Motivo")).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Abrir empaque" }), { key: "Escape" });
    await flushDeferredClose();

    expect(document.getElementById(formId)).not.toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(api.posts).toHaveLength(1);
  });
});

// INT-02 · B3: el intento usa `lockAfterSuccess` y se reabre al cerrarse el diálogo.
describe("ProductDetailPackConversionCard · tras una apertura correcta (INT-02)", () => {
  it("abrir, reabrir y abrir otra vez: dos envíos con claves distintas", async () => {
    const api = renderCard();
    api.respondToNextPost(converted);
    api.respondToNextPost(converted);

    await openDialog();
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    await flushDeferredClose();

    await openDialog();
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});
