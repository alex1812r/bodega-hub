/**
 * PRO-09 · el formulario de producto usa los chips de % y el semáforo
 * configurados en la tienda (`GET /api/settings/pricing`) y ofrece primero el %
 * sugerido de la categoría elegida. Sin configuración (cargando, error o 403)
 * valen los valores por defecto.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiData,
  apiError,
  createSettingsWrapper,
  installApi,
} from "@/modules/settings/settings-list/settingsApi.testUtils";
import { MARGIN_BADGE_TITLE } from "@/shared/components/MarginBadge";
import type { CategoryMock, PricingSettingsMock } from "@/shared/mocks/erp-data";

import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

const STORE_PRICING: PricingSettingsMock = { chipsPct: [10, 40], greenFromPct: 18, yellowFromPct: 8 };

const drinks: CategoryMock = {
  defaultMarkupPct: 18,
  id: "cat-drinks",
  isActive: true,
  name: "Bebidas",
  taxRate: 16,
  taxRateId: "tax-general",
};

const snacks: CategoryMock = {
  defaultMarkupPct: 40,
  id: "cat-snacks",
  isActive: true,
  name: "Chucherías",
  taxRate: 16,
  taxRateId: "tax-general",
};

const plain: CategoryMock = {
  id: "cat-plain",
  isActive: true,
  name: "Varios",
  taxRate: 16,
  taxRateId: "tax-general",
};

const created: CategoryMock = {
  defaultMarkupPct: 33,
  id: "cat-new",
  isActive: true,
  name: "Licores",
  taxRate: 16,
  taxRateId: "tax-general",
};

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

/** `pricing: null` = la consulta de ajustes responde 403 (p. ej. un rol sin permiso). */
function installServer(pricing: PricingSettingsMock | null = STORE_PRICING) {
  return installApi(({ method, url }) => {
    if (url === "/api/settings/pricing") {
      return pricing ? apiData(pricing) : apiError("No tienes permiso.", 403);
    }

    if (url.startsWith("/api/tax-rates")) {
      return apiData({ items: taxRates });
    }

    if (url === "/api/categories" && method === "POST") {
      return apiData(created, 201);
    }

    return apiData({ items: [], limit: 100, skip: 0, total: 0 });
  });
}

function renderForm(props: Partial<ProductFormModalProps> = {}) {
  const user = userEvent.setup({ delay: null });

  render(
    <ProductFormModal
      categories={[drinks, snacks, plain]}
      initialValues={{ currentCostRef: 10, salePriceRef: 12 }}
      onOpenChange={jest.fn()}
      open
      {...props}
    />,
    { wrapper: createSettingsWrapper() },
  );

  return user;
}

function chipTexts() {
  return within(screen.getByRole("group", { name: "Porcentajes de ganancia recomendados" }))
    .getAllByRole("button")
    .map((chip) => chip.textContent)
    .filter((text) => text !== "Otro %");
}

function pricingRequests(api: ReturnType<typeof installServer>) {
  return api.calls.filter((call) => call.url === "/api/settings/pricing");
}

async function chooseCategory(user: ReturnType<typeof userEvent.setup>, categoryId: string) {
  await user.selectOptions(screen.getByLabelText("Categoría"), categoryId);
}

describe("ProductFormModal · chips y semáforo de la tienda (PRO-09)", () => {
  it.each([
    ["completo", false],
    ["compact", true],
  ])("modo %s: ofrece los chips configurados y pinta el semáforo con sus umbrales", async (_label, compact) => {
    installServer();
    renderForm({ compact });

    await waitFor(() => expect(chipTexts()).toEqual(["10 %", "40 %"]));

    // Costo 10 y precio 12 = 20 %: verde porque la tienda fija el verde en 18 %.
    const badge = screen.getByTitle(MARGIN_BADGE_TITLE);

    expect(badge).toHaveTextContent("20 %");
    expect(badge).toHaveAttribute("data-band", "high");
  });

  it.each([
    ["completo", false],
    ["compact", true],
  ])(
    "modo %s: el % sugerido de la categoría va primero y cambia al cambiar de categoría",
    async (_label, compact) => {
      const api = installServer();
      const user = renderForm({ compact });

      await waitFor(() => expect(chipTexts()).toEqual(["10 %", "40 %"]));

      await chooseCategory(user, "cat-drinks");

      expect(chipTexts()).toEqual(["Sugerido 18 %", "10 %", "40 %"]);
      // Ofrecerlo no mueve el precio.
      expect(screen.getByLabelText("Precio REF")).toHaveValue("12");

      // El sugerido coincide con un chip de la tienda: no se repite.
      await chooseCategory(user, "cat-snacks");

      expect(chipTexts()).toEqual(["Sugerido 40 %", "10 %"]);

      await chooseCategory(user, "cat-plain");

      expect(chipTexts()).toEqual(["10 %", "40 %"]);
      expect(screen.getByLabelText("Precio REF")).toHaveValue("12");
      // Una sola consulta de ajustes, cacheada, por muchas categorías que se prueben.
      expect(pricingRequests(api)).toHaveLength(1);
    },
  );

  it("una categoría recién creada desde el formulario también aporta su % sugerido", async () => {
    installServer();

    const user = renderForm();

    await waitFor(() => expect(chipTexts()).toEqual(["10 %", "40 %"]));
    await user.click(screen.getByRole("button", { name: "+ Nueva categoría" }));

    const dialog = within(screen.getByRole("dialog", { name: "Nueva categoría" }));

    await dialog.findByRole("button", { name: /Alícuota de IVA/ });
    await user.click(dialog.getByLabelText("Nombre"));
    await user.paste("Licores");
    await user.click(dialog.getByRole("button", { name: "Crear categoría" }));

    await waitFor(() => expect(screen.getByLabelText("Categoría")).toHaveValue("cat-new"));
    expect(chipTexts()).toEqual(["Sugerido 33 %", "10 %", "40 %"]);
  });

  it("en edición usa el % de la categoría del producto aunque no venga en la lista", async () => {
    installServer();
    renderForm({
      categories: [plain],
      initialValues: undefined,
      mode: "edit",
      product: {
        category: drinks,
        categoryId: "cat-drinks",
        currentCostRef: 10,
        currentStock: 3,
        id: "prod-1",
        isActive: true,
        minStock: 0,
        name: "Malta",
        salePriceRef: 12,
        sku: "malta",
      } as ProductFormModalProps["product"],
    });

    await waitFor(() => expect(chipTexts()).toEqual(["Sugerido 18 %", "10 %", "40 %"]));
  });

  it("las props pricingChips y suggestedMarkupPct mandan sobre la tienda y la categoría", async () => {
    const api = installServer();
    const user = renderForm({ pricingChips: [5, 15], suggestedMarkupPct: 7 });

    await waitFor(() => expect(pricingRequests(api)).toHaveLength(1));
    await chooseCategory(user, "cat-drinks");

    expect(chipTexts()).toEqual(["Sugerido 7 %", "5 %", "15 %"]);
    // El semáforo sigue siendo el de la tienda.
    await waitFor(() =>
      expect(screen.getByTitle(MARGIN_BADGE_TITLE)).toHaveAttribute("data-band", "high"),
    );
  });

  it("si los ajustes no cargan (403) usa los valores por defecto y el formulario sigue funcionando", async () => {
    const api = installServer(null);
    const onSubmit = jest.fn();
    const user = renderForm({ onSubmit });

    await waitFor(() => expect(pricingRequests(api)).toHaveLength(1));

    expect(chipTexts()).toEqual(["12 %", "20 %", "30 %"]);
    // 20 % con los cortes por defecto (15 / 25) es amarillo.
    expect(screen.getByTitle(MARGIN_BADGE_TITLE)).toHaveAttribute("data-band", "mid");

    await chooseCategory(user, "cat-drinks");

    expect(chipTexts()).toEqual(["Sugerido 18 %", "12 %", "20 %", "30 %"]);

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      categoryId: "cat-drinks",
      currentCostRef: 10,
      name: "Harina",
      salePriceRef: 13,
    });
  });
});
