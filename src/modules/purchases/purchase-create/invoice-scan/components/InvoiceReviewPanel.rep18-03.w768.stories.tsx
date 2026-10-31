/**
 * REP18-03 · D75(d) (B-p19B-1) a 768: con la página al final, la tasa del día 1, 250, 900, 1500 o 12.345,67 no mueve ningún
 * control del panel (pie incluido) ni recorta el desplazamiento (`InvoiceReviewPanel.rep18-03.harness.tsx`). Un archivo
 * por ancho para que Vitest los corra en paralelo.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep18-03`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CaseHost, harnessHandlers } from "./InvoiceReviewPanel.rep16-02.harness";
import { endPlay } from "./InvoiceReviewPanel.rep18-03.harness";

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP18-03 768: la tasa con la página al final no mueve el pie",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TasasAlFinal: Story = { play: endPlay("w768") };
