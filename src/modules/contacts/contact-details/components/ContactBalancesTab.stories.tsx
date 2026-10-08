import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, within } from "storybook/test";

import type { OpenDocument } from "@/modules/payments/hooks/useOpenDocuments";

import { ContactBalancesTab } from "./ContactBalancesTab";

/**
 * Pestaña "Saldos" del detalle de contacto: ventas por cobrar y/o compras por pagar.
 *
 * - `sections` decide qué se pinta y qué se pide al servidor; sale de
 *   `getContactBalanceSections(tipoDeContacto, { can, role })`.
 * - "Abonar" reparte un pago entre los documentos más antiguos (`ContactSettlementModal`).
 * - "Cobrar"/"Pagar" de una fila registra un pago de ese documento (`RegisterPaymentModal`).
 * - El número enlaza al detalle con `returnTo` a `returnHref`.
 * - Con un abono por confirmar guardado (y el modal cerrado) avisa en la sección, con
 *   "Revisar abono" para abrirlo.
 *
 * Estas historias simulan `GET /api/payments/open-documents` con MSW.
 */
const meta = {
  // Un abono sin terminar de una historia no debe reaparecer en la siguiente. Se
  // guarda por tienda y usuario: se borran los de cualquier sesión.
  beforeEach: () => {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith("bodegahub:abono-pendiente:")) {
        window.sessionStorage.removeItem(key);
      }
    }
  },
  args: {
    contactId: "cont-story",
    contactName: "Inversiones La Gran Parada del Este, C.A.",
    returnHref: "/contacts/cont-story",
    sections: ["sale"],
  },
  component: ContactBalancesTab,
  decorators: [
    (Story) => (
      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
        <Story />
      </div>
    ),
  ],
  tags: ["ai-generated"],
  title: "Modules/Contacts/ContactBalancesTab",
} satisfies Meta<typeof ContactBalancesTab>;

export default meta;
type Story = StoryObj<typeof meta>;

const sales: OpenDocument[] = Array.from({ length: 4 }, (_unused, index) => ({
  createdAt: new Date(Date.UTC(2026, 8, 1 + index * 4, 15, 10)).toISOString(),
  id: `sale-${index}`,
  number: `V-${String(index + 1).padStart(6, "0")}`,
  paidVes: index === 0 ? 2550 : 0,
  pendingRef: 12.5 + index - (index === 0 ? 5 : 0),
  pendingVes: (12.5 + index) * 510 - (index === 0 ? 2550 : 0),
  refRateVes: 510,
  status: "pendiente_pago",
  totalRef: 12.5 + index,
  totalVes: (12.5 + index) * 510,
  type: "sale",
}));

const purchases: OpenDocument[] = [
  {
    createdAt: "2026-09-20T15:10:00.000Z",
    id: "purchase-story",
    number: "C-000128",
    paidRef: 10.4,
    paidVes: 5200,
    pendingRef: 30,
    pendingVes: 15000,
    refRateVes: 500,
    status: "recibido",
    totalRef: 40.4,
    totalVes: 20200,
    type: "purchase",
  },
];

function openDocumentsHandler({
  empty = false,
  truncated = false,
}: { empty?: boolean; truncated?: boolean } = {}) {
  return http.get("/api/payments/open-documents", async ({ request }) => {
    const type = new URL(request.url).searchParams.get("type");
    const items = empty ? [] : type === "purchase" ? purchases : sales;

    await delay(250);

    return HttpResponse.json({
      data: {
        items,
        limit: 100,
        skip: 0,
        total: items.length,
        totals: {
          count: items.length,
          pendingRef: items.reduce((sum, item) => sum + (item.pendingRef ?? 0), 0),
          pendingVes: items.reduce((sum, item) => sum + item.pendingVes, 0),
          truncated,
        },
      },
    });
  });
}

const supportHandlers = [
  http.get("/api/settings/payment-methods", () =>
    HttpResponse.json({
      data: { enabledPaymentMethods: ["efectivo_ves", "efectivo_usd", "pago_movil"] },
    }),
  ),
  http.get("/api/exchange-rates/current", () =>
    HttpResponse.json({ data: { id: "rate-story", rateVes: 510, source: "BCV" } }),
  ),
];

export const Customer: Story = {
  name: "Cliente: por cobrar",
  parameters: { msw: { handlers: [openDocumentsHandler(), ...supportHandlers] } },
  play: async ({ canvasElement }) => {
    const section = within(
      await within(canvasElement).findByRole("region", { name: "Por cobrar" }),
    );

    await expect(await section.findByRole("link", { name: "V-000001" })).toHaveAttribute(
      "href",
      "/sales/sale-0?returnTo=%2Fcontacts%2Fcont-story",
    );
    await expect(section.getByRole("button", { name: "Abonar" })).toBeInTheDocument();
  },
};

export const Supplier: Story = {
  args: { sections: ["purchase"] },
  name: "Proveedor: por pagar",
  parameters: { msw: { handlers: [openDocumentsHandler(), ...supportHandlers] } },
};

export const Both: Story = {
  args: { sections: ["sale", "purchase"] },
  name: "Cliente y proveedor",
  parameters: { msw: { handlers: [openDocumentsHandler(), ...supportHandlers] } },
};

export const SettleFromSection: Story = {
  name: "Abonar abre el modal de abono",
  parameters: { msw: { handlers: [openDocumentsHandler(), ...supportHandlers] } },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: "Abonar" }));
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Abonar" }),
    ).toBeInTheDocument();
  },
};

export const Empty: Story = {
  name: "Sin saldos pendientes",
  parameters: { msw: { handlers: [openDocumentsHandler({ empty: true }), ...supportHandlers] } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Sin saldos pendientes"),
    ).toBeInTheDocument();
  },
};

export const Truncated: Story = {
  name: "Lectura truncada",
  parameters: {
    msw: { handlers: [openDocumentsHandler({ truncated: true }), ...supportHandlers] },
  },
};

export const LoadError: Story = {
  name: "Error con reintento",
  parameters: {
    msw: {
      handlers: [
        http.get("/api/payments/open-documents", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL", message: "No se pudo leer los saldos." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: "Reintentar" }),
    ).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  args: { sections: ["sale", "purchase"] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "390 px: tarjetas",
  parameters: {
    msw: { handlers: [openDocumentsHandler(), ...supportHandlers] },
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
