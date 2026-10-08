/**
 * INV-F2 · conversión de empaque (1 a 1 y surtido): la clave de idempotencia
 * solo se repite con el mismo contenido (F1), el modal no se cierra con el
 * envío en vuelo (F2) y el error de red se dice en español (F3).
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ToastProvider } from "@/shared/components/Toast";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { UNCERTAIN_STOCK_REQUEST_MESSAGE } from "../../utils/stockRequestError";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

function product(id: string, name: string, currentStock: number) {
  return { currentCostRef: 1, currentStock, id, name, salePriceRef: 2, sku: `${id}-sku` };
}

function component(unitProductId: string, name: string, currentStock: number) {
  return {
    costWeight: 1,
    currentStock,
    isActive: true,
    name,
    sku: `${unitProductId}-sku`,
    unitProductId,
    unitsPerPack: 2,
  };
}

const single = {
  components: [{ ...component("prod-cigar-unit", "Cigarro suelto", 3), unitsPerPack: 10 }],
  id: "ppc-cigars",
  kind: "single",
  label: null,
  linkedProduct: product("prod-cigar-unit", "Cigarro suelto", 3),
  packProduct: product("prod-cigar-pack", "Caja cigarros (x10)", 5),
  role: "pack",
  sources: [],
  totalUnits: 10,
  unitsPerPack: 10,
};

const assorted = {
  components: [component("prod-cola", "Cola", 12), component("prod-manzana", "Manzana", 0)],
  id: "ppc-surtido",
  kind: "assorted",
  label: "Sabores surtidos",
  linkedProduct: product("prod-cola", "Cola", 12),
  packProduct: product("prod-surtido", "Surtido A", 9),
  role: "pack",
  sources: [],
  totalUnits: 4,
  unitsPerPack: 4,
};

const converted = { data: { conversionId: "conv-1", unitQuantity: 10 } };
const opened = {
  data: {
    components: [
      { isActive: true, unitProductId: "prod-cola", units: 2 },
      { isActive: true, unitProductId: "prod-manzana", units: 2 },
    ],
    conversionId: "conv-2",
    packQuantity: 1,
    totalUnits: 4,
    unitQuantity: 4,
    unitsPerPack: 4,
  },
};
// Texto de `stock_request_replay` (20261006c).
const keyConflict = {
  error: {
    code: "CONFLICT",
    message:
      "La clave de idempotencia ya se uso en otro movimiento de inventario. Revisa el movimiento registrado antes de reintentar.",
  },
};

const formId = "inventory-pack-conversion-form";

function renderModal(packProductId: string) {
  const api = installFetchStub(() => [single, assorted]);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <InventoryPackConversionModal defaultPackProductId={packProductId} />
      </ToastProvider>
    </QueryWrapper>,
  );

  return api;
}

async function openModal() {
  fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
  await screen.findByText(/Stock empaque: /);
}

function getModal() {
  return screen.getByRole("dialog", { name: "Convertir empaque" });
}

function submitForm() {
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);
}

function setQuantity(value: string) {
  fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value } });
}

async function closeWithEscape() {
  fireEvent.keyDown(getModal(), { key: "Escape" });
  await waitFor(() => expect(document.getElementById(formId)).toBeNull());
}

/** Deja pasar el cierre diferido del Modal (setTimeout 0). */
async function flushDeferredClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function openConfirm() {
  submitForm();

  return screen.findByRole("dialog", { name: "Abrir empaque surtido" });
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Abrir empaque" });
}

async function cancelConfirm(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Abrir empaque surtido" })).not.toBeInTheDocument(),
  );
}

function keyOf(api: ReturnType<typeof renderModal>, index: number) {
  return api.posts[index]?.body.clientRequestId;
}

describe("InventoryPackConversionModal · 1 a 1 · clave (INV-F2 · F1)", () => {
  it("respuesta perdida → otra cantidad → otro motivo → reabrir: cada contenido estrena clave", async () => {
    const api = renderModal("prod-cigar-pack");
    api.networkErrorOnNextPost();
    api.respondToNextPost(keyConflict, 409);
    api.respondToNextPost(keyConflict, 409);
    api.respondToNextPost(converted);

    await openModal();
    submitForm();
    await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);

    setQuantity("2");
    submitForm();
    // Un 409 trae respuesta del servidor: se muestra tal cual.
    await screen.findByText(keyConflict.error.message);

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "apertura" } });
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(3));
    await waitFor(() => expect(screen.getByLabelText("Motivo")).toBeEnabled());

    await closeWithEscape();
    await openModal();
    expect(screen.queryByText(keyConflict.error.message)).not.toBeInTheDocument();
    setQuantity("2");
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(4));

    expect(new Set([0, 1, 2, 3].map((index) => keyOf(api, index))).size).toBe(4);
  });

  it("respuesta perdida → cerrar → la misma conversión otra vez: clave nueva", async () => {
    const api = renderModal("prod-cigar-pack");
    api.networkErrorOnNextPost();
    api.respondToNextPost(converted);

    await openModal();
    submitForm();
    await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);

    await closeWithEscape();
    await openModal();
    expect(screen.queryByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).not.toBeInTheDocument();
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body).toMatchObject({ packProductId: "prod-cigar-pack", packQuantity: 1 });
    expect(keyOf(api, 1)).not.toBe(keyOf(api, 0));
  });

  it("409 → reintentar exactamente lo mismo conserva la clave", async () => {
    const api = renderModal("prod-cigar-pack");
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Stock insuficiente de empaque" } }, 409);
    api.respondToNextPost(converted);

    await openModal();
    submitForm();
    await screen.findByText("Stock insuficiente de empaque");
    submitForm();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(keyOf(api, 1)).toBe(keyOf(api, 0));
  });
});

describe("InventoryPackConversionModal · 1 a 1 · envío en vuelo (INV-F2 · F2)", () => {
  it("Esc, «Cancelar» y «Cerrar modal» no cierran y los campos quedan deshabilitados", async () => {
    const api = renderModal("prod-cigar-pack");
    const release = api.holdNextPost(converted);

    await openModal();
    submitForm();
    await waitFor(() => expect(screen.getByRole("button", { name: "Convirtiendo..." })).toBeDisabled());

    expect(screen.getByRole("combobox", { name: "Producto empaque" })).toBeDisabled();
    expect(screen.getByLabelText("Cantidad de empaques")).toBeDisabled();
    expect(screen.getByLabelText("Motivo")).toBeDisabled();

    fireEvent.keyDown(getModal(), { key: "Escape" });
    await flushDeferredClose();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await flushDeferredClose();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar modal" }));
    await flushDeferredClose();

    expect(document.getElementById(formId)).not.toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(api.posts).toHaveLength(1);
  });
});

describe("InventoryPackConversionModal · surtido (INV-F2 · F1 y F3)", () => {
  it("un error de red en la confirmación se dice en español, no «Failed to fetch»", async () => {
    const api = renderModal("prod-surtido");
    api.networkErrorOnNextPost();

    await openModal();
    const dialog = await openConfirm();
    fireEvent.click(confirmButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      UNCERTAIN_STOCK_REQUEST_MESSAGE,
    );
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });

  it("respuesta perdida → cerrar todo → la misma apertura otra vez: clave nueva", async () => {
    const api = renderModal("prod-surtido");
    api.networkErrorOnNextPost();
    api.respondToNextPost(opened);

    await openModal();
    const dialog = await openConfirm();
    fireEvent.click(confirmButton(dialog));
    await within(dialog).findByRole("alert");
    await cancelConfirm(dialog);

    await closeWithEscape();
    await openModal();
    const secondDialog = await openConfirm();
    fireEvent.click(confirmButton(secondDialog));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.components).toEqual(api.posts[0]?.body.components);
    expect(keyOf(api, 1)).not.toBe(keyOf(api, 0));
  });

  it("respuesta perdida → otro reparto sin cerrar el modal: clave nueva", async () => {
    const api = renderModal("prod-surtido");
    api.networkErrorOnNextPost();
    api.respondToNextPost(opened);

    await openModal();
    const dialog = await openConfirm();
    fireEvent.click(confirmButton(dialog));
    await within(dialog).findByRole("alert");
    await cancelConfirm(dialog);

    fireEvent.change(screen.getByLabelText("Unidades de Cola"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Unidades de Manzana"), { target: { value: "1" } });
    const secondDialog = await openConfirm();
    fireEvent.click(confirmButton(secondDialog));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(keyOf(api, 1)).not.toBe(keyOf(api, 0));
  });
});
