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

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

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
  // Tras cancelar una confirmación, el modal de debajo vuelve al árbol accesible.
  await screen.findByRole("dialog", { name: "Convertir empaque" });
  fireEvent.keyDown(getModal(), { key: "Escape" });
  await waitFor(() => expect(document.getElementById(formId)).toBeNull());
}

/** Con lo tecleado sin registrar, Esc pregunta (CNF-15): se sale descartándolo. */
async function closeWithEscapeDiscarding() {
  await screen.findByRole("dialog", { name: "Convertir empaque" });
  fireEvent.keyDown(getModal(), { key: "Escape" });
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).getByRole(
      "button",
      { name: "Salir" },
    ),
  );
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

const SINGLE_CONFIRM_TITLE = "Confirmar conversión de empaque";

function singleConfirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Convertir empaque" });
}

/** CNF-08: el 1 a 1 también confirma; el formulario abre la confirmación y ella envía. */
async function submitAndConfirmSingle() {
  submitForm();

  const dialog = await screen.findByRole("dialog", { name: SINGLE_CONFIRM_TITLE });

  fireEvent.click(singleConfirmButton(dialog));

  return dialog;
}

async function cancelSingleConfirm(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: SINGLE_CONFIRM_TITLE })).not.toBeInTheDocument(),
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
    const lost = await submitAndConfirmSingle();
    await within(lost).findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);
    await cancelSingleConfirm(lost);
    // Al cancelar la confirmación el aviso sigue a la vista en el formulario.
    expect(screen.getByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).toBeVisible();

    setQuantity("2");
    const conflicted = await submitAndConfirmSingle();
    // Un 409 trae respuesta del servidor: se muestra tal cual.
    await within(conflicted).findByText(keyConflict.error.message);
    await cancelSingleConfirm(conflicted);

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "apertura" } });
    const third = await submitAndConfirmSingle();
    await waitFor(() => expect(api.posts).toHaveLength(3));
    await waitFor(() => expect(screen.getByLabelText("Motivo")).toBeEnabled());
    await cancelSingleConfirm(third);

    await closeWithEscapeDiscarding();
    await openModal();
    expect(screen.queryByText(keyConflict.error.message)).not.toBeInTheDocument();
    setQuantity("2");
    await submitAndConfirmSingle();
    await waitFor(() => expect(api.posts).toHaveLength(4));

    expect(new Set([0, 1, 2, 3].map((index) => keyOf(api, index))).size).toBe(4);
  });

  it("respuesta perdida → cerrar → la misma conversión otra vez: clave nueva", async () => {
    const api = renderModal("prod-cigar-pack");
    api.networkErrorOnNextPost();
    api.respondToNextPost(converted);

    await openModal();
    const dialog = await submitAndConfirmSingle();
    await within(dialog).findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);
    await cancelSingleConfirm(dialog);

    await closeWithEscape();
    await openModal();
    expect(screen.queryByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).not.toBeInTheDocument();
    await submitAndConfirmSingle();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body).toMatchObject({ packProductId: "prod-cigar-pack", packQuantity: 1 });
    expect(keyOf(api, 1)).not.toBe(keyOf(api, 0));
  });

  it("409 → reintentar exactamente lo mismo conserva la clave", async () => {
    const api = renderModal("prod-cigar-pack");
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Stock insuficiente de empaque" } }, 409);
    api.respondToNextPost(converted);

    await openModal();
    const dialog = await submitAndConfirmSingle();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Stock insuficiente de empaque",
    );
    await waitFor(() => expect(singleConfirmButton(dialog)).toBeEnabled());
    fireEvent.click(singleConfirmButton(dialog));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(keyOf(api, 1)).toBe(keyOf(api, 0));
  });
});

describe("InventoryPackConversionModal · 1 a 1 · envío en vuelo (INV-F2 · F2)", () => {
  it("Esc, «Cancelar» y «Cerrar modal» no cierran y los campos quedan deshabilitados", async () => {
    const api = renderModal("prod-cigar-pack");
    const release = api.holdNextPost(converted);

    await openModal();
    const dialog = await submitAndConfirmSingle();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );

    // El formulario queda debajo de la confirmación, fuera del árbol accesible.
    const formElement = document.getElementById(formId) as HTMLFormElement;
    const form = within(formElement);
    const conversionModal = formElement.closest<HTMLElement>('[role="dialog"]') as HTMLElement;

    expect(form.getByRole("combobox", { hidden: true, name: "Producto empaque" })).toBeDisabled();
    expect(form.getByLabelText("Cantidad de empaques")).toBeDisabled();
    expect(form.getByLabelText("Motivo")).toBeDisabled();

    // Ni la confirmación ni el modal de debajo se cierran con el envío en vuelo.
    fireEvent.keyDown(dialog, { key: "Escape" });
    await flushDeferredClose();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar modal" }));
    await flushDeferredClose();
    fireEvent.keyDown(conversionModal, { key: "Escape" });
    await flushDeferredClose();
    fireEvent.click(within(conversionModal).getByRole("button", { hidden: true, name: "Cancelar" }));
    await flushDeferredClose();
    fireEvent.click(
      within(conversionModal).getByRole("button", { hidden: true, name: "Cerrar modal" }),
    );
    await flushDeferredClose();

    expect(screen.getByRole("dialog", { name: SINGLE_CONFIRM_TITLE })).toBeInTheDocument();
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

describe("InventoryPackConversionModal · stock tras un resultado incierto (INV-F4 · R1)", () => {
  /** Recetas tal como las devuelve el servidor una vez registrada la apertura perdida. */
  const assortedAfterLostOpening = {
    ...assorted,
    components: [component("prod-cola", "Cola", 14), component("prod-manzana", "Manzana", 2)],
    packProduct: product("prod-surtido", "Surtido A", 8),
  };

  function renderWithServerState() {
    const server = { recipes: [single, assorted] };
    const api = installFetchStub(() => server.recipes);
    const QueryWrapper = createQueryWrapper();

    render(
      <QueryWrapper>
        <ToastProvider>
          <InventoryPackConversionModal defaultPackProductId="prod-surtido" />
        </ToastProvider>
      </QueryWrapper>,
    );

    return { api, server };
  }

  it("apertura perdida que el servidor sí registró → reabrir: la confirmación anuncia el stock real", async () => {
    const { api, server } = renderWithServerState();
    api.networkErrorOnNextPost();

    await openModal();
    const dialog = await openConfirm();
    expect(dialog).toHaveTextContent("Stock 9");
    // El servidor registra la apertura aunque la respuesta no llegue.
    server.recipes = [single, assortedAfterLostOpening];
    fireEvent.click(confirmButton(dialog));
    await within(dialog).findByRole("alert");
    await cancelConfirm(dialog);

    await closeWithEscape();
    await openModal();
    await screen.findByText(/Stock empaque: 8\./);
    const secondDialog = await openConfirm();

    expect(secondDialog).toHaveTextContent("Stock 8");
    expect(secondDialog).toHaveTextContent("Stock 14");
    expect(secondDialog).not.toHaveTextContent("Stock 9");
    expect(secondDialog).not.toHaveTextContent("Stock 12");
  });

  it("al abrir el modal se vuelven a pedir las recetas", async () => {
    const { server } = renderWithServerState();

    await openModal();
    await screen.findByText(/Stock empaque: 9\./);
    await closeWithEscape();
    // Otra pantalla u otro usuario movió el stock del empaque.
    server.recipes = [single, assortedAfterLostOpening];
    await openModal();

    expect(await screen.findByText(/Stock empaque: 8\./)).toBeInTheDocument();
  });
});

// INT-02 · B3: el intento usa `lockAfterSuccess` y se reabre al cerrarse el modal.
describe("InventoryPackConversionModal · tras una conversión correcta (INT-02)", () => {
  it("1 a 1 · convertir, reabrir y convertir otra vez: dos envíos con claves distintas", async () => {
    const api = renderModal("prod-cigar-pack");
    api.respondToNextPost(converted);
    api.respondToNextPost(converted);

    await openModal();
    await submitAndConfirmSingle();
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    await flushDeferredClose();

    await openModal();
    await submitAndConfirmSingle();
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(keyOf(api, 1)).not.toBe(keyOf(api, 0));
  });

  it("surtido · abrir, reabrir y abrir otra vez: dos envíos con claves distintas", async () => {
    const api = renderModal("prod-surtido");
    api.respondToNextPost(opened);
    api.respondToNextPost(opened);

    await openModal();
    fireEvent.click(confirmButton(await openConfirm()));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    await flushDeferredClose();

    await openModal();
    fireEvent.click(confirmButton(await openConfirm()));
    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(keyOf(api, 1)).not.toBe(keyOf(api, 0));
  });
});
