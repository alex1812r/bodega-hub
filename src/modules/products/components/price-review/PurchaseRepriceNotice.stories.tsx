import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";

import type { ProductPriceReviewItem } from "../../hooks/usePriceReview";
import { PurchaseRepriceNotice } from "./PurchaseRepriceNotice";

const PURCHASE = {
  id: "purchase-001",
  number: "C-000123",
  receivedAt: "2026-10-07T12:00:00.000Z",
  supplierName: "Distribuidora Polar",
};

function reviewItem(index: number, overrides: Partial<ProductPriceReviewItem> = {}): ProductPriceReviewItem {
  return {
    currentBand: "low",
    currentCostRef: 9,
    currentMarginPct: 11.111111,
    name: `Harina PAN 1 kg (${index})`,
    previousBand: "high",
    previousCostRef: 8,
    previousMarginPct: 25,
    productId: `prod-${index}`,
    purchase: PURCHASE,
    salePriceRef: 10,
    sku: `harina-pan-${index}`,
    snapshotAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

/**
 * La cola vive en el handler: "Aplicar" y "Mantener precio" retiran la fila de
 * verdad. Las dos acciones confirman antes: "Mantener precio" con el mismo modal
 * que la lista y el detalle del producto.
 */
function queueHandlers(initial: ProductPriceReviewItem[], failing = false) {
  let items = [...initial];

  const resolve = ({ params }: { params: Record<string, unknown> }) => {
    if (failing) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "El producto está inactivo: reactívalo para cambiar su precio." } },
        { status: 409 },
      );
    }

    items = items.filter((item) => item.productId !== params.id);

    return HttpResponse.json({ data: {} });
  };

  return [
    http.get("/api/products/price-review", () =>
      HttpResponse.json({ data: { items, limit: 100, skip: 0, total: items.length } }),
    ),
    // Cortes del semáforo de la tienda: 25 % verde, 19 % amarillo, 11 % rojo.
    http.get("/api/settings/pricing", () =>
      HttpResponse.json({ data: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 } }),
    ),
    // Tasa vigente: la confirmación de "Aplicar" muestra el cambio también en Bs (CNF-07).
    http.get("/api/exchange-rates/current", () => HttpResponse.json({ data: { rateVes: 40 } })),
    // Relectura del producto tras un 409 de "Mantener precio": sigue en la cola.
    http.get("/api/products/:id", ({ params }) => {
      const item = items.find((candidate) => candidate.productId === params.id);

      return item
        ? HttpResponse.json({
            data: {
              currentCostRef: item.currentCostRef,
              id: item.productId,
              priceReview: { currentCostRef: item.currentCostRef },
              salePriceRef: item.salePriceRef,
            },
          })
        : HttpResponse.json({ error: { code: "NOT_FOUND", message: "Producto no encontrado." } }, { status: 404 });
    }),
    http.post("/api/products/:id/price", resolve),
    http.post("/api/products/:id/keep-price", resolve),
  ];
}

const meta = {
  args: { purchaseId: PURCHASE.id },
  component: PurchaseRepriceNotice,
  parameters: { layout: "padded" },
  tags: ["ai-generated"],
  title: "Modules/Products/PriceReview/PurchaseRepriceNotice",
} satisfies Meta<typeof PurchaseRepriceNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** El ejemplo del plan: costo ref 8.00 → ref 9.00, PVP ref 10.00, 25 % → 11,11 %, reprecio ref 11.25. */
export const OneProduct: Story = {
  parameters: { msw: { handlers: queueHandlers([reviewItem(1, { name: "Harina PAN 1 kg" })]) } },
};

export const SeveralProducts: Story = {
  parameters: {
    msw: {
      handlers: queueHandlers([
        reviewItem(1, { name: "Harina PAN 1 kg" }),
        reviewItem(2, {
          currentBand: "mid",
          currentCostRef: 4.2,
          currentMarginPct: 19.047619,
          name: "Aceite de girasol Mazeite 1 L, botella plástica retornable",
          previousCostRef: 3.8,
          previousMarginPct: 31.578947,
          salePriceRef: 5,
        }),
      ]),
    },
  },
};

/** Caos: 40 productos a la vez. Diez visibles, "Mostrar 30 más" y enlace a Productos. */
export const FortyProducts: Story = {
  parameters: {
    msw: { handlers: queueHandlers(Array.from({ length: 40 }, (_, index) => reviewItem(index + 1))) },
  },
};

/** El servidor rechaza la acción: el error se lee en su confirmación y las demás filas siguen operables. */
export const ServerError: Story = {
  parameters: { msw: { handlers: queueHandlers([reviewItem(1), reviewItem(2)], true) } },
};

/** Sin filas el aviso no pinta nada. */
export const Empty: Story = {
  parameters: { msw: { handlers: queueHandlers([]) } },
};

export const Mobile390: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  parameters: {
    msw: { handlers: queueHandlers([reviewItem(1, { name: "Harina PAN 1 kg" }), reviewItem(2)]) },
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
          type: "mobile",
        },
      },
    },
  },
};
