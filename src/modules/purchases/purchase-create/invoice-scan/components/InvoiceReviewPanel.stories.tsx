import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, fn, screen } from "storybook/test";

import { invoiceScanQueryKeys } from "@/modules/invoice-scan/client/useInvoiceScanImages";
import { purchaseSuppliersQueryKeys } from "@/modules/purchases/hooks/usePurchaseSuppliers";
import type {
  ContactEntityOption,
  EntityFetcher,
  ProductEntityOption,
} from "@/shared/components/EntityAutocomplete";

import {
  doubtfulLine,
  makeReviewResponse,
  productUuid,
  REVIEW_SCAN_ID,
  REVIEW_SUPPLIER_ID,
  REVIEW_TAX_RATES,
  unmatchedLine,
} from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

/** Página de factura de muestra (SVG en data URL): Storage no existe en Storybook. */
const INVOICE_PAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#ffffff"/><text x="40" y="60" font-size="28" font-family="sans-serif" fill="#0f172a">CHEVERE DEPOT C.A.</text>${Array.from(
    { length: 18 },
    (_, row) => `<rect x="40" y="${110 + row * 34}" width="${300 + ((row * 37) % 200)}" height="10" fill="#94a3b8"/>`,
  ).join("")}</svg>`,
)}`;

const products: ProductEntityOption[] = ["Harina PAN 1 kg", "Arroz Mary 1 kg", "Queso blanco duro", "Leche completa 1 L"].map(
  (label, position) => ({
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 1 + position,
    currentStock: 10 * position,
    id: productUuid(500 + position),
    isActive: true,
    label,
    salePriceRef: 2 + position,
    sku: `SKU-${position + 1}`,
  }),
);

const productFetcher: EntityFetcher<"product"> = async ({ query }) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter((product) => words.some((word) => product.label.toLowerCase().includes(word)));
};

const suppliers: ContactEntityOption[] = [
  { id: REVIEW_SUPPLIER_ID, isActive: true, label: "Chevere Depot C.A.", phone: "", taxId: "J-12345678-9", type: "proveedor" },
];

const supplierFetcher: EntityFetcher<"contact"> = async ({ query }) =>
  suppliers.filter((supplier) => supplier.label.toLowerCase().includes(query.toLowerCase()));

const mixedResponse = makeReviewResponse({
  extraction: { total: 2784, warnings: ["La esquina inferior salió cortada."] },
  lines: [
    { read: { description: "Arroz Mary 1kg", rawText: "ARROZ MARY 1KG", quantity: 4, unitPrice: 150, lineTotal: 600 } },
    unmatchedLine(2, true, {
      read: { description: "Queso blanco", rawText: "QUESO BCO DURO KG", quantity: 2, unitPrice: 450, lineTotal: 900 },
    }),
    doubtfulLine(3, 0.99, {
      read: { description: "Leche completa 1L", rawText: "LECHE COMP 1LT", quantity: 6, unitPrice: 40, lineTotal: 240 },
    }),
    doubtfulLine(4, 0.72, {
      read: { description: "Harina PAN bulto", rawText: "HARINA PAN BULTO", quantity: 1, unitPrice: 600, lineTotal: 600, unit: "bulto" },
      match: { entryMode: "pack", issues: ["La factura no dice cuántas unidades trae el bulto."] },
    }),
    { read: { description: "Azúcar 1kg", rawText: "AZUCAR 1KG", quantity: 2, unitPrice: 100, lineTotal: 210 } },
  ],
});

const meta = {
  args: {
    canCreateProduct: true,
    context: { systemRateVes: 900, taxRates: REVIEW_TAX_RATES },
    onDiscard: fn(),
    onLoad: fn(),
    onRescan: fn(),
    productFetcher,
    response: mixedResponse,
    supplierFetcher,
  },
  component: InvoiceReviewPanel,
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(purchaseSuppliersQueryKeys.detail(REVIEW_SUPPLIER_ID), {
        id: REVIEW_SUPPLIER_ID,
        isActive: true,
        name: "Chevere Depot C.A.",
        taxId: "J-12345678-9",
      });
      queryClient.setQueryData(invoiceScanQueryKeys.images(REVIEW_SCAN_ID), [INVOICE_PAGE, INVOICE_PAGE]);
      return (
        <QueryClientProvider client={queryClient}>
          <div className="min-h-screen bg-surface p-4">
            <Story />
          </div>
        </QueryClientProvider>
      );
    },
  ],
  parameters: { layout: "fullscreen" },
  title: "Modules/Purchases/InvoiceReviewPanel",
  tags: ["ai-generated"],
} satisfies Meta<typeof InvoiceReviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mezcla: sin emparejar, dudosa de 0,99 (no se acepta sola), bulto sin tamaño y confirmadas colapsadas. */
export const MezclaDeEstados: Story = {
  play: async () => {
    await expect(await screen.findByText("2 líneas confirmadas · ver", { exact: false })).toBeInTheDocument();
    await expect(screen.getByRole("button", { name: "Cargar en la compra" })).toBeDisabled();
  },
};

/** 6.21: factura en dólares; hay que aceptarla antes de cargar. */
export const FacturaEnDolares: Story = {
  args: {
    response: makeReviewResponse({
      extraction: { currency: "USD", total: 46.4 },
      lines: [
        { read: { description: "Harina PAN 1kg", quantity: 20, unitPrice: 1, lineTotal: 20 } },
        { read: { description: "Arroz Mary 1kg", quantity: 20, unitPrice: 1, lineTotal: 20 } },
      ],
    }),
  },
};

/** D8 / 6.20: la tasa impresa difiere más de un 2 % de la del día. */
export const TasaImpresaDistinta: Story = {
  args: {
    response: makeReviewResponse({
      extraction: { printedRate: 875.65, total: 464 },
      lines: [{}, { read: { description: "Arroz Mary 1kg", rawText: "ARROZ MARY 1KG" } }],
    }),
  },
};

/** 6.7: sin tasa del día ni impresa; se pide con NumberInput. */
export const SinTasa: Story = {
  args: {
    context: { taxRates: REVIEW_TAX_RATES },
    response: makeReviewResponse({ lines: [{}, doubtfulLine(2)] }),
  },
};

/** Todo emparejado por alias: solo queda revisar totales y cargar. */
export const TodasConfirmadas: Story = {
  args: {
    response: makeReviewResponse({
      extraction: { total: 1392 },
      lines: Array.from({ length: 6 }, (_, position) => ({
        read: { description: `Producto ${position + 1}`, rawText: `PRODUCTO ${position + 1}` },
      })),
    }),
  },
};
