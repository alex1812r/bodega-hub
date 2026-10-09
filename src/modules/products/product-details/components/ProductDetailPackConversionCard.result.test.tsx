/**
 * PRO-F7 · QA PRO-13 F2 y observación del título: al abrir un empaque desde el
 * detalle no había mensaje de resultado ni aviso de componente inactivo.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function recipeComponent(unitProductId: string, name: string, isActive = true) {
  return {
    costWeight: 1,
    currentStock: 4,
    isActive,
    name,
    sku: `${unitProductId}-sku`,
    unitProductId,
    unitsPerPack: 2,
  };
}

function resultComponent(unitProductId: string, units: number, isActive = true) {
  return { allocatedValueRef: 4, costWeight: 1, isActive, newCostRef: 2, unitCostRef: 2, unitProductId, units };
}

const cola = {
  currentCostRef: 0.5,
  currentStock: 4,
  id: "prod-cola",
  name: "Cola",
  salePriceRef: 1,
  sku: "cola-001",
};

const assorted: ProductPackConversionSummary = {
  components: [
    recipeComponent("prod-cola", "Cola"),
    recipeComponent("prod-manzana", "Manzana"),
    recipeComponent("prod-naranja", "Naranja", false),
  ],
  id: "ppc-sabores",
  kind: "assorted",
  label: "Sabores surtidos",
  linkedProduct: cola,
  role: "pack",
  sources: [],
  totalUnits: 6,
  unitsPerPack: 6,
};

function renderCard(conversion: ProductPackConversionSummary, productName: string) {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <ProductDetailPackConversionCard
          packConversion={conversion}
          productId="prod-pack"
          productName={productName}
          productStock={5}
        />
      </ToastProvider>
    </QueryWrapper>,
  );
}

function getForm() {
  return document.getElementById("open-pack-form") as HTMLFormElement;
}

describe("ProductDetailPackConversionCard · resultado de abrir (PRO-F7)", () => {
  it("el título lleva tilde: «Conversión de empaque»", () => {
    installFetchStub(() => null);
    renderCard(assorted, "Surtido A");

    expect(screen.getByRole("heading", { name: "Conversión de empaque" })).toBeVisible();
  });

  it("surtido: el modal lista lo que se abrirá y, al abrir, dice qué entró y avisa del inactivo", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost({
      data: {
        components: [
          resultComponent("prod-cola", 4),
          resultComponent("prod-manzana", 4),
          resultComponent("prod-naranja", 4, false),
        ],
        conversionId: "conv-1",
        packQuantity: 2,
        totalUnits: 6,
        unitQuantity: 12,
        unitsPerPack: 6,
      },
    });
    renderCard(assorted, "Surtido A");

    fireEvent.click(screen.getByRole("button", { name: "Abrir según la receta" }));
    fireEvent.change(await screen.findByLabelText("Cantidad de empaques"), {
      target: { value: "2" },
    });

    // INV-08: lo que se abrirá es el reparto editable, precargado con receta × empaques.
    expect(screen.getByLabelText("Unidades de Cola")).toHaveValue("4");
    expect(screen.getByLabelText("Unidades de Manzana")).toHaveValue("4");
    expect(screen.getByLabelText("Unidades de Naranja")).toHaveValue("4");
    expect(screen.getByText("Naranja (inactivo)")).toBeVisible();
    expect(screen.getByText(/Entrada: \+12 unidad\(es\)/)).toBeVisible();

    // CNF-F4: sin motivo la confirmación no se abre.
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Reposición de mostrador" } });
    fireEvent.submit(getForm());
    // INV-08: un surtido pasa por la confirmación antes de enviarse.
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Abrir empaque surtido" })).getByRole("button", {
        name: "Abrir empaque",
      }),
    );

    const status = await screen.findByRole("status");

    await waitFor(() =>
      expect(
        within(status).getByText("Abriste 2 Surtido A: +4 Cola, +4 Manzana, +4 Naranja"),
      ).toBeInTheDocument(),
    );
    expect(
      within(status).getByText(
        "Entró stock a un producto inactivo: Naranja. Actívalo para poder venderlo.",
      ),
    ).toBeInTheDocument();
    // Aviso, no bloqueo: va en la región `status` (la de `alert` sigue vacía); el modal se cierra como siempre.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    await waitFor(() => expect(document.getElementById("open-pack-form")).toBeNull());
  });

  it("1 a 1: el formulario queda como estaba y, tras confirmar, el aviso dice las unidades", async () => {
    const api = installFetchStub(() => null);
    api.respondToNextPost({
      data: {
        components: [resultComponent("prod-cola", 6)],
        conversionId: "conv-2",
        packQuantity: 1,
        totalUnits: 6,
        unitQuantity: 6,
        unitsPerPack: 6,
      },
    });
    renderCard({ id: "ppc-cola", linkedProduct: cola, role: "pack", unitsPerPack: 6 }, "Caja Cola x6");

    fireEvent.click(screen.getByRole("button", { name: "Abrir empaque" }));
    await screen.findByLabelText("Cantidad de empaques");

    expect(
      screen.getByText("Salida: −1 empaque(s). Entrada: +6 unidad(es). Stock actual empaque: 5."),
    ).toBeVisible();
    expect(screen.queryByText(/Se abrirá en/)).not.toBeInTheDocument();

    // CNF-F4: sin motivo la confirmación no se abre.
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Reposición de mostrador" } });
    fireEvent.submit(getForm());

    // CNF-F2: el 1 a 1 también pasa por la confirmación antes de enviarse.
    const dialog = await screen.findByRole("dialog", { name: "Confirmar conversión de empaque" });

    expect(api.posts).toHaveLength(0);
    expect(screen.queryByText(/Abriste/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Convertir empaque" }));

    const status = await screen.findByRole("status");

    await waitFor(() =>
      expect(within(status).getByText("Abriste 1 Caja Cola x6: +6 Cola")).toBeInTheDocument(),
    );
    expect(api.posts).toHaveLength(1);
    expect(screen.queryByText(/producto inactivo/)).not.toBeInTheDocument();
  });
});
