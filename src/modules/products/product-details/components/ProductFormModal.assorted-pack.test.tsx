import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockProducts, type ProductPackConversionSummary } from "@/shared/mocks/erp-data";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import type { ProductWithCategory } from "../../hooks/useProducts";
import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

/** PRO-13 · empaque surtido dentro del formulario de producto. */

// El formulario lleva el guardia de cambios sin guardar (`useProcessGuard`), que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

// Sin configuración de la tienda: el formulario usa los chips y el semáforo por defecto.
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type UserSession = ReturnType<typeof userEvent.setup>;

const baseProduct = mockProducts[0];

function component(unitProductId: string, name: string, isActive = true) {
  return {
    costWeight: 1,
    currentStock: 5,
    isActive,
    name,
    sku: `${unitProductId}-sku`,
    unitProductId,
    unitsPerPack: 2,
  };
}

const assortedRecipe: ProductPackConversionSummary = {
  components: [
    component("prod-cola", "Cola"),
    component("prod-manzana", "Manzana", false),
    component("prod-naranja", "Naranja"),
  ],
  id: "ppc-sabores",
  kind: "assorted",
  label: "Sabores",
  linkedProduct: {
    currentCostRef: 0.5,
    currentStock: 5,
    id: "prod-cola",
    name: "Cola",
    salePriceRef: 1,
    sku: "prod-cola-sku",
  },
  role: "pack",
  sources: [],
  totalUnits: 6,
  unitsPerPack: 6,
};

const assortedPackProduct: ProductWithCategory = {
  ...baseProduct,
  id: "prod-sabores",
  name: "Refrescos sabores x6",
  packConversion: assortedRecipe,
  sku: "ref-sab-006",
};

const createdUnit: ProductWithCategory = {
  ...baseProduct,
  barcode: null,
  id: "prod-uva",
  name: "Uva",
  sku: "uva",
};

function installApi() {
  return installFetchStub(() => ({ items: [], limit: 100, skip: 0, total: 0 }));
}

function renderForm(props: Partial<ProductFormModalProps> = {}) {
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn();
  const user = userEvent.setup({ delay: null });

  render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open {...props} />, {
    wrapper: createQueryWrapper(),
  });

  return { onOpenChange, onSubmit, user };
}

function renderEdit() {
  return renderForm({ mode: "edit", product: assortedPackProduct });
}

function moreOptionsToggle() {
  return screen.getByRole("button", { name: /Más opciones/ });
}

function productField(position: number) {
  return screen.getByRole("combobox", { hidden: true, name: `Producto ${position}` });
}

function unitsField(position: number) {
  return screen.getByLabelText(`Unidades del producto ${position}`);
}

function totalField() {
  return screen.getByLabelText(/Unidades por empaque/);
}

async function replaceText(user: UserSession, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.type(field, text);
}

/** Cierra "Más opciones" y envía: los avisos deben abrirla solos. */
async function submitWithSectionClosed(user: UserSession) {
  await user.click(moreOptionsToggle());
  expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");
  await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
}

// PRO-F10: la Categoría es obligatoria en el alta; estas pruebas abren con una ya elegida.
const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};

describe("ProductFormModal · empaque surtido (PRO-13)", () => {
  it("edición sin tocar la receta: envía el input `assorted` exacto del contrato", async () => {
    installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].packConversion).toEqual({
      components: [
        { unitProductId: "prod-cola", unitsPerPack: 2 },
        { unitProductId: "prod-manzana", unitsPerPack: 2 },
        { unitProductId: "prod-naranja", unitsPerPack: 2 },
      ],
      enabled: true,
      label: "Sabores",
      mode: "assorted",
      totalUnits: 6,
    });
  });

  it("suma distinta del total: no envía, abre «Más opciones», avisa y enfoca el total, sin peticiones", async () => {
    const api = installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(moreOptionsToggle());
    await replaceText(user, unitsField(1), "3");
    await submitWithSectionClosed(user);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(totalField()).toHaveFocus();
    expect(totalField()).toHaveAttribute("aria-invalid", "true");
    expect(totalField()).toHaveAccessibleDescription(
      "Los productos suman 7 unidades y el empaque declara 6.",
    );
    expect(screen.getByText("Suma: 7 de 6 unidades — sobran 1")).toBeVisible();
    expect(api.posts).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();

    // Corregido, se envía.
    await replaceText(user, totalField(), "7");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].packConversion).toMatchObject({ totalUnits: 7 });
  });

  it("fila sin producto: no envía y enfoca su buscador con el aviso", async () => {
    installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(moreOptionsToggle());
    await user.click(screen.getByRole("button", { name: "Limpiar Producto 2" }));
    await submitWithSectionClosed(user);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(productField(2)).toHaveFocus();
    expect(productField(2)).toHaveAccessibleDescription("Elige un producto o quita la fila.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("unidades vacías: no envía y enfoca las unidades de la fila", async () => {
    installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(moreOptionsToggle());
    await user.clear(unitsField(3));
    await submitWithSectionClosed(user);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(unitsField(3)).toHaveFocus();
    expect(unitsField(3)).toHaveAccessibleDescription("Indica las unidades (mínimo 1).");
  });

  it("menos de 2 productos: no envía, avisa y enfoca «Añadir producto»", async () => {
    installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(moreOptionsToggle());
    await user.click(screen.getByRole("button", { name: "Quitar producto 3" }));
    await user.click(screen.getByRole("button", { name: "Quitar producto 2" }));
    await replaceText(user, unitsField(1), "6");
    await submitWithSectionClosed(user);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Un empaque surtido lleva al menos 2 productos.",
    );
    expect(screen.getByRole("button", { name: "Añadir producto" })).toHaveFocus();
  });

  it("peso de costo que no vale: no envía, abre «Avanzado» y enfoca el peso", async () => {
    installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(moreOptionsToggle());
    await user.click(screen.getByRole("button", { name: /Avanzado/ }));
    await replaceText(user, screen.getByLabelText("Peso de costo de Cola"), "0");
    await user.click(screen.getByRole("button", { name: /Avanzado/ }));
    await submitWithSectionClosed(user);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Peso de costo de Cola")).toHaveFocus();
    expect(screen.getByLabelText("Peso de costo de Cola")).toHaveAccessibleDescription(
      "El peso debe ser mayor que 0.",
    );
  });

  it("el componente inactivo se ve marcado y no impide guardar", async () => {
    installApi();
    const { onSubmit, user } = renderEdit();

    await user.click(moreOptionsToggle());

    expect(productField(2)).toHaveValue("Manzana");
    expect(productField(2)).toHaveAccessibleDescription(
      "Inactivo: el empaque se puede guardar y vender igual.",
    );

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe("ProductFormModal · crear producto unidad desde el surtido (PRO-13)", () => {
  async function openAssortedCreate(user: UserSession) {
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Refrescos sabores x6");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("6");
    await user.click(moreOptionsToggle());
    await user.click(screen.getByLabelText("Se puede vender por unidad"));
    await user.selectOptions(screen.getByLabelText("Modo de vínculo"), "assorted");
  }

  function createUnitButton() {
    return screen.getByRole("button", { name: "Crear producto unidad" });
  }

  function unitDialog() {
    return screen.getByRole("dialog", { name: "Nuevo producto" });
  }

  it("crea el producto, lo añade a la receta con el foco en sus unidades y no envía el empaque", async () => {
    const api = installApi();
    const { onOpenChange, onSubmit, user } = renderForm();

    await openAssortedCreate(user);
    await user.click(createUnitButton());

    const dialog = within(unitDialog());

    // Alta compacta: sin "Más opciones", así que no hay surtido dentro del surtido.
    expect(dialog.queryByRole("button", { name: /Más opciones/ })).not.toBeInTheDocument();

    await user.click(dialog.getByLabelText("Nombre"));
    await user.paste("Uva");
    await user.selectOptions(dialog.getByLabelText("Categoría"), "cat-1");
    await user.click(dialog.getByLabelText("Precio REF"));
    await user.paste("1");
    api.respondToNextPost({ data: createdUnit });
    await user.click(dialog.getByRole("button", { name: "Crear producto" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Nuevo producto" })).not.toBeInTheDocument(),
    );

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0].url).toBe("/api/products");
    expect(api.posts[0].body).toMatchObject({ name: "Uva", salePriceRef: 1 });
    expect(api.posts[0].body).not.toHaveProperty("packConversion");
    // El empaque sigue abierto, con lo escrito y sin enviarse.
    expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Refrescos sabores x6");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Ocupa la primera fila vacía y el foco queda en sus unidades.
    expect(productField(1)).toHaveValue("Uva");
    expect(productField(2)).toHaveValue("");
    expect(unitsField(1)).toHaveFocus();
  });

  it("con todas las filas ocupadas, el producto creado entra en una fila nueva", async () => {
    const api = installApi();
    const { user } = renderForm({ mode: "edit", product: assortedPackProduct });

    await user.click(moreOptionsToggle());
    await user.click(createUnitButton());

    const dialog = within(unitDialog());

    await user.click(dialog.getByLabelText("Nombre"));
    await user.paste("Uva");
    await user.selectOptions(dialog.getByLabelText("Categoría"), "cat-1");
    await user.click(dialog.getByLabelText("Precio REF"));
    await user.paste("1");
    api.respondToNextPost({ data: createdUnit });
    await user.click(dialog.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(productField(4)).toHaveValue("Uva"));
    expect(unitsField(4)).toHaveFocus();
    expect(productField(1)).toHaveValue("Cola");
  });

  it("si el servidor rechaza el alta, el motivo se ve en el alta y la receta no cambia", async () => {
    const api = installApi();
    const { onSubmit, user } = renderForm();

    await openAssortedCreate(user);
    await user.click(createUnitButton());

    const dialog = within(unitDialog());

    await user.click(dialog.getByLabelText("Nombre"));
    await user.paste("Uva");
    await user.selectOptions(dialog.getByLabelText("Categoría"), "cat-1");
    await user.click(dialog.getByLabelText("Precio REF"));
    await user.paste("1");
    api.respondToNextPost(
      { error: { code: "CONFLICT", message: "Ya existe un producto con ese código." } },
      409,
    );
    await user.click(dialog.getByRole("button", { name: "Crear producto" }));

    expect(await dialog.findByText("Ya existe un producto con ese código.")).toBeVisible();
    expect(productField(1)).toHaveValue("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Cancelar"])(
    "cerrar el alta con %s deja abierto el empaque, sin crear nada y con el foco en el disparador",
    async (how) => {
      const api = installApi();
      const { onOpenChange, user } = renderForm();

      await openAssortedCreate(user);
      await user.click(createUnitButton());

      const dialog = within(unitDialog());

      await user.click(dialog.getByLabelText("Nombre"));
      await user.paste("A medias");

      if (how === "Escape") {
        await user.keyboard("{Escape}");
      } else {
        await user.click(dialog.getByRole("button", { name: how }));
      }

      // CNF-15: lo tecleado no se guardó; cerrar pregunta antes y se confirma la salida.
      await user.click(
        within(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).getByRole("button", {
          name: "Salir",
        }),
      );

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Nuevo producto" })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();
      expect(screen.getByLabelText("Nombre")).toHaveValue("Refrescos sabores x6");
      expect(createUnitButton()).toHaveFocus();
      expect(productField(1)).toHaveValue("");
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(api.posts).toHaveLength(0);
    },
  );
});
