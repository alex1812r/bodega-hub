import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, within } from "storybook/test";

import {
  mockProductPackConversions,
  mockProducts,
  type ProductPackConversionSummary,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  createDefaultPackConversionFormState,
  type PackConversionFormState,
  ProductPackConversionFields,
} from "./ProductPackConversionFields";

/**
 * Campos de venta por unidad de un empaque. «Producto unidad» es un buscador en
 * servidor (nombre, SKU o código de barras): solo productos activos, nunca el
 * propio empaque, y los que ya tienen un vínculo de empaque salen deshabilitados
 * con su motivo. En modo «Surtido (varios productos)» el empaque se abre en
 * varios productos: ahí un producto que ya sale de otro empaque sí es elegible y
 * solo los empaques salen deshabilitados.
 *
 * Estas historias usan un `/api/products` simulado con MSW sobre los productos
 * de demostración (prueba «cig», «taladro» o «pintura»).
 */
const meta = {
  component: ProductPackConversionFields,
  tags: ["ai-generated"],
} satisfies Meta<typeof ProductPackConversionFields>;

export default meta;
type Story = StoryObj;

const linkedIds = new Set(
  mockProductPackConversions
    .filter((link) => link.isActive && link.storeId === DEFAULT_STORE_ID)
    .flatMap((link) => [link.packProductId, link.unitProductId]),
);

const packIds = new Set(
  mockProductPackConversions
    .filter((link) => link.isActive && link.storeId === DEFAULT_STORE_ID)
    .map((link) => link.packProductId),
);

function createProductsHandler(options: { fails?: boolean; latencyMs?: number } = {}) {
  return http.get("/api/products", async ({ request }) => {
    const params = new URL(request.url).searchParams;
    const barcode = params.get("barcode");
    const sku = params.get("sku")?.toLowerCase();
    const term = params.get("search")?.toLowerCase();
    const limit = Number(params.get("limit") ?? 10);

    await delay(options.latencyMs ?? 150);

    if (options.fails) {
      return HttpResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "No se pudo consultar los productos." } },
        { status: 500 },
      );
    }

    const matches = mockProducts.filter(
      (product) =>
        (product.storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID &&
        (params.get("isActive") !== "true" || product.isActive) &&
        (params.get("packLink") !== "none" || !linkedIds.has(product.id)) &&
        (params.get("packLink") !== "not-pack" || !packIds.has(product.id)) &&
        (barcode === null || product.barcode === barcode) &&
        (sku === undefined || product.sku === sku) &&
        (term === undefined ||
          [product.name, product.sku, product.barcode ?? ""].some((field) =>
            field.toLowerCase().includes(term),
          )),
    );

    return HttpResponse.json({
      data: { items: matches.slice(0, limit), limit, skip: 0, total: matches.length },
    });
  });
}

const linkedPack: ProductPackConversionSummary = {
  id: "ppc-cigars",
  linkedProduct: {
    currentCostRef: 1.25,
    currentStock: 3,
    id: "prod-cigar-unit",
    name: "Cigarro individual",
    salePriceRef: 2,
    sku: "cig-und-001",
  },
  role: "pack",
  unitsPerPack: 10,
};

const linkExistingState: PackConversionFormState = {
  ...createDefaultPackConversionFormState(),
  enabled: true,
  mode: "link_existing",
};

type DemoProps = {
  excludeProductId?: string;
  initialState: PackConversionFormState;
  isUnitRole?: boolean;
  packConversion?: ProductPackConversionSummary;
  showErrors?: boolean;
};

function Demo({
  excludeProductId,
  initialState,
  isUnitRole,
  packConversion,
  showErrors,
}: DemoProps) {
  const [state, setState] = useState(initialState);

  return (
    <div className="max-w-xl space-y-3">
      <ProductPackConversionFields
        excludeProductId={excludeProductId}
        isUnitRole={isUnitRole}
        onChange={(patch) => setState((current) => ({ ...current, ...patch }))}
        packConversion={packConversion}
        productName="Caja cigarros (x10)"
        showErrors={showErrors}
        state={state}
      />
      <p className="text-xs text-on-surface-variant">
        Producto unidad elegido: <span data-testid="unit-id">{state.unitProductId || "ninguno"}</span>
      </p>
    </div>
  );
}

export const CreateUnit: Story = {
  name: "Crear producto unidad",
  render: () => (
    <Demo initialState={{ ...createDefaultPackConversionFormState(), enabled: true }} />
  ),
};

export const LinkExisting: Story = {
  name: "Vincular producto existente",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => <Demo initialState={linkExistingState} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.type(canvas.getByRole("combobox", { name: /Producto unidad/ }), "taladro");
    await userEvent.click(await body.findByRole("option", { name: /Taladro percutor/ }));

    await expect(canvas.getByTestId("unit-id")).toHaveTextContent("prod-drill");
    await expect(canvas.getByRole("combobox", { name: /Producto unidad/ })).toHaveValue(
      "Taladro percutor",
    );
  },
};

export const AlreadyLinkedOptions: Story = {
  name: "Productos ya vinculados, deshabilitados",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => <Demo initialState={linkExistingState} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.type(canvas.getByRole("combobox", { name: /Producto unidad/ }), "ca");

    await expect(await body.findByRole("option", { name: /Cable THW 12/ })).toBeVisible();
    await expect(body.getByRole("option", { name: /Caja cigarros/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const EditLinkedPack: Story = {
  name: "Edición con unidad vinculada",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => (
    <Demo
      excludeProductId="prod-cigar-pack"
      initialState={createDefaultPackConversionFormState(linkedPack)}
      packConversion={linkedPack}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("combobox", { name: /Producto unidad/ })).toHaveValue(
      "Cigarro individual",
    );
  },
};

export const MissingUnit: Story = {
  name: "Enviado sin producto unidad",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => <Demo initialState={linkExistingState} showErrors />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("combobox", { name: /Producto unidad/ }),
    ).toHaveAccessibleDescription("Elige el producto unidad.");
  },
};

export const NoResults: Story = {
  name: "Sin resultados",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => <Demo initialState={linkExistingState} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /Producto unidad/ }), "zzz");

    await expect(
      await within(canvasElement.ownerDocument.body).findByText(/Sin resultados para/),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  name: "Cargando",
  parameters: { msw: { handlers: [createProductsHandler({ latencyMs: 60_000 })] } },
  render: () => <Demo initialState={linkExistingState} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /Producto unidad/ }), "taladro");

    await expect(
      await within(canvasElement.ownerDocument.body).findByText("Buscando..."),
    ).toBeVisible();
  },
};

export const SearchError: Story = {
  name: "Error de búsqueda",
  parameters: { msw: { handlers: [createProductsHandler({ fails: true })] } },
  render: () => <Demo initialState={linkExistingState} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.type(canvas.getByRole("combobox", { name: /Producto unidad/ }), "taladro");

    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("alert"),
    ).toHaveTextContent("No se pudo consultar los productos.");
  },
};

const assortedPack: ProductPackConversionSummary = {
  components: [
    {
      costWeight: 1,
      currentStock: 18,
      isActive: true,
      name: "Taladro percutor",
      sku: "her-tal-001",
      unitProductId: "prod-drill",
      unitsPerPack: 2,
    },
    {
      costWeight: 2,
      currentStock: 0,
      isActive: false,
      name: "Pintura latex azul",
      sku: "pin-lat-001",
      unitProductId: "prod-latex",
      unitsPerPack: 2,
    },
    {
      costWeight: 1,
      currentStock: 4,
      isActive: true,
      name: "Cable THW 12",
      sku: "ele-cab-001",
      unitProductId: "prod-cable",
      unitsPerPack: 2,
    },
  ],
  id: "ppc-assorted",
  kind: "assorted",
  label: "Kit surtido",
  linkedProduct: linkedPack.linkedProduct,
  role: "pack",
  sources: [],
  totalUnits: 6,
  unitsPerPack: 6,
};

export const Assorted: Story = {
  name: "Surtido: receta nueva",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => (
    <Demo
      initialState={{
        ...createDefaultPackConversionFormState(),
        enabled: true,
        mode: "assorted",
        unitsPerPack: "6",
      }}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.type(canvas.getByRole("combobox", { name: "Producto 1" }), "cig");

    // El empaque no puede salir de otro empaque; su unidad sí.
    await expect(await body.findByRole("option", { name: /Caja cigarros/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(body.getByRole("option", { name: /Cigarro individual/ }));
    await userEvent.type(canvas.getByLabelText("Unidades del producto 1"), "4");

    await expect(canvas.getByText("Suma: 4 de 6 unidades — faltan 2")).toBeVisible();
  },
};

export const AssortedEdit: Story = {
  name: "Surtido: edición con un componente inactivo",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => (
    <Demo
      excludeProductId="prod-cigar-pack"
      initialState={createDefaultPackConversionFormState(assortedPack)}
      packConversion={assortedPack}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("✓ 6 de 6 unidades")).toBeVisible();
    await expect(canvas.getByRole("combobox", { name: "Producto 2" })).toHaveAccessibleDescription(
      "Inactivo: el empaque se puede guardar y vender igual.",
    );
  },
};

export const AssortedInvalid: Story = {
  name: "Surtido: enviado con la suma incorrecta",
  parameters: { msw: { handlers: [createProductsHandler()] } },
  render: () => (
    <Demo
      excludeProductId="prod-cigar-pack"
      initialState={{ ...createDefaultPackConversionFormState(assortedPack), unitsPerPack: "8" }}
      packConversion={assortedPack}
      showErrors
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText(/Unidades por empaque/)).toHaveAccessibleDescription(
      "Los productos suman 6 unidades y el empaque declara 8.",
    );
  },
};

export const UnitOfSeveralPacks: Story = {
  name: "Producto que es unidad de varios empaques",
  render: () => (
    <Demo
      initialState={createDefaultPackConversionFormState()}
      isUnitRole
      packConversion={{
        ...linkedPack,
        linkedProduct: { ...linkedPack.linkedProduct, id: "prod-cigar-pack", name: "Caja cigarros (x10)" },
        role: "unit",
        sources: [
          {
            conversionId: "ppc-cigars",
            packName: "Caja cigarros (x10)",
            packProductId: "prod-cigar-pack",
            totalUnits: 10,
            unitsPerPack: 10,
          },
          {
            conversionId: "ppc-assorted",
            packName: "Kit surtido x6",
            packProductId: "prod-kit",
            totalUnits: 6,
            unitsPerPack: 2,
          },
        ],
      }}
    />
  ),
};

export const UnitRole: Story = {
  name: "Producto que es la unidad de un empaque",
  render: () => (
    <Demo
      initialState={createDefaultPackConversionFormState()}
      isUnitRole
      packConversion={{
        ...linkedPack,
        linkedProduct: { ...linkedPack.linkedProduct, id: "prod-cigar-pack", name: "Caja cigarros (x10)" },
        role: "unit",
      }}
    />
  ),
};
