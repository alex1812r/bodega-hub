import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

/**
 * CNF-15 · ajuste de stock: el producto precargado o bloqueado no cuenta como
 * tecleado; con tipo, cantidad o motivo cambiados, cerrar pregunta nombrando el
 * producto. Sin cambios, o tras registrar, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const TITLE = "Ajuste de stock";
const CONFIRM_TITLE = "Confirmar ajuste de stock";
const GUARD_LABEL = "Ajuste de stock de «Harina PAN» sin registrar";

const harina = {
  barcode: null,
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 11,
  id: "prod-harina",
  isActive: true,
  name: "Harina PAN",
  salePriceRef: 2,
  sku: "HAR-1",
};

async function renderModal() {
  const user = userEvent.setup({ delay: null });
  const api = installFetchStub(() => harina);

  render(<InventoryAdjustmentModal defaultProductId="prod-harina" />, {
    wrapper: createQueryWrapper(),
  });
  await user.click(screen.getByRole("button", { name: "Registrar ajuste" }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Producto" })).toHaveValue("Harina PAN (HAR-1)"),
  );
  await settleDialog();

  return { api, user };
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Cantidad"), "3");
  await user.type(screen.getByLabelText("Motivo"), "Conteo físico");
}

function submitForm() {
  fireEvent.submit(document.getElementById("inventory-adjustment-form") as HTMLFormElement);
}

describe("InventoryAdjustmentModal · guardia de datos tecleados (CNF-15)", () => {
  it.each(CLOSE_WAYS)(
    "con el producto precargado y nada tecleado, %s cierra directo, sin pregunta",
    async (way) => {
      const { user } = await renderModal();

      expect(dispatchBeforeUnload()).toBe(false);

      await closeModalWith(user, TITLE, way);

      await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
      expect(queryGuardDialog()).not.toBeInTheDocument();
    },
  );

  it.each(CLOSE_WAYS)(
    "con cantidad y motivo tecleados, %s pregunta nombrando el producto y no cierra",
    async (way) => {
      const { user } = await renderModal();

      await fill(user);

      expect(dispatchBeforeUnload()).toBe(true);

      await closeModalWith(user, TITLE, way);

      const guard = await findGuardDialog();

      expect(guard).toHaveTextContent(GUARD_LABEL);
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    },
  );

  it("cambiar solo el tipo de movimiento ya cuenta; volver al inicial, no", async () => {
    const { user } = await renderModal();

    await user.selectOptions(screen.getByLabelText("Tipo de movimiento"), "ajuste_salida");

    expect(dispatchBeforeUnload()).toBe(true);

    await user.selectOptions(screen.getByLabelText("Tipo de movimiento"), "ajuste_entrada");

    expect(dispatchBeforeUnload()).toBe(false);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("«Seguir aquí» conserva producto, cantidad y motivo, y devuelve el foco al campo", async () => {
    const { user } = await renderModal();

    await fill(user);
    await user.keyboard("{Escape}");
    await answerGuard(user, "Seguir aquí");

    expect(screen.getByRole("combobox", { name: "Producto" })).toHaveValue("Harina PAN (HAR-1)");
    expect(screen.getByLabelText("Cantidad")).toHaveValue("3");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Conteo físico");
    expect(screen.getByLabelText("Motivo")).toHaveFocus();
  });

  it("«Salir» descarta: al reabrir el formulario está limpio y cierra sin preguntar", async () => {
    const { user } = await renderModal();

    await fill(user);
    await user.keyboard("{Escape}");
    await answerGuard(user, "Salir");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Registrar ajuste" }));
    await settleDialog();

    expect(screen.getByLabelText("Cantidad")).toHaveValue("");
    expect(screen.getByLabelText("Motivo")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("cancelar la confirmación interna vuelve al formulario sin disparar el guardia", async () => {
    const { api, user } = await renderModal();

    await fill(user);
    submitForm();
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Cancelar",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument());
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(queryDialogByTitle(TITLE)).toBeInTheDocument();
    expect(screen.getByLabelText("Cantidad")).toHaveValue("3");
    expect(api.posts).toHaveLength(0);
  });

  it("si el guardia pregunta con la confirmación abierta, no se apilan los tres niveles", async () => {
    const { user } = await renderModal();

    await fill(user);
    submitForm();
    await screen.findByRole("dialog", { name: CONFIRM_TITLE });
    clickLinkToAnotherRoute();

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
    expect(queryDialogByTitle(CONFIRM_TITLE)).not.toBeInTheDocument();

    await answerGuard(user, "Seguir aquí");

    expect(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).toBeInTheDocument();
  });

  it("tras registrar con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const { api, user } = await renderModal();

    api.respondToNextPost({ data: { id: "mov-1" } });
    await fill(user);
    submitForm();
    await user.click(
      within(await screen.findByRole("dialog", { name: CONFIRM_TITLE })).getByRole("button", {
        name: "Registrar movimiento",
      }),
    );

    await waitFor(() => expect(queryDialogByTitle(TITLE)).not.toBeInTheDocument());
    expect(api.posts).toHaveLength(1);
    expect(queryGuardDialog()).not.toBeInTheDocument();
    expect(dispatchBeforeUnload()).toBe(false);

    clickLinkToAnotherRoute();
    expect(queryGuardDialog()).not.toBeInTheDocument();
  });

  it("producto bloqueado (detalle del producto): sin teclear cierra directo; con cantidad pregunta", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();

    installFetchStub(() => harina);
    render(
      <InventoryAdjustmentModal
        lockedProduct={{ currentStock: 11, id: "prod-harina", name: "Harina PAN", sku: "HAR-1" }}
        onOpenChange={onOpenChange}
        open
      />,
      { wrapper: createQueryWrapper() },
    );
    await settleDialog();

    expect(dispatchBeforeUnload()).toBe(false);

    await user.type(screen.getByLabelText("Cantidad"), "3");
    await user.keyboard("{Escape}");

    expect(await findGuardDialog()).toHaveTextContent(GUARD_LABEL);
    expect(onOpenChange).not.toHaveBeenCalled();

    await answerGuard(user, "Salir");

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
