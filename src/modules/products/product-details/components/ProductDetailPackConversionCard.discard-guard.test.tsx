import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import {
  createQueryWrapper,
  installFetchStub,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";
import {
  answerGuard,
  CLOSE_WAYS,
  clickLinkToAnotherRoute,
  closeModalWith,
  dispatchBeforeUnload,
  findGuardDialog,
  queryDialogByTitle,
  queryGuardDialog,
  settleDialog,
} from "@/shared/hooks/useFormModalDiscardGuard.testUtils";
import type { ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import { ProductDetailPackConversionCard } from "./ProductDetailPackConversionCard";

/**
 * CNF-15 · «Abrir empaque» del detalle del producto: la cantidad inicial (1) no
 * cuenta como tecleada; con cantidad o motivo cambiados, cerrar pregunta
 * nombrando el empaque. Tras abrirlo, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const TITLE = "Abrir empaque";
const CONFIRM_TITLE = "Confirmar conversión de empaque";
const GUARD_LABEL = "Apertura de empaque «Caja cigarros (x10)» sin registrar";

const unit = {
  currentCostRef: 0.5,
  currentStock: 3,
  id: "prod-cigar-unit",
  name: "Cigarro suelto",
  salePriceRef: 1,
  sku: "cigar-unit",
};

const single: ProductPackConversionSummary = {
  components: [
    {
      costWeight: 1,
      currentStock: unit.currentStock,
      isActive: true,
      name: unit.name,
      sku: unit.sku,
      unitProductId: unit.id,
      unitsPerPack: 10,
    },
  ],
  id: "ppc-cigars",
  kind: "single",
  label: null,
  linkedProduct: unit,
  role: "pack",
  sources: [],
  totalUnits: 10,
  unitsPerPack: 10,
};

async function renderOpen() {
  const user = userEvent.setup({ delay: null });
  const api = installFetchStub(() => null);
  const onConverted = jest.fn();
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <ProductDetailPackConversionCard
          onConverted={onConverted}
          packConversion={single}
          productId="prod-cigar-pack"
          productName="Caja cigarros (x10)"
          productStock={5}
        />
      </ToastProvider>
    </QueryWrapper>,
  );
  await user.click(screen.getByRole("button", { name: "Abrir empaque" }));
  await screen.findByLabelText("Cantidad de empaques");
  await settleDialog();

  return { api, onConverted, user };
}

async function setQuantity(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(screen.getByLabelText("Cantidad de empaques"));
  await user.type(screen.getByLabelText("Cantidad de empaques"), value);
}

function submitForm() {
  fireEvent.submit(document.getElementById("open-pack-form") as HTMLFormElement);
}

describe("ProductDetailPackConversionCard · guardia de datos tecleados (CNF-15)", () => {
  it.each(CLOSE_WAYS)("con la cantidad inicial, %s cierra directo, sin pregunta", async (way) => {
    const { user } = await renderOpen();

    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("1");
    expect(dispatchBeforeUnload()).toBe(false);

    await closeModalWith(user, TITLE, way);

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it.each(CLOSE_WAYS)(
    "con la cantidad cambiada, %s pregunta nombrando el empaque y no cierra",
    async (way) => {
      const { user } = await renderOpen();

      await setQuantity(user, "2");

      expect(dispatchBeforeUnload()).toBe(true);

      await closeModalWith(user, TITLE, way);

      const guard = await findGuardDialog();

      expect(guard).toHaveTextContent(GUARD_LABEL);
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    },
  );

  it("«Seguir aquí» conserva cantidad y motivo, y devuelve el foco al campo", async () => {
    const { user } = await renderOpen();

    await setQuantity(user, "2");
    await user.type(screen.getByLabelText("Motivo"), "apertura");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("2");
    expect(screen.getByLabelText("Motivo")).toHaveValue("apertura");
    expect(screen.getByLabelText("Motivo")).toHaveFocus();
  });

  it("«Salir» descarta lo tecleado: al reabrir vuelve la cantidad inicial y cierra sin preguntar", async () => {
    const { user } = await renderOpen();

    await setQuantity(user, "2");
    await user.type(screen.getByLabelText("Motivo"), "apertura");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(dispatchBeforeUnload()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Abrir empaque" }));
    await screen.findByLabelText("Cantidad de empaques");
    await settleDialog();

    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("1");
    expect(screen.getByLabelText("Motivo")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("cancelar la confirmación interna vuelve al formulario sin disparar el guardia", async () => {
    const { api, user } = await renderOpen();

    await setQuantity(user, "2");
    await user.type(screen.getByLabelText("Motivo"), "apertura");
    submitForm();
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Cancelar",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("2");
    expect(api.posts).toHaveLength(0);
  });

  it("si el guardia pregunta con la confirmación abierta, no se apilan los tres niveles", async () => {
    const { user } = await renderOpen();

    await setQuantity(user, "2");
    await user.type(screen.getByLabelText("Motivo"), "apertura");
    submitForm();
    await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    clickLinkToAnotherRoute();

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
    expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument();

    await answerGuard(user, "Seguir aquí");

    expect(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).toBeInTheDocument();
  });

  it("tras abrir el empaque con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const { api, onConverted, user } = await renderOpen();

    api.respondToNextPost({ data: { conversionId: "conv-1", unitQuantity: 20 } });
    await setQuantity(user, "2");
    await user.type(screen.getByLabelText("Motivo"), "apertura");
    submitForm();
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Convertir empaque",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(api.posts).toHaveLength(1);
    expect(onConverted).toHaveBeenCalledTimes(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });
});
