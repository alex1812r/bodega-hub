/**
 * PRO-09 · "% de ganancia sugerido" de la categoría (opcional; vacío = sin
 * sugerencia).
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CategoryMock } from "@/shared/mocks/erp-data";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { CategoryFormModal } from "./CategoryFormModal";
import { CategoryQuickCreateModal } from "./CategoryQuickCreateModal";

const MARKUP_LABEL = "% de ganancia sugerido (opcional)";

const taxRates = [
  {
    code: "general",
    id: "tax-general",
    isActive: true,
    isDefault: true,
    isGlobal: true,
    label: "General",
    pct: 16,
    sortOrder: 0,
  },
];

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
  const onOpenChange = jest.fn();

  installFetchStub(() => ({ items: taxRates }));
  render(<CategoryFormModal onOpenChange={onOpenChange} onSubmit={onSubmit} open {...props} />, {
    wrapper: createQueryWrapper(),
  });

  return { onOpenChange, onSubmit, user };
}

async function markupField() {
  // El chip aparece cuando llega el catálogo: el formulario ya está completo.
  await screen.findByRole("button", { name: /Alícuota de IVA/ });

  return screen.getByLabelText(MARKUP_LABEL);
}

describe("CategoryFormModal · % de ganancia sugerido (PRO-09)", () => {
  it("es un campo de texto opcional, no un type=number", async () => {
    renderModal();

    const field = await markupField();

    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expect(field).not.toBeRequired();
    expect(field).toHaveValue("");
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("alta con % sugerido: lo envía como número (coma decimal incluida)", async () => {
    const { onSubmit, user } = renderModal();

    await user.type(await markupField(), "22,5");
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Chucherías");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      defaultMarkupPct: 22.5,
      description: undefined,
      name: "Chucherías",
      taxRate: 16,
    });
  });

  it("alta sin % sugerido: el campo no viaja", async () => {
    const { onSubmit, user } = renderModal();

    await markupField();
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Chucherías");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("defaultMarkupPct");
  });

  it("edición: abre con el % de la categoría y envía el nuevo", async () => {
    const { onSubmit, user } = renderModal({
      category: buildCategory({ defaultMarkupPct: 18 }),
      mode: "edit",
    });
    const field = await markupField();

    expect(field).toHaveValue("18");

    await user.clear(field);
    await user.type(field, "35");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      defaultMarkupPct: 35,
      description: "Refrescos y jugos",
      name: "Bebidas",
    });
  });

  it("edición: borrar el % que tenía envía null para quitar la sugerencia", async () => {
    const { onSubmit, user } = renderModal({
      category: buildCategory({ defaultMarkupPct: 18 }),
      mode: "edit",
    });

    await user.clear(await markupField());
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      defaultMarkupPct: null,
      description: "Refrescos y jugos",
      name: "Bebidas",
    });
  });

  it("edición de una categoría sin % y sin escribirlo: el campo no viaja", async () => {
    const { onSubmit, user } = renderModal({ category: buildCategory(), mode: "edit" });

    expect(await markupField()).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("defaultMarkupPct");
  });

  it("el alta rápida desde el producto no pide el % sugerido", async () => {
    installFetchStub(() => ({ items: taxRates }));
    render(<CategoryQuickCreateModal onCreated={jest.fn()} onOpenChange={jest.fn()} />, {
      wrapper: createQueryWrapper(),
    });

    await screen.findByRole("button", { name: /Alícuota de IVA/ });

    expect(screen.queryByLabelText(MARKUP_LABEL)).not.toBeInTheDocument();
  });
});
