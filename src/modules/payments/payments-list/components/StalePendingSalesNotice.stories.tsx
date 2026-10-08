import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { http, HttpResponse } from "msw";
import { expect, within } from "storybook/test";

import type { OpenDocument } from "../../hooks/useOpenDocuments";
import { StalePendingSalesNotice } from "./StalePendingSalesNotice";

/**
 * Aviso de `/payments`: ventas que llevan `STALE_PENDING_SALE_DAYS` días o más en
 * `pendiente_pago`. Su mercancía sigue apartada del inventario hasta que se cobren
 * o se anulen, y nada las vence solas.
 *
 * - Cerrado por defecto: titular, total pendiente (REF · Bs) y la explicación.
 * - Desplegado: una fila por venta con «Cobrar» (`RegisterPaymentModal`) y
 *   «Ver venta» (detalle con `returnTo` a la lista; allí está «Anular»).
 * - Sin permiso (`payments.manage` o `sales.create`), cargando, con error o sin
 *   ventas no pinta nada.
 *
 * Estas historias simulan `GET /api/payments/open-documents` con MSW.
 */
const meta = {
  args: { listHref: "/payments?method=transferencia" },
  component: StalePendingSalesNotice,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/payments" } },
  },
  tags: ["ai-generated"],
} satisfies Meta<typeof StalePendingSalesNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function staleSale(index: number): OpenDocument {
  const pendingRef = 12.5 + index * 3;

  return {
    contact: {
      id: `cont-${index}`,
      name:
        index % 4 === 0
          ? "Inversiones y Distribuciones La Gran Parada del Este, C.A."
          : `Cliente ${index + 1}`,
    },
    createdAt: new Date(Date.now() - (40 - index) * MS_PER_DAY).toISOString(),
    id: `sale-${index}`,
    number: `V-${String(index + 1).padStart(6, "0")}`,
    paidVes: 0,
    pendingRef,
    pendingVes: pendingRef * 510,
    refRateVes: 510,
    status: "pendiente_pago",
    totalRef: pendingRef,
    totalVes: pendingRef * 510,
    type: "sale",
  };
}

function staleSalesHandler(loaded: number, total = loaded) {
  const all = Array.from({ length: total }, (_unused, index) => staleSale(index));

  return http.get("/api/payments/open-documents", () =>
    HttpResponse.json({
      data: {
        items: all.slice(0, loaded),
        limit: 50,
        skip: 0,
        total,
        totals: {
          count: total,
          pendingRef: all.reduce((sum, sale) => sum + (sale.pendingRef ?? 0), 0),
          pendingVes: all.reduce((sum, sale) => sum + sale.pendingVes, 0),
          truncated: false,
        },
      },
    }),
  );
}

export const Collapsed: Story = {
  name: "Cerrado (por defecto)",
  parameters: { msw: { handlers: [staleSalesHandler(5)] } },
  play: async ({ canvasElement }) => {
    const notice = within(
      await within(canvasElement).findByRole("region", { name: "Ventas pendientes de pago" }),
    );

    await expect(
      notice.getByText("5 ventas llevan 7 días o más pendientes de pago"),
    ).toBeInTheDocument();
    await expect(notice.queryByRole("listitem")).not.toBeInTheDocument();
  },
};

export const Expanded: Story = {
  name: "Desplegado",
  parameters: { msw: { handlers: [staleSalesHandler(5)] } },
  play: async ({ canvasElement, userEvent }) => {
    const notice = within(
      await within(canvasElement).findByRole("region", { name: "Ventas pendientes de pago" }),
    );

    await userEvent.click(notice.getByRole("button", { name: "Ver las ventas" }));
    await expect(notice.getAllByRole("listitem")).toHaveLength(5);
    await expect(notice.getByRole("link", { name: "Ver venta V-000001" })).toBeInTheDocument();
  },
};

export const SingleSale: Story = {
  name: "Una sola venta",
  parameters: { msw: { handlers: [staleSalesHandler(1)] } },
};

export const MoreThanLoaded: Story = {
  name: "Más ventas que las cargadas",
  parameters: { msw: { handlers: [staleSalesHandler(50, 63)] } },
  play: async ({ canvasElement, userEvent }) => {
    const notice = within(
      await within(canvasElement).findByRole("region", { name: "Ventas pendientes de pago" }),
    );

    await userEvent.click(notice.getByRole("button", { name: "Ver las ventas" }));
    await expect(notice.getByText(/^y 13 más/)).toBeInTheDocument();
  },
};

export const NothingPending: Story = {
  name: "Sin ventas abandonadas (no pinta nada)",
  parameters: { msw: { handlers: [staleSalesHandler(0)] } },
};
