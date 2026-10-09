import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { userEvent, within } from "storybook/test";

import type { PackConversionListItem } from "../../hooks/useInventory";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

/**
 * Convertir empaque en unidades.
 *
 * - Empaque 1 a 1: cantidad y "Continuar", que abre la confirmación con las dos
 *   caras (−N empaques y +N × u unidades, cada una con su stock antes → después)
 *   y el motivo (CNF-08).
 * - Empaque surtido: tras elegir empaque y cantidad aparece el reparto (una fila
 *   por componente, precargada con receta × empaques). La suma debe coincidir
 *   con el total para poder continuar; "Restablecer receta" vuelve a la receta.
 *   "Continuar" abre la confirmación con lo que sale del empaque, lo que entra a
 *   cada producto y el stock resultante de cada uno.
 *
 * Estas historias simulan `GET /api/inventory/pack-conversions` y
 * `POST /api/inventory/conversions` con MSW.
 */
const meta = {
  component: InventoryPackConversionModal,
  // El guardia de datos tecleados (CNF-15) usa `useRouter` de `next/navigation`: necesita el App Router simulado.
  parameters: { nextjs: { appDirectory: true } },
  tags: ["ai-generated"],
  title: "Modules/Inventory/InventoryPackConversionModal",
} satisfies Meta<typeof InventoryPackConversionModal>;

export default meta;
type Story = StoryObj<typeof meta>;

function product(id: string, name: string, sku: string, currentStock: number) {
  return { currentCostRef: 1, currentStock, id, name, salePriceRef: 2, sku };
}

function component(
  unitProductId: string,
  name: string,
  sku: string,
  currentStock: number,
  isActive = true,
) {
  return { costWeight: 1, currentStock, isActive, name, sku, unitProductId, unitsPerPack: 2 };
}

const recipes: PackConversionListItem[] = [
  {
    components: [{ ...component("prod-cigar-unit", "Cigarro suelto", "CIG-UNI-001", 3), unitsPerPack: 10 }],
    id: "ppc-cigars",
    kind: "single",
    label: null,
    linkedProduct: product("prod-cigar-unit", "Cigarro suelto", "CIG-UNI-001", 3),
    packProduct: product("prod-cigar-pack", "Caja cigarros (x10)", "CIG-CAJ-010", 5),
    role: "pack",
    sources: [],
    totalUnits: 10,
    unitsPerPack: 10,
  },
  {
    components: [
      component("prod-cola", "Refresco Cola 355 ml", "REF-COL-355", 12),
      component("prod-manzana", "Refresco Manzana 355 ml", "REF-MAN-355", 0),
      component("prod-naranja", "Refresco Naranja 355 ml", "REF-NAR-355", 5, false),
    ],
    id: "ppc-surtido",
    kind: "assorted",
    label: "Sabores surtidos",
    linkedProduct: product("prod-cola", "Refresco Cola 355 ml", "REF-COL-355", 12),
    packProduct: product("prod-surtido", "Refrescos sabores surtidos (x6)", "REF-SUR-006", 9),
    role: "pack",
    sources: [],
    totalUnits: 6,
    unitsPerPack: 6,
  },
];

const recipesHandler = http.get("/api/inventory/pack-conversions", () =>
  HttpResponse.json({ data: recipes }),
);

type ConversionBody = {
  components?: { unitProductId: string; units: number }[];
  packProductId: string;
  packQuantity: number;
};

const openedHandler = http.post("/api/inventory/conversions", async ({ request }) => {
  const body = (await request.json()) as ConversionBody;
  const recipe = recipes.find((item) => item.packProduct.id === body.packProductId);
  const components = (
    body.components ??
    (recipe?.components ?? []).map((item) => ({
      unitProductId: item.unitProductId,
      units: item.unitsPerPack * body.packQuantity,
    }))
  ).map((item) => ({
    ...item,
    isActive:
      recipe?.components?.find((candidate) => candidate.unitProductId === item.unitProductId)
        ?.isActive ?? true,
  }));

  return HttpResponse.json(
    {
      data: {
        components,
        conversionId: "conv-story",
        packQuantity: body.packQuantity,
        totalUnits: recipe?.totalUnits,
        unitQuantity: components.reduce((total, item) => total + item.units, 0),
        unitsPerPack: recipe?.unitsPerPack,
      },
    },
    { status: 201 },
  );
});

const rejectedHandler = http.post("/api/inventory/conversions", () =>
  HttpResponse.json(
    { error: { code: "CONFLICT", message: "Stock insuficiente de empaque" } },
    { status: 409 },
  ),
);

async function openModal(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "Convertir empaque" }));
}

/** Buscador de empaque vacío: busca entre los empaques con receta activa. */
export const Default: Story = {
  parameters: { msw: { handlers: [recipesHandler, openedHandler] } },
};

/**
 * Surtido precargado: reparto editable (el componente inactivo va marcado y con
 * aviso), suma contra el total y, al continuar, la confirmación con el efecto.
 */
export const AssortedPack: Story = {
  args: { defaultPackProductId: "prod-surtido" },
  parameters: { msw: { handlers: [recipesHandler, openedHandler] } },
  play: ({ canvasElement }) => openModal(canvasElement),
};

/** El servidor rechaza la apertura: el mensaje sale tal cual en la confirmación y se puede reintentar. */
export const AssortedPackRejected: Story = {
  args: { defaultPackProductId: "prod-surtido" },
  parameters: { msw: { handlers: [recipesHandler, rejectedHandler] } },
  play: ({ canvasElement }) => openModal(canvasElement),
};

/** Empaque 1 a 1: sin reparto; "Continuar" abre la confirmación con las dos caras. */
export const SinglePack: Story = {
  args: { defaultPackProductId: "prod-cigar-pack" },
  parameters: { msw: { handlers: [recipesHandler, openedHandler] } },
  play: ({ canvasElement }) => openModal(canvasElement),
};

/** Las recetas no cargan: error en español con "Reintentar", sin buscador ni envío. */
export const RecipesError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("/api/inventory/pack-conversions", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL_ERROR", message: "Ocurrio un error inesperado." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  play: ({ canvasElement }) => openModal(canvasElement),
};
