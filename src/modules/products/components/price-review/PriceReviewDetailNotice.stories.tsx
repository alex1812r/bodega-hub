import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { PriceReviewBadge } from "./PriceReviewBadge";
import { PriceReviewBulkBar } from "./PriceReviewBulkBar";
import { PriceReviewDetailNotice } from "./PriceReviewDetailNotice";
import { PriceReviewRepriceResult } from "./PriceReviewRepriceResult";

const review = {
  currentBand: "low",
  currentCostRef: 9,
  currentMarginPct: 11.11,
  previousBand: "high",
  previousCostRef: 8,
  previousMarginPct: 25,
  purchase: {
    id: "pur-7",
    number: "C-20261001-000007",
    receivedAt: "2026-10-01T15:00:00.000Z",
    supplierName: "Distribuidora Ñandú",
  },
  snapshotAt: "2026-09-20T10:00:00.000Z",
} as const;

/**
 * Piezas de la cola "Por revisar" (PRO-11): un producto entra cuando su costo
 * sube y la ganancia baja de banda. Es una alerta, nunca un bloqueo, y ningún
 * precio cambia sin confirmación.
 *
 * - `PriceReviewDetailNotice`: aviso del detalle del producto.
 * - `PriceReviewBadge`: aviso de la fila de la lista.
 * - `PriceReviewBulkBar` + `PriceReviewRepriceResult`: acción masiva de la lista.
 */
const meta = {
  args: {
    canManage: true,
    onKeepPrice: fn(),
    onReprice: fn(),
    review,
  },
  component: PriceReviewDetailNotice,
  tags: ["ai-generated"],
  title: "Modules/Products/PriceReview",
} satisfies Meta<typeof PriceReviewDetailNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DetailNotice: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "C-20261001-000007" })).toHaveAttribute(
      "href",
      "/purchases/pur-7",
    );
  },
};

export const DetailNoticeReadOnly: Story = {
  args: { canManage: false, review: { ...review, purchase: undefined } },
};

export const ListPieces: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-4">
      <PriceReviewBadge review={review} />
      <PriceReviewBulkBar
        chips={[12, 20, 30]}
        onReprice={fn()}
        onTogglePage={fn()}
        pageCount={10}
        selectedCount={3}
      />
      <PriceReviewBulkBar
        chips={[12, 20, 30]}
        onReprice={fn()}
        onTogglePage={fn()}
        pageCount={120}
        selectedCount={103}
      />
      <PriceReviewRepriceResult
        onDismiss={fn()}
        productNames={{ "p-sal": "Sal marina" }}
        result={{
          failed: 1,
          results: [
            { productId: "p-arroz", salePriceRef: 11.7, status: "ok" },
            { code: "NO_COST", message: "Sin costo", productId: "p-sal", status: "error" },
          ],
          updated: 1,
        }}
      />
    </div>
  ),
};
