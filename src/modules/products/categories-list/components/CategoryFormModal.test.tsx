import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TaxRate } from "@/shared/hooks/useTaxRates";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { CategoryFormModal } from "./CategoryFormModal";

/** PRO-02 · la alícuota de la categoría se elige con chips; el IVA no se teclea. */

function buildRate(overrides: Partial<TaxRate> & Pick<TaxRate, "code" | "pct">): TaxRate {
  return {
    id: `tax-${overrides.code}`,
    isActive: true,
    isDefault: false,
    isGlobal: true,
    label: overrides.code,
    sortOrder: 0,
    ...overrides,
  };
}

const exempt = buildRate({ code: "exento", label: "Exento", pct: 0 });
const reduced = buildRate({ code: "reducida", label: "Reducida", pct: 8 });
const general = buildRate({ code: "general", isDefault: true, label: "General", pct: 16 });
const luxury = buildRate({ code: "lujo", isActive: false, label: "Lujo", pct: 31 });

function installTaxRates(rates: TaxRate[] = [exempt, reduced, general, luxury]) {
  return installFetchStub(() => ({ items: rates }));
}

function buildCategory(overrides: Partial<CategoryMock> = {}): CategoryMock {
  return {
    description: "Refrescos y jugos",
    id: "cat-drinks",
    isActive: true,
    name: "Bebidas",
    taxRate: 16,
    taxRateId: "tax-general",
    ...overrides,
  };
}

type ModalProps = Parameters<typeof CategoryFormModal>[0];

function renderModal(props: ModalProps = {}) {
  const user = userEvent.setup({ delay: null });
  const onSubmit = jest.fn();

  render(<CategoryFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open {...props} />, {
    wrapper: createQueryWrapper(),
  });

  return { onSubmit, user };
}

function findChip() {
  return screen.findByRole("button", { name: /Alícuota de IVA/ });
}

async function chooseRate(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await findChip());
  await user.click(screen.getByRole("radio", { name }));
}

describe("CategoryFormModal · alícuota con chips (PRO-02)", () => {
  it("no tiene ningún campo numérico ni IVA tecleable", async () => {
    installTaxRates();
    renderModal();
    await findChip();

    const form = document.querySelector("form") as HTMLFormElement;

    expect(form.querySelector('input[type="number"]')).toBeNull();
    expect(screen.queryByLabelText(/Impuesto/)).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    // Lo único que se escribe: Nombre y Descripción.
    expect(screen.getAllByRole("textbox").map((field) => field.getAttribute("name"))).toEqual([
      "name",
      "description",
    ]);
  });

  it("alta: abre con la alícuota por defecto de la tienda y envía la del chip elegido", async () => {
    installTaxRates();

    const { onSubmit, user } = renderModal();

    expect(await findChip()).toHaveAccessibleName("Alícuota de IVA: IVA 16 %");

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("  Chucherías ");
    await chooseRate(user, /Reducida/);

    expect(await findChip()).toHaveAccessibleName("Alícuota de IVA: IVA 8 %");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      description: undefined,
      name: "Chucherías",
      taxRate: 8,
    });
  });

  it("alta sin tocar el chip: envía la alícuota por defecto, aunque no sea la del 16 %", async () => {
    installTaxRates([
      exempt,
      { ...reduced, isDefault: true },
      { ...general, isDefault: false },
    ]);

    const { onSubmit, user } = renderModal();

    expect(await findChip()).toHaveAccessibleName("Alícuota de IVA: IVA 8 %");

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Chucherías");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Chucherías", taxRate: 8 });
  });

  it("alta con una alícuota exenta: envía 0, no la deja sin enviar", async () => {
    installTaxRates();

    const { onSubmit, user } = renderModal();

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Canasta básica");
    await chooseRate(user, /Exento/);
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ taxRate: 0 });
  });

  it("edición: muestra la alícuota de la categoría y, sin tocarla, no la envía", async () => {
    installTaxRates();

    const { onSubmit, user } = renderModal({
      category: buildCategory({ taxRate: 8, taxRateId: "tax-reducida" }),
      mode: "edit",
    });

    expect(await findChip()).toHaveAccessibleName("Alícuota de IVA: IVA 8 %");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Bebidas");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      description: "Refrescos y jugos",
      name: "Bebidas",
    });
  });

  it("edición: al elegir otro chip envía su alícuota", async () => {
    installTaxRates();

    const { onSubmit, user } = renderModal({ category: buildCategory(), mode: "edit" });

    await chooseRate(user, /Exento/);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Bebidas", taxRate: 0 });
  });

  it("edición con una alícuota desactivada: se muestra tal cual y se conserva al guardar", async () => {
    installTaxRates();

    const { onSubmit, user } = renderModal({
      category: buildCategory({ taxRate: 31, taxRateId: "tax-lujo" }),
      mode: "edit",
    });

    expect(await findChip()).toHaveAccessibleName("Alícuota de IVA: IVA 31 % (inactiva)");

    // La lista solo ofrece las activas.
    await user.click(await findChip());
    expect(screen.queryByRole("radio", { name: /Lujo/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.clear(screen.getByLabelText("Nombre"));
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Licores");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      description: "Refrescos y jugos",
      name: "Licores",
    });
  });

  it("edición con una alícuota que ya no existe en el catálogo: muestra su % y no la pierde", async () => {
    installTaxRates();

    const { onSubmit, user } = renderModal({
      category: buildCategory({ taxRate: 12.5, taxRateId: "tax-borrada" }),
      mode: "edit",
    });

    expect(await findChip()).toHaveAccessibleName("Alícuota de IVA: IVA 12,5 % (inactiva)");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("taxRate");
  });

  it("muestra el error del servidor", async () => {
    installTaxRates();
    renderModal({ errorMessage: "Ya existe una categoría con ese nombre." });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe una categoría con ese nombre.",
    );
  });
});
