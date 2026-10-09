import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { expect, within } from "storybook/test";

import { Button } from "@/shared/components/Button";

import type { OpenDocument } from "../hooks/useOpenDocuments";
import { PaymentDocumentPicker } from "./PaymentDocumentPicker";

/**
 * Buscador de documentos con saldo: el paso previo a `RegisterPaymentModal` cuando
 * la pantalla no sabe todavía qué venta o compra se paga (`/payments`).
 *
 * - Busca en servidor por número o por nombre/RIF del contacto, con rango de fechas.
 * - `canPayPurchases={false}` (vendedor) quita el selector de tipo: solo ventas.
 * - Con el foco en el buscador, flechas + Enter eligen sin ratón.
 * - `onSelect(document)` entrega el documento elegido; el buscador no registra nada.
 *
 * Estas historias simulan `GET /api/payments/open-documents` con MSW.
 */
const meta = {
  component: PaymentDocumentPicker,
  // El guardia de datos tecleados (CNF-15) usa `useRouter` de `next/navigation`: necesita el App Router simulado.
  parameters: { nextjs: { appDirectory: true } },
  tags: ["ai-generated"],
} satisfies Meta<typeof PaymentDocumentPicker>;

export default meta;
type Story = StoryObj;

const sales: OpenDocument[] = Array.from({ length: 27 }, (_unused, index) => ({
  contact: {
    id: `cont-${index}`,
    name: index % 5 === 0 ? "Inversiones y Distribuciones La Gran Parada del Este, C.A." : `Cliente ${index + 1}`,
  },
  createdAt: new Date(Date.UTC(2026, 8, 1 + index, 15, 10)).toISOString(),
  id: `sale-${index}`,
  number: `V-${String(index + 1).padStart(6, "0")}`,
  paidVes: 0,
  pendingRef: 12.5 + index,
  pendingVes: (12.5 + index) * 510,
  refRateVes: 510,
  status: "pendiente_pago",
  totalRef: 12.5 + index,
  totalVes: (12.5 + index) * 510,
  type: "sale",
}));

const purchases: OpenDocument[] = [
  {
    contact: { id: "cont-supplier", name: "Distribuidora Polar" },
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

const openDocumentsHandler = http.get("/api/payments/open-documents", async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const search = (params.get("search") ?? "").toLowerCase();
  const limit = Number(params.get("limit") ?? 20);
  const matches = (params.get("type") === "purchase" ? purchases : sales).filter(
    (document) =>
      document.number.toLowerCase().includes(search) ||
      (document.contact?.name ?? "").toLowerCase().includes(search),
  );

  await delay(250);

  return HttpResponse.json({
    data: {
      items: matches.slice(0, limit),
      limit,
      skip: 0,
      total: matches.length,
      totals: { count: matches.length, pendingVes: 0, truncated: false },
    },
  });
});

function PickerDemo({ canPayPurchases = true }: { canPayPurchases?: boolean }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<OpenDocument | null>(null);

  return (
    <div className="grid justify-items-start gap-3">
      <Button onClick={() => setOpen(true)} size="sm" type="button">
        Registrar pago
      </Button>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Documento elegido: {selected ? `${selected.number} (${selected.type})` : "ninguno"}
      </p>
      <PaymentDocumentPicker
        canPayPurchases={canPayPurchases}
        onOpenChange={setOpen}
        onSelect={(document) => {
          setSelected(document);
          setOpen(false);
        }}
        open={open}
      />
    </div>
  );
}

export const SalesAndPurchases: Story = {
  name: "Ventas y compras",
  parameters: { msw: { handlers: [openDocumentsHandler] } },
  render: () => <PickerDemo />,
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await body.findByRole("dialog", { name: "Registrar pago" }));
    const list = within(await dialog.findByRole("listbox", { name: "Ventas por cobrar" }));

    await expect(list.getAllByRole("option")).toHaveLength(20);
    await expect(dialog.getByText("Mostrando 20 de 27")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(await body.findByText("Documento elegido: V-000002 (sale)")).toBeInTheDocument();
  },
};

export const SellerOnlySales: Story = {
  name: "Vendedor: solo ventas",
  parameters: { msw: { handlers: [openDocumentsHandler] } },
  render: () => <PickerDemo canPayPurchases={false} />,
  play: async ({ canvasElement }) => {
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        name: "Registrar pago",
      }),
    );

    await dialog.findByRole("listbox", { name: "Ventas por cobrar" });
    await expect(dialog.queryByLabelText("Tipo de documento")).not.toBeInTheDocument();
  },
};

export const PurchasesToPay: Story = {
  name: "Compras por pagar",
  parameters: { msw: { handlers: [openDocumentsHandler] } },
  render: () => <PickerDemo />,
  play: async ({ canvasElement, userEvent }) => {
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog", {
        name: "Registrar pago",
      }),
    );

    await dialog.findByRole("listbox", { name: "Ventas por cobrar" });
    await userEvent.selectOptions(dialog.getByLabelText("Tipo de documento"), "purchase");

    const list = within(await dialog.findByRole("listbox", { name: "Compras por pagar" }));

    await expect(list.getByText("C-000128")).toBeInTheDocument();
    await expect(list.getByText("Distribuidora Polar")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  name: "Sin documentos con saldo",
  parameters: {
    msw: {
      handlers: [
        http.get("/api/payments/open-documents", () =>
          HttpResponse.json({
            data: {
              items: [],
              limit: 20,
              skip: 0,
              total: 0,
              totals: { count: 0, pendingVes: 0, truncated: false },
            },
          }),
        ),
      ],
    },
  },
  render: () => <PickerDemo />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));

    await expect(await dialog.findByText("No hay documentos con saldo")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  name: "Cargando",
  parameters: {
    msw: {
      handlers: [
        http.get("/api/payments/open-documents", async () => {
          await delay("infinite");

          return HttpResponse.json({ data: null });
        }),
      ],
    },
  },
  render: () => <PickerDemo />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));

    await expect(await dialog.findByText("Buscando documentos...")).toBeInTheDocument();
  },
};

export const ServerError: Story = {
  name: "Error con reintento",
  parameters: {
    msw: {
      handlers: [
        http.get("/api/payments/open-documents", () =>
          HttpResponse.json(
            { error: { code: "INTERNAL", message: "No se pudieron leer los documentos." } },
            { status: 500 },
          ),
        ),
      ],
    },
  },
  render: () => <PickerDemo />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));

    await expect(
      await dialog.findByText("No se pudieron leer los documentos."),
    ).toBeInTheDocument();
    await expect(dialog.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  },
};
