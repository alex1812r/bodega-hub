import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

/**
 * CNF-15 · conversión de empaque: el empaque precargado y la cantidad inicial
 * (1) no cuentan como tecleados; con cantidad, motivo o reparto cambiados,
 * cerrar pregunta nombrando el empaque. Tras convertir, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const TITLE = "Convertir empaque";
const CONFIRM_TITLE = "Confirmar conversión de empaque";
const GUARD_LABEL = "Conversión de «Caja cigarros (x10)» sin registrar";

function product(id: string, name: string, currentStock: number) {
  return { currentCostRef: 1, currentStock, id, name, salePriceRef: 2, sku: `${id}-sku` };
}

function component(unitProductId: string, name: string, currentStock: number, unitsPerPack: number) {
  return {
    costWeight: 1,
    currentStock,
    isActive: true,
    name,
    sku: `${unitProductId}-sku`,
    unitProductId,
    unitsPerPack,
  };
}

const single = {
  components: [component("prod-cigar-unit", "Cigarro suelto", 3, 10)],
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
    component("prod-cola", "Cola", 12, 2),
    component("prod-manzana", "Manzana", 0, 2),
  ],
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

async function renderModal(packProductId = "prod-cigar-pack") {
  const user = userEvent.setup({ delay: null });
  const api = installFetchStub(() => [single, assorted]);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <InventoryPackConversionModal defaultPackProductId={packProductId} />
      </ToastProvider>
    </QueryWrapper>,
  );
  await user.click(screen.getByRole("button", { name: "Convertir empaque" }));
  await screen.findByText(/Stock empaque: /);
  await settleDialog();

  return { api, user };
}

async function setQuantity(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(screen.getByLabelText("Cantidad de empaques"));
  await user.type(screen.getByLabelText("Cantidad de empaques"), value);
}

function submitForm() {
  fireEvent.submit(document.getElementById("inventory-pack-conversion-form") as HTMLFormElement);
}

describe("InventoryPackConversionModal · guardia de datos tecleados (CNF-15)", () => {
  it.each(CLOSE_WAYS)(
    "con el empaque precargado y la cantidad inicial, %s cierra directo, sin pregunta",
    async (way) => {
      const { user } = await renderModal();

      expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("1");
      expect(dispatchBeforeUnload()).toBe(false);

      await closeModalWith(user, TITLE, way);

      await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
      expect(queryGuardDialog()).not.toBeInTheDocument();
    },
  );

  it.each(CLOSE_WAYS)(
    "con la cantidad cambiada, %s pregunta nombrando el empaque y no cierra",
    async (way) => {
      const { user } = await renderModal();

      await setQuantity(user, "2");

      expect(dispatchBeforeUnload()).toBe(true);

      await closeModalWith(user, TITLE, way);

      const guard = await findGuardDialog();

      expect(guard).toHaveTextContent(GUARD_LABEL);
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    },
  );

  it("volver a la cantidad inicial no cuenta; un motivo tecleado sí", async () => {
    const { user } = await renderModal();

    await setQuantity(user, "2");
    await setQuantity(user, "1");

    expect(dispatchBeforeUnload()).toBe(false);

    await user.type(screen.getByLabelText("Motivo"), "apertura");

    expect(dispatchBeforeUnload()).toBe(true);
  });

  it("surtido: editar el reparto cuenta como dato tecleado", async () => {
    const { user } = await renderModal("prod-surtido");

    expect(dispatchBeforeUnload()).toBe(false);

    await user.clear(screen.getByLabelText("Unidades de Cola"));
    await user.type(screen.getByLabelText("Unidades de Cola"), "3");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent("Conversión de «Surtido A» sin registrar");
  });

  it("«Seguir aquí» conserva cantidad y motivo, y devuelve el foco al campo", async () => {
    const { user } = await renderModal();

    await setQuantity(user, "2");
    await user.type(screen.getByLabelText("Motivo"), "apertura");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("2");
    expect(screen.getByLabelText("Motivo")).toHaveValue("apertura");
    expect(screen.getByLabelText("Motivo")).toHaveFocus();
  });

  it("«Salir» descarta: al reabrir vuelve la cantidad inicial y cierra sin preguntar", async () => {
    const { user } = await renderModal();

    await setQuantity(user, "2");
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Convertir empaque" }));
    await screen.findByText(/Stock empaque: /);
    await settleDialog();

    expect(screen.getByLabelText("Cantidad de empaques")).toHaveValue("1");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("cancelar la confirmación interna vuelve al formulario sin disparar el guardia", async () => {
    const { api, user } = await renderModal();

    await setQuantity(user, "2");
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
    const { user } = await renderModal();

    await setQuantity(user, "2");
    submitForm();
    await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    clickLinkToAnotherRoute();

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
    expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument();

    await answerGuard(user, "Seguir aquí");

    expect(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).toBeInTheDocument();
  });

  it("tras convertir con éxito cierra sin preguntar, avisa con el toast y el guardia queda inactivo", async () => {
    const { api, user } = await renderModal();

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
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });
});
