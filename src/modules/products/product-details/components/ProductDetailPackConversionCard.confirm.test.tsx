/**
 * CNF-F2 · tarjeta de empaque del detalle, conversión 1 a 1: el formulario no
 * envía; abre la MISMA confirmación que el modal de Inventario (CNF-08) con las
 * dos caras (−N empaques y +N × u unidades, cada una con su stock actual →
 * resultante) y el motivo. Un empaque que quedaría en negativo no llega a la
 * confirmación, el doble clic envía una sola petición y el error del servidor
 * se dice tal cual dentro de ella sin perder el formulario de debajo.
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
import { ToastProvider } from "@/shared/components/Toast";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { ProductDetailPackConversionCard } from "./ProductDetailPackConversionCard";

const unit = {
  currentCostRef: 0.5,
  currentStock: 3,
  id: "prod-cigar-unit",
  name: "Cigarro suelto",
  salePriceRef: 1,
  sku: "cigar-unit",
};

function unitComponent(isActive: boolean) {
  return {
    costWeight: 1,
    currentStock: unit.currentStock,
    isActive,
    name: unit.name,
    sku: unit.sku,
    unitProductId: unit.id,
    unitsPerPack: 10,
  };
}

const single: ProductPackConversionSummary = {
  components: [unitComponent(true)],
  id: "ppc-cigars",
  kind: "single",
  label: null,
  linkedProduct: unit,
  role: "pack",
  sources: [],
  totalUnits: 10,
  unitsPerPack: 10,
};

/** Vínculo de un servidor anterior al surtido: sin `kind` ni `components`. */
const legacySingle: ProductPackConversionSummary = {
  id: "ppc-cigars",
  linkedProduct: unit,
  role: "pack",
  unitsPerPack: 10,
};

const converted = { data: { conversionId: "conv-1", unitQuantity: 20 } };
const formId = "open-pack-form";
const CONFIRM_TITLE = "Confirmar conversión de empaque";
const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);

async function renderOpen(conversion: ProductPackConversionSummary = single, productStock = 5) {
  const api = installFetchStub(() => null);
  const onConverted = jest.fn();
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <ProductDetailPackConversionCard
          onConverted={onConverted}
          packConversion={conversion}
          productId="prod-cigar-pack"
          productName="Caja cigarros (x10)"
          productStock={productStock}
        />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Abrir empaque" }));
  await screen.findByLabelText("Cantidad de empaques");

  return { api, onConverted };
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

/** Deja pasar un envío, un cierre o una apertura diferidos que no deberían ocurrir. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("ProductDetailPackConversionCard · confirmación del 1 a 1 (CNF-F2)", () => {
  it("no envía hasta confirmar: el formulario abre la confirmación con las dos caras y el motivo", async () => {
    const { api, onConverted } = await renderOpen();
    setQuantity("2");
    setReason("  Reposición de mostrador  ");

    const dialog = await openConfirm();
    await flush();

    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();

    const effects = within(dialog).getAllByRole("listitem");

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

  it("el pie del formulario dice «Continuar», no envía y lleva a la confirmación", async () => {
    const { api } = await renderOpen();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).toBeVisible();
    expect(api.posts).toHaveLength(0);
  });

  it("sin motivo (es opcional) lo dice; abrir todos los empaques deja el empaque en 0", async () => {
    await renderOpen();
    setQuantity("5");

    const dialog = await openConfirm();

    expect(within(dialog).getByText("Sin motivo.")).toBeVisible();
    expect(within(dialog).getAllByRole("listitem")[0]).toHaveTextContent(/Stock 5\s*pasa a\s*0$/);
  });

  it("vínculo de un servidor anterior (sin `components`): las dos caras salen de la unidad vinculada", async () => {
    await renderOpen(legacySingle);

    const effects = within(await openConfirm()).getAllByRole("listitem");

    expect(effects).toHaveLength(2);
    expect(effects[0]).toHaveTextContent(/−1 Caja cigarros \(x10\)\s*Stock 5\s*pasa a\s*4$/);
    expect(effects[1]).toHaveTextContent(/\+10 Cigarro suelto\s*Stock 3\s*pasa a\s*13$/);
  });

  it("unidad inactiva: se marca en la confirmación, sin bloquear", async () => {
    await renderOpen({ ...single, components: [unitComponent(false)] });

    const effects = within(await openConfirm()).getAllByRole("listitem");

    expect(effects[1]).toHaveTextContent(/\+10 Cigarro suelto \(inactivo\)\s*Stock 3\s*pasa a\s*13$/);
    expect(effects[1]).toHaveAttribute("data-tone", "warning");
  });

  it("cancelar no envía nada y el formulario conserva lo tecleado", async () => {
    const { api, onConverted } = await renderOpen();
    setQuantity("2");
    setReason("Reposición");

    await cancelConfirm(await openConfirm());

    expect(api.posts).toHaveLength(0);
    expect(onConverted).not.toHaveBeenCalled();
    expect(document.getElementById(formId)).not.toBeNull();
    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("2");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Reposición");
  });

  it("confirmar envía UNA petición aunque haya doble clic, con el payload de siempre (sin `components`)", async () => {
    const { api, onConverted } = await renderOpen();
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
    expect(onConverted).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    // Tras el éxito, lo de siempre: se cierra todo y avisa con lo que entró.
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(onConverted).toHaveBeenCalledTimes(1);
    expect(
      within(await screen.findByRole("status")).getByText(
        "Abriste 2 Caja cigarros (x10): +20 Cigarro suelto",
      ),
    ).toBeInTheDocument();
    expect(api.posts).toHaveLength(1);
  });
});

describe("ProductDetailPackConversionCard · empaque en negativo (CNF-F2)", () => {
  it("más empaques de los que hay: avisa y no llega a la confirmación", async () => {
    const { api } = await renderOpen();
    setQuantity("6");

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();

    submitForm();
    await flush();

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("6");
  });

  it("sin empaques en stock: avisa y no llega a la confirmación", async () => {
    const { api } = await renderOpen(single, 0);

    expect(screen.getByText("No hay empaques en stock para abrir.")).toBeVisible();

    submitForm();
    await flush();

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
  });
});

describe("ProductDetailPackConversionCard · error del servidor en la confirmación (CNF-F2)", () => {
  it("el 409 se muestra tal cual dentro de la confirmación; al cancelarla, el formulario sigue intacto", async () => {
    const { api, onConverted } = await renderOpen();
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
    expect(onConverted).not.toHaveBeenCalled();
    expect(api.posts).toHaveLength(1);
  });
});
