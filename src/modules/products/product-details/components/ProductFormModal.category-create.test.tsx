import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { getPaginatedItems } from "@/lib/api/pagination";
import type { TaxRate } from "@/shared/hooks/useTaxRates";
import type { CategoryMock } from "@/shared/mocks/erp-data";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { useCategories } from "../../hooks/useProducts";
import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

/** PRO-02 · "+ Nueva categoría" junto al select de Categoría del formulario de producto. */

const mockGrantedPermissions = new Set<string>();

// El formulario lleva el guardia de cambios sin guardar (`useProcessGuard`), que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children, permission }: { children: React.ReactNode; permission: string }) =>
    mockGrantedPermissions.has(permission) ? children : null,
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type UserSession = ReturnType<typeof userEvent.setup>;

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

const taxRates = [
  buildRate({ code: "exento", label: "Exento", pct: 0 }),
  buildRate({ code: "reducida", label: "Reducida", pct: 8 }),
  buildRate({ code: "general", isDefault: true, label: "General", pct: 16 }),
];

const drinks: CategoryMock = {
  id: "cat-drinks",
  isActive: true,
  name: "Bebidas",
  taxRate: 16,
  taxRateId: "tax-general",
};

const snacks: CategoryMock = {
  id: "cat-snacks",
  isActive: true,
  name: "Chucherías",
  taxRate: 8,
  taxRateId: "tax-reducida",
};

/** `fetch` de prueba: el catálogo de alícuotas y la lista de categorías del servidor. */
function installApi() {
  const server = { categories: [drinks] };
  const gets: string[] = [];
  const api = installFetchStub((url) => {
    gets.push(url);

    if (url.startsWith("/api/tax-rates")) {
      return { items: taxRates };
    }

    return url.startsWith("/api/categories")
      ? { items: server.categories, limit: 100, skip: 0, total: server.categories.length }
      : { items: [], limit: 100, skip: 0, total: 0 };
  });

  return { ...api, gets, server };
}

type FormProps = Partial<ProductFormModalProps>;

/** La prop `categories` no cambia nunca: la categoría nueva no llega por ahí. */
function renderForm(props: FormProps = {}) {
  const user = userEvent.setup({ delay: null });

  render(<ProductFormModal categories={[drinks]} onOpenChange={jest.fn()} open {...props} />, {
    wrapper: createQueryWrapper(),
  });

  return user;
}

/** Como las páginas: las categorías vienen de la query que el alta invalida. */
function QueryHarness(props: FormProps) {
  const categories = useCategories();

  return (
    <ProductFormModal
      categories={getPaginatedItems(categories.data)}
      onOpenChange={jest.fn()}
      open
      {...props}
    />
  );
}

function createCategoryButton() {
  return screen.getByRole("button", { name: "+ Nueva categoría" });
}

function categoryDialog() {
  return screen.getByRole("dialog", { name: "Nueva categoría" });
}

async function openCategoryCreate(user: UserSession) {
  await user.click(createCategoryButton());

  const dialog = within(categoryDialog());

  // El chip aparece cuando llega el catálogo de alícuotas.
  await dialog.findByRole("button", { name: /Alícuota de IVA/ });

  return dialog;
}

async function fillCategoryName(user: UserSession, name: string) {
  await user.click(within(categoryDialog()).getByLabelText("Nombre"));
  await user.paste(name);
}

function productDialogName(compact = false) {
  return compact ? "Nuevo producto" : "Crear producto";
}

beforeEach(() => {
  mockGrantedPermissions.clear();
  mockGrantedPermissions.add("products.manage");
});

describe("ProductFormModal · + Nueva categoría (PRO-02)", () => {
  it.each([
    ["completo", false],
    ["compact", true],
  ])("modo %s: ofrece la acción junto al select de Categoría", (_label, compact) => {
    installApi();
    renderForm({ compact });

    expect(createCategoryButton()).toBeVisible();
    expect(createCategoryButton()).toHaveAttribute("type", "button");
    expect(screen.getByLabelText("Categoría")).toHaveValue("");
  });

  it("sin products.manage no hay acción y el select sigue funcionando", async () => {
    installApi();
    mockGrantedPermissions.clear();

    const user = renderForm();

    expect(screen.queryByRole("button", { name: "+ Nueva categoría" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Categoría"), "cat-drinks");

    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-drinks");
  });

  it.each([
    ["completo", false],
    ["compact", true],
  ])(
    "modo %s: crear la categoría la deja seleccionada, conserva lo escrito y no envía el producto",
    async (_label, compact) => {
      const api = installApi();
      const onOpenChange = jest.fn();
      const onSubmit = jest.fn();
      const user = renderForm({ compact, onOpenChange, onSubmit });

      await user.click(screen.getByLabelText("Nombre"));
      await user.paste("Chupeta");
      await user.click(screen.getByLabelText("Precio REF"));
      await user.paste("1.5");

      const dialog = await openCategoryCreate(user);

      // Abre con la alícuota por defecto de la tienda y sin Descripción.
      expect(dialog.getByRole("button", { name: /Alícuota de IVA/ })).toHaveAccessibleName(
        "Alícuota de IVA: IVA 16 %",
      );
      expect(dialog.queryByLabelText(/Descripción/)).not.toBeInTheDocument();
      expect(categoryDialog().querySelector('input[type="number"]')).toBeNull();

      await fillCategoryName(user, "Chucherías");
      await user.click(dialog.getByRole("button", { name: /Alícuota de IVA/ }));
      await user.click(screen.getByRole("radio", { name: /Reducida/ }));
      api.respondToNextPost({ data: snacks });
      await user.click(dialog.getByRole("button", { name: "Crear categoría" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Nueva categoría" })).not.toBeInTheDocument(),
      );
      expect(api.posts).toEqual([
        { body: { name: "Chucherías", taxRate: 8 }, url: "/api/categories" },
      ]);

      // Queda elegida aunque la prop `categories` no la traiga.
      const select = screen.getByLabelText("Categoría");

      expect(select).toHaveValue("cat-snacks");
      expect(within(select).getByRole("option", { name: "Chucherías" })).toBeInTheDocument();
      expect(screen.getByLabelText("Nombre")).toHaveValue("Chupeta");
      expect(screen.getByLabelText("Precio REF")).toHaveValue("1.5");
      expect(screen.getByRole("dialog", { name: productDialogName(compact) })).toBeInTheDocument();
      expect(createCategoryButton()).toHaveFocus();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);

      // Y viaja al guardar el producto.
      await user.click(screen.getByRole("button", { name: "Crear producto" }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        categoryId: "cat-snacks",
        name: "Chupeta",
        salePriceRef: 1.5,
      });
    },
  );

  it("al crear refresca la lista de categorías y no duplica la opción cuando llega", async () => {
    const api = installApi();
    const user = userEvent.setup({ delay: null });

    render(<QueryHarness />, { wrapper: createQueryWrapper() });
    await within(screen.getByLabelText("Categoría")).findByRole("option", { name: "Bebidas" });

    const listRequests = () => api.gets.filter((url) => url.startsWith("/api/categories"));
    const requestsBefore = listRequests().length;
    const dialog = await openCategoryCreate(user);

    await fillCategoryName(user, "Chucherías");
    api.server.categories = [drinks, snacks];
    api.respondToNextPost({ data: snacks });
    await user.click(dialog.getByRole("button", { name: "Crear categoría" }));

    await waitFor(() => expect(listRequests().length).toBeGreaterThan(requestsBefore));

    const select = screen.getByLabelText("Categoría");

    await waitFor(() => expect(select).toHaveValue("cat-snacks"));
    expect(within(select).getAllByRole("option", { name: "Chucherías" })).toHaveLength(1);
  });

  it("nombre duplicado: el mensaje del servidor queda en el mini-modal, que no se cierra", async () => {
    const api = installApi();
    const onSubmit = jest.fn();
    const user = renderForm({ onSubmit });
    const dialog = await openCategoryCreate(user);

    await fillCategoryName(user, "Bebidas");
    api.respondToNextPost(
      { error: { code: "CONFLICT", message: "Ya existe una categoría con ese nombre." } },
      409,
    );
    await user.click(dialog.getByRole("button", { name: "Crear categoría" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Ya existe una categoría con ese nombre.",
    );
    expect(categoryDialog()).toBeInTheDocument();
    expect(dialog.getByLabelText("Nombre")).toHaveValue("Bebidas");
    expect(screen.getByLabelText("Categoría", { selector: "select" })).toHaveValue("");
    expect(onSubmit).not.toHaveBeenCalled();

    // Corrige y reintenta desde el mismo mini-modal.
    await user.clear(dialog.getByLabelText("Nombre"));
    await fillCategoryName(user, "Chucherías");
    api.respondToNextPost({ data: snacks });
    await user.click(dialog.getByRole("button", { name: "Crear categoría" }));

    await waitFor(() => expect(screen.getByLabelText("Categoría")).toHaveValue("cat-snacks"));
    expect(api.posts).toHaveLength(2);
  });

  it("dos envíos del mini-modal en el mismo tick: una sola categoría", async () => {
    const api = installApi();
    const onSubmit = jest.fn();
    const user = renderForm({ onSubmit });

    // Con el producto listo para enviarse: un envío que burbujeara lo guardaría.
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Chupeta");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("1.5");
    await openCategoryCreate(user);
    await fillCategoryName(user, "Chucherías");

    const release = api.holdNextPost({ data: snacks });
    const form = categoryDialog().querySelector("form") as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(
      await within(categoryDialog()).findByRole("button", { name: "Guardando..." }),
    ).toBeDisabled();

    release();

    await waitFor(() => expect(screen.getByLabelText("Categoría")).toHaveValue("cat-snacks"));
    expect(api.posts).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Cancelar", "Cerrar modal"])(
    "modal sobre modal: cerrar con %s deja abierto el producto, sin crear nada y con el foco en el disparador",
    async (how) => {
      const api = installApi();
      const onOpenChange = jest.fn();
      const user = renderForm({ onOpenChange });

      await user.click(screen.getByLabelText("Nombre"));
      await user.paste("Chupeta");

      const dialog = await openCategoryCreate(user);

      await fillCategoryName(user, "A medias");

      if (how === "Escape") {
        await user.keyboard("{Escape}");
      } else {
        await user.click(dialog.getByRole("button", { name: how }));
      }

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Nueva categoría" })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();
      expect(screen.getByLabelText("Nombre")).toHaveValue("Chupeta");
      expect(createCategoryButton()).toHaveFocus();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(api.posts).toHaveLength(0);

      // Se puede volver a abrir, limpio.
      const reopened = await openCategoryCreate(user);

      expect(reopened.getByLabelText("Nombre")).toHaveValue("");
    },
  );

  it("en edición abre con la categoría del producto y también ofrece crear otra", async () => {
    installApi();
    renderForm({
      mode: "edit",
      product: {
        categoryId: "cat-drinks",
        currentStock: 3,
        id: "prod-1",
        isActive: true,
        minStock: 0,
        name: "Malta",
        salePriceRef: 1,
        sku: "malta",
      } as ProductFormModalProps["product"],
    });

    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-drinks");
    expect(createCategoryButton()).toBeVisible();
  });
});
