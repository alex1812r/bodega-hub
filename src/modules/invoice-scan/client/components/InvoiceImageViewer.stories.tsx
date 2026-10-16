import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { InvoiceImageViewer } from "./InvoiceImageViewer";

function samplePage(title: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#ffffff"/><text x="40" y="60" font-size="28" font-family="sans-serif" fill="#0f172a">${title}</text>${Array.from(
      { length: 18 },
      (_, row) => `<rect x="40" y="${110 + row * 34}" width="${300 + ((row * 37) % 200)}" height="10" fill="#94a3b8"/>`,
    ).join("")}</svg>`,
  )}`;
}

const meta = {
  args: { alt: "Factura escaneada", urls: [samplePage("Página 1")] },
  component: InvoiceImageViewer,
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <Story />
      </div>
    ),
  ],
  title: "Modules/InvoiceScan/InvoiceImageViewer",
  tags: ["ai-generated"],
} satisfies Meta<typeof InvoiceImageViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Una página: +/−, rueda para acercar y arrastre con la imagen ampliada. */
export const UnaPagina: Story = {};

export const VariasPaginas: Story = {
  args: { urls: [samplePage("Página 1"), samplePage("Página 2")] },
};

export const SinImagen: Story = {
  args: { urls: [] },
};

/** URL caducada o inexistente: aviso en lugar de la imagen rota. */
export const ImagenRota: Story = {
  args: { urls: ["https://example.invalid/caducada.jpg"] },
};
