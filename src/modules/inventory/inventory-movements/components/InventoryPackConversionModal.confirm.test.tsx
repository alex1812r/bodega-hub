/**
 * CNF-08 · conversión de empaque 1 a 1: el formulario no envía; abre una
 * confirmación con las dos caras (−N empaques y +N × u unidades, cada una con
 * su stock actual → resultante) y el motivo, que es obligatorio (CNF-F4): sin
 * él la confirmación no se abre. El surtido ya confirmaba (INV-08) y ahora
 * muestra también el motivo. Un empaque que quedaría en negativo no
 * llega a la confirmación, y el error del servidor se dice dentro de ella sin
 * perder lo tecleado en el formulario de debajo.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ToastProvider } from "@/shared/components/Toast";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function product(id: string, name: string, currentStock: number) {
  return { currentCostRef: 1, currentStock, id, name, salePriceRef: 2, sku: `${id}-sku` };
}

function component(unitProductId: string, name: string, currentStock: number, isActive = true) {
  return {
    costWeight: 1,
    currentStock,
    isActive,
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

/** Receta de un servidor anterior al surtido: sin `kind` ni `components`. */
const legacySingle = {
  id: "ppc-water",
  linkedProduct: product("prod-water-unit", "Agua 600 ml", 0),
  packProduct: product("prod-water-pack", "Bulto de agua (x24)", 7),
  role: "pack",
  unitsPerPack: 24,
};

/** 1 a 1 cuya unidad está inactiva: la conversión no se rechaza, pero se avisa. */
const inactiveUnitSingle = {
  ...single,
  components: [{ ...component("prod-old-unit", "Chicle viejo", 1, false), unitsPerPack: 4 }],
  id: "ppc-old",
  linkedProduct: product("prod-old-unit", "Chicle viejo", 1),
  packProduct: product("prod-old-pack", "Caja chicle viejo (x4)", 2),
  totalUnits: 4,
  unitsPerPack: 4,
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

const converted = { data: { conversionId: "conv-1", unitQuantity: 20 } };
const formId = "inventory-pack-conversion-form";
const CONFIRM_TITLE = "Confirmar conversión de empaque";
const REASON_REQUIRED = "Indica el motivo de la conversión.";
const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);

async function renderOpen(packProductId = "prod-cigar-pack") {
  const api = installFetchStub(() => [single, legacySingle, inactiveUnitSingle, assorted]);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <InventoryPackConversionModal defaultPackProductId={packProductId} />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
  await screen.findByText(/Stock empaque: /);

  return api;
}

function setQuantity(value: string) {
  fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value } });
}

function setReason(value: string) {
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value } });
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
  return within(dialog).getByRole("button", { name: "Convertir empaque" });
}

async function cancelConfirm(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(queryConfirm()).not.toBeInTheDocument());
}

/** Deja pasar un cierre o una apertura diferidos que no deberían ocurrir. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("InventoryPackConversionModal · confirmación del 1 a 1 (CNF-08)", () => {
  it("muestra las dos caras: −N empaques y +N × u unidades, con su stock actual → resultante", async () => {
    const api = await renderOpen();
    setQuantity("2");
    setReason("  Reposición de mostrador  ");

    const dialog = await openConfirm();
    const effects = within(dialog).getAllByRole("listitem");

    expect(api.posts).toHaveLength(0);
    expect(
      within(dialog).getByText(
        "Vas a convertir 2 empaque(s) de Caja cigarros (x10) en 20 unidad(es) sueltas.",
      ),
    ).toBeVisible();
    expect(effects).toHaveLength(2);
    expect(effects[0]).toHaveTextContent(/−2 Caja cigarros \(x10\)\s*Stock 5\s*pasa a\s*3$/);
    expect(effects[1]).toHaveTextContent(/\+20 Cigarro suelto\s*Stock 3\s*pasa a\s*23$/);
    expect(effects[1]).toHaveAttribute("data-tone", "positive");
    // El motivo tecleado, sin los espacios de los extremos.
    expect(within(dialog).getByText("Reposición de mostrador")).toBeVisible();
  });

  it("sin motivo no abre la confirmación: avisa en el campo y, al escribirlo, deja continuar", async () => {
    const api = await renderOpen();
    setQuantity("2");

    submitForm();
    await flush();

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(screen.getByText(REASON_REQUIRED)).toBeVisible();
    expect(api.posts).toHaveLength(0);

    // Solo espacios tampoco es un motivo.
    setReason("   ");
    submitForm();
    await flush();

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(screen.getByText(REASON_REQUIRED)).toBeVisible();

    setReason("Reposición");

    expect(screen.queryByText(REASON_REQUIRED)).not.toBeInTheDocument();
    expect(within(await openConfirm()).getByText("Reposición")).toBeVisible();
    expect(screen.queryByText("Sin motivo.")).not.toBeInTheDocument();
  });

  it("abrir todos los empaques deja el empaque en 0", async () => {
    await renderOpen();
    setQuantity("5");
    setReason("Reposición");

    const dialog = await openConfirm();

    expect(within(dialog).getAllByRole("listitem")[0]).toHaveTextContent(/Stock 5\s*pasa a\s*0$/);
  });

  it("receta de un servidor anterior (sin `components`): las dos caras salen de la unidad vinculada", async () => {
    await renderOpen("prod-water-pack");
    setReason("Reposición");

    const effects = within(await openConfirm()).getAllByRole("listitem");

    expect(effects).toHaveLength(2);
    expect(effects[0]).toHaveTextContent(/−1 Bulto de agua \(x24\)\s*Stock 7\s*pasa a\s*6$/);
    expect(effects[1]).toHaveTextContent(/\+24 Agua 600 ml\s*Stock 0\s*pasa a\s*24$/);
  });

  it("unidad inactiva: se marca en la confirmación, sin bloquear", async () => {
    await renderOpen("prod-old-pack");
    setReason("Reposición");

    const effects = within(await openConfirm()).getAllByRole("listitem");

    expect(effects[1]).toHaveTextContent(/\+4 Chicle viejo \(inactivo\)\s*Stock 1\s*pasa a\s*5$/);
    expect(effects[1]).toHaveAttribute("data-tone", "warning");
  });

  it("cancelar no envía nada y el formulario conserva lo tecleado", async () => {
    const api = await renderOpen();
    setQuantity("2");
    setReason("Reposición");

    await cancelConfirm(await openConfirm());

    expect(api.posts).toHaveLength(0);
    expect(document.getElementById(formId)).not.toBeNull();
    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("2");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Reposición");
  });

  it("confirmar envía UNA petición aunque haya doble clic, con el payload de siempre (sin `components`)", async () => {
    const api = await renderOpen();
    const release = api.holdNextPost(converted);
    setQuantity("2");
    setReason(" Reposición ");

    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Convertir empaque|Procesando/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: uuid,
      packProductId: "prod-cigar-pack",
      packQuantity: 2,
      reason: "Reposición",
    });

    await act(async () => {
      release();
    });
    // Tras el éxito, lo de siempre: se cierra todo y avisa con lo que entró.
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(
      within(await screen.findByRole("status")).getByText(
        "Abriste 2 Caja cigarros (x10): +20 Cigarro suelto",
      ),
    ).toBeInTheDocument();
    expect(api.posts).toHaveLength(1);
  });
});

describe("InventoryPackConversionModal · empaque en negativo (CNF-08)", () => {
  it("1 a 1 con más empaques de los que hay: avisa y no llega a la confirmación", async () => {
    const api = await renderOpen();
    setQuantity("6");

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();

    submitForm();
    await flush();

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("6");
  });
});

describe("InventoryPackConversionModal · error del servidor en la confirmación (CNF-08)", () => {
  it("el 409 se muestra tal cual dentro de la confirmación; al cancelarla, el formulario sigue intacto", async () => {
    const api = await renderOpen();
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Stock insuficiente de empaque" } }, 409);
    setQuantity("2");
    setReason("Reposición");

    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /^Stock insuficiente de empaque$/,
    );
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);

    await cancelConfirm(dialog);

    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("2");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Reposición");
    // El rechazo sigue a la vista en el formulario y no hay aviso de éxito.
    expect(within(document.getElementById(formId) as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Stock insuficiente de empaque",
    );
    expect(screen.queryByText(/Abriste/)).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(1);
  });
});

describe("InventoryPackConversionModal · motivo en la confirmación del surtido (CNF-08)", () => {
  it("el surtido muestra el motivo junto al reparto", async () => {
    await renderOpen("prod-surtido");
    setReason("Apertura para el mostrador");
    submitForm();

    const dialog = await screen.findByRole("dialog", { name: "Abrir empaque surtido" });

    expect(within(dialog).getByText("Apertura para el mostrador")).toBeVisible();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
  });

  it("el surtido sin motivo tampoco abre la confirmación y avisa en el campo", async () => {
    const api = await renderOpen("prod-surtido");

    submitForm();
    await flush();

    expect(screen.queryByRole("dialog", { name: "Abrir empaque surtido" })).not.toBeInTheDocument();
    expect(screen.getByText(REASON_REQUIRED)).toBeVisible();
    expect(api.posts).toHaveLength(0);
  });
});
