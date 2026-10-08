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
 * con su motivo.
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
