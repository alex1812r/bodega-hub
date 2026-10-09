/**
 * PRO-F7 · QA PRO-13 F1 y F2: el modal describía un surtido como si fuera un
 * solo producto ("Surtido A → Cola (x6)… +18 unidad(es)") y, al abrir, no decía
 * qué entró ni avisaba de un componente inactivo.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

function component(unitProductId: string, name: string, isActive = true) {
  return {
    costWeight: 1,
    currentStock: 12,
    isActive,
    name,
    sku: `${unitProductId}-sku`,
    unitProductId,
    unitsPerPack: 2,
  };
}

const single = {
  components: [{ ...component("prod-cigar-unit", "Cigarro suelto"), unitsPerPack: 10 }],
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
  components: [
    component("prod-cola", "Cola"),
    component("prod-manzana", "Manzana"),
    component("prod-naranja", "Naranja", false),
  ],
  id: "ppc-surtido",
  kind: "assorted",
  label: "Sabores surtidos",
  // En un surtido `linkedProduct` es solo el primer componente por nombre.
  linkedProduct: product("prod-cola", "Cola", 12),
  packProduct: product("prod-surtido", "Surtido A", 9),
  role: "pack",
  sources: [],
  totalUnits: 6,
  unitsPerPack: 6,
};

function resultComponent(unitProductId: string, units: number, isActive = true) {
  return { allocatedValueRef: 4, costWeight: 1, isActive, newCostRef: 2, unitCostRef: 2, unitProductId, units };
}

async function renderOpen(defaultPackProductId?: string) {
  const api = installFetchStub(() => [single, assorted]);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <InventoryPackConversionModal defaultPackProductId={defaultPackProductId} />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));

  if (defaultPackProductId) {
    await screen.findByText(/Stock empaque: /);
  }

  return api;
}

function setQuantity(value: string) {
  fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value } });
}

function submit() {
  fireEvent.submit(document.getElementById("inventory-pack-conversion-form") as HTMLFormElement);
}

/** CNF-08: el 1 a 1 también pasa por la confirmación antes de enviarse. */
async function submitAndConfirmSingle() {
  submit();

  const dialog = await screen.findByRole("dialog", { name: "Confirmar conversión de empaque" });

  fireEvent.click(within(dialog).getByRole("button", { name: "Convertir empaque" }));

  return dialog;
}

describe("InventoryPackConversionModal · descripción de la receta (PRO-F7)", () => {
  it("surtido: lista los componentes según la receta y los empaques elegidos, con el total", async () => {
    await renderOpen("prod-surtido");
    setQuantity("3");

    expect(screen.getByRole("combobox", { name: "Producto empaque" })).toHaveValue("Surtido A");
    expect(
      screen.getByText(/Por empaque: 2 Cola · 2 Manzana · 2 Naranja \(inactivo\)\./),
    ).toBeVisible();
    // INV-08: lo que se abrirá es el reparto editable, precargado con receta × empaques.
    expect(screen.getByLabelText("Unidades de Cola")).toHaveValue("6");
    expect(screen.getByLabelText("Unidades de Manzana")).toHaveValue("6");
    expect(screen.getByLabelText("Unidades de Naranja")).toHaveValue("6");
    expect(screen.getByText("Naranja (inactivo)")).toBeVisible();
    expect(screen.getByText(/Preview: −3 empaque\(s\) \/ \+18 unidad\(es\)\./)).toBeVisible();
    // Nada que se lea como "18 Colas".
    expect(screen.queryByText(/Unidad: Cola/)).not.toBeInTheDocument();
  });

  it("el buscador describe el surtido como surtido y el 1 a 1 con su unidad", async () => {
    const user = userEvent.setup();
    await renderOpen();
    const field = await screen.findByRole("combobox", { name: "Producto empaque" });

    await user.type(field, "surt");

    const assortedOption = await screen.findByRole("option", { name: /Surtido A/ });

    expect(assortedOption).toHaveTextContent("→ surtido de 3 productos (x6)");
    expect(assortedOption).not.toHaveTextContent("→ Cola");

    await user.clear(field);
    await user.type(field, "caja");

    expect(await screen.findByRole("option", { name: /Caja cigarros \(x10\)/ })).toHaveTextContent(
      "→ Cigarro suelto (x10)",
    );
  });

  it("1 a 1: el texto queda exactamente como estaba", async () => {
    await renderOpen("prod-cigar-pack");
    setQuantity("2");

    expect(screen.getByRole("combobox", { name: "Producto empaque" })).toHaveValue(
      "Caja cigarros (x10)",
    );
    expect(screen.getByText("Stock empaque: 5. Unidad: Cigarro suelto (stock 3).")).toBeVisible();
    expect(screen.getByText("Preview: −2 empaque(s) / +20 unidad(es).")).toBeVisible();
    expect(screen.queryByText(/Se abrirá en/)).not.toBeInTheDocument();
  });
});

describe("InventoryPackConversionModal · mensaje de resultado (PRO-F7)", () => {
  it("surtido: dice qué entró a cada producto y avisa del componente inactivo sin bloquear", async () => {
    const api = await renderOpen("prod-surtido");
    api.respondToNextPost({
      data: {
        components: [
          resultComponent("prod-cola", 6),
          resultComponent("prod-manzana", 6),
          resultComponent("prod-naranja", 6, false),
        ],
        conversionId: "conv-1",
        packQuantity: 3,
        totalUnits: 6,
        unitQuantity: 18,
        unitsPerPack: 6,
      },
    });
    setQuantity("3");
    submit();
    // INV-08: un surtido pasa por la confirmación antes de enviarse.
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Abrir empaque surtido" })).getByRole("button", {
        name: "Abrir empaque",
      }),
    );

    const status = await screen.findByRole("status");

    await waitFor(() =>
      expect(
        within(status).getByText("Abriste 3 Surtido A: +6 Cola, +6 Manzana, +6 Naranja"),
      ).toBeInTheDocument(),
    );
    expect(
      within(status).getByText(
        "Entró stock a un producto inactivo: Naranja. Actívalo para poder venderlo.",
      ),
    ).toBeInTheDocument();
    // Aviso, no bloqueo: va en la región `status` (la de `alert` sigue vacía) y el modal se cerró como siempre.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(document.getElementById("inventory-pack-conversion-form")).toBeNull(),
    );
    expect(api.posts[0]?.body.components).toEqual([
      { unitProductId: "prod-cola", units: 6 },
      { unitProductId: "prod-manzana", units: 6 },
      { unitProductId: "prod-naranja", units: 6 },
    ]);
  });

  it("1 a 1: confirma las unidades que entraron, sin aviso de inactivo", async () => {
    const api = await renderOpen("prod-cigar-pack");
    api.respondToNextPost({
      data: {
        components: [resultComponent("prod-cigar-unit", 20)],
        conversionId: "conv-2",
        packQuantity: 2,
        totalUnits: 10,
        unitQuantity: 20,
        unitsPerPack: 10,
      },
    });
    setQuantity("2");
    await submitAndConfirmSingle();

    const status = await screen.findByRole("status");

    await waitFor(() =>
      expect(
        within(status).getByText("Abriste 2 Caja cigarros (x10): +20 Cigarro suelto"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/producto inactivo/)).not.toBeInTheDocument();
  });

  it("un error del servidor no muestra mensaje de éxito", async () => {
    const api = await renderOpen("prod-cigar-pack");
    api.respondToNextPost({ error: { message: "Stock insuficiente de empaque" } }, 409);
    const dialog = await submitAndConfirmSingle();

    await within(dialog).findByText("Stock insuficiente de empaque");
    expect(screen.queryByText(/Abriste/)).not.toBeInTheDocument();
  });
});
