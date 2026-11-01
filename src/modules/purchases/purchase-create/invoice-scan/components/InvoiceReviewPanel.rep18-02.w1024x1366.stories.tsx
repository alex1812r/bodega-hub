/**
 * REP18-02 · D75(c): TEST DE PROPIEDAD del panel de revisión a 1024×1366. Un control que APARECE o SE HABILITA por una
 * llegada asíncrona (tasa 900, 1 y 12.345,67, último costo, refresco del buscador abierto, duplicados, compra del
 * duplicado) donde antes había texto, hueco o un control deshabilitado, tocado ahí en menos de 1 s, no tiene efecto,
 * en la cabecera, las filas, lo de tras las filas, el pie y la lista flotante (`InvoiceReviewPanel.rep18-02.harness.tsx`).
 * D76(a): el primer listado del buscador (los candidatos tras «Buscando...») es del usuario y sí se elige. Un archivo por ancho para
 * que Vitest los corra en paralelo.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep18-02`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CaseHost, harnessHandlers } from "./InvoiceReviewPanel.rep16-02.harness";
import { appearPlay } from "./InvoiceReviewPanel.rep18-02.harness";

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP18-02 propiedad 1024×1366: lo que aparece bajo el dedo no actúa",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tasa900: Story = { play: appearPlay("tasa900", "w1024x1366") };
export const Tasa900Estados: Story = { play: appearPlay("tasa900Estados", "w1024x1366") };
export const TasaConImpresa: Story = { play: appearPlay("tasaImpresa", "w1024x1366") };
export const Tasa1: Story = { play: appearPlay("tasa1", "w1024x1366") };
export const Tasa1AlFinal: Story = { play: appearPlay("tasa1Final", "w1024x1366") };
export const TasaLarga: Story = { play: appearPlay("tasaLarga", "w1024x1366") };
export const TasaLargaAlFinal: Story = { play: appearPlay("tasaLargaFinal", "w1024x1366") };
export const TasaSinDesvioPie: Story = { play: appearPlay("tasaSinDesvio", "w1024x1366") };
export const Candidatos: Story = { play: appearPlay("candidatos", "w1024x1366") };
export const Refresco: Story = { play: appearPlay("refresco", "w1024x1366") };
export const UltimoCosto: Story = { play: appearPlay("ultimoCosto", "w1024x1366") };
export const Duplicados: Story = { play: appearPlay("duplicados", "w1024x1366") };
export const CompraDuplicada: Story = { play: appearPlay("compraDuplicada", "w1024x1366") };
