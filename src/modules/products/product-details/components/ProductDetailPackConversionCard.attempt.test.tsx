/**
 * INV-F2 · tarjeta de empaque del detalle (1 a 1): clave de idempotencia solo
 * con el mismo contenido y descartada al cerrar (F1), sin cierre con el envío
 * en vuelo (F2) y error de red en español (F3).
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** CNF-F2: el 1 a 1 ya no envía desde el formulario; lo hace el botón de su confirmación. */
async function findConfirm() {
  return screen.findByRole("dialog", { name: "Confirmar conversión de empaque" });
}

async function confirmConversion() {
  const dialog = await findConfirm();

  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Convertir empaque" })).toBeEnabled(),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Convertir empaque" }));

  return dialog;
}

/** Envía de punta a punta: formulario → confirmación → «Convertir empaque». */
async function submitAndConfirm() {
  submitForm();

  return confirmConversion();
}

async function cancelConfirm(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Confirmar conversión de empaque" }),
    ).not.toBeInTheDocument(),
  );
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
    const dialog = await submitAndConfirm();

    expect(await within(dialog).findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).toBeVisible();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });

  it("F1 · respuesta perdida → cerrar → abrir otra caja igual: clave nueva y sin el error anterior", async () => {
    const api = renderCard();
    api.networkErrorOnNextPost();
    api.respondToNextPost(converted);

    await openDialog();
    const dialog = await submitAndConfirm();
    await within(dialog).findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);
    // Al cancelar la confirmación el error sigue a la vista en el formulario.
    await cancelConfirm(dialog);
    expect(screen.getByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).toBeVisible();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Abrir empaque" }), { key: "Escape" });
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    await openDialog();
    expect(screen.queryByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).not.toBeInTheDocument();
    const reopened = await submitAndConfirm();
    // La confirmación nueva tampoco arrastra el error del intento descartado.
    expect(within(reopened).queryByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).not.toBeInTheDocument();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("F1 · 409 → otra cantidad: clave nueva", async () => {
    const api = renderCard();
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Clave ya usada" } }, 409);
    api.respondToNextPost(converted);

    await openDialog();
    const dialog = await submitAndConfirm();
    await within(dialog).findByText("Clave ya usada");
    await cancelConfirm(dialog);

    fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value: "2" } });
    await submitAndConfirm();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.packQuantity).toBe(2);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("F2 · con el envío en vuelo Esc no cierra y los campos quedan deshabilitados", async () => {
    const api = renderCard();
    const release = api.holdNextPost(converted);

    await openDialog();
    const dialog = await submitAndConfirm();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );

    expect(screen.getByLabelText("Cantidad de empaques")).toBeDisabled();
    expect(screen.getByLabelText("Motivo")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();

    // Ni la confirmación ni el formulario de debajo se cierran con el envío en vuelo.
    fireEvent.keyDown(dialog, { key: "Escape" });
    // Con la confirmación encima, el diálogo del formulario queda oculto para el árbol accesible.
    const formDialog = document.getElementById(formId)?.closest('[role="dialog"]');

    expect(formDialog).not.toBeNull();
    fireEvent.keyDown(formDialog as HTMLElement, { key: "Escape" });
    await flushDeferredClose();

    expect(dialog).toBeInTheDocument();
    expect(document.getElementById(formId)).not.toBeNull();
    expect(api.posts).toHaveLength(1);

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
    await submitAndConfirm();
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    await flushDeferredClose();

    await openDialog();
    await submitAndConfirm();
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});
