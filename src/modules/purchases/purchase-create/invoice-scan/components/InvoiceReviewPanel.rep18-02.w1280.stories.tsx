/**
 * REP18-02 · D75(c): TEST DE PROPIEDAD del panel de revisión a 1280. Un control que APARECE o SE HABILITA por una
 * llegada asíncrona (tasa 900, 1 y 12.345,67, último costo, candidatos, duplicados, compra del duplicado) donde antes
 * había texto, hueco o un control deshabilitado, tocado ahí en menos de 1 s, no tiene efecto, en la cabecera, las filas,
 * lo de tras las filas, el pie y la lista flotante (`InvoiceReviewPanel.rep18-02.harness.tsx`). Un archivo por ancho para
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
  title: "Modules/Purchases/InvoiceReviewPanel/REP18-02 propiedad 1280: lo que aparece bajo el dedo no actúa",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tasa900: Story = { play: appearPlay("tasa900", "w1280") };
export const Tasa900Estados: Story = { play: appearPlay("tasa900Estados", "w1280") };
export const TasaConImpresa: Story = { play: appearPlay("tasaImpresa", "w1280") };
export const Tasa1: Story = { play: appearPlay("tasa1", "w1280") };
export const Tasa1AlFinal: Story = { play: appearPlay("tasa1Final", "w1280") };
export const TasaLarga: Story = { play: appearPlay("tasaLarga", "w1280") };
export const TasaLargaAlFinal: Story = { play: appearPlay("tasaLargaFinal", "w1280") };
export const TasaSinDesvioPie: Story = { play: appearPlay("tasaSinDesvio", "w1280") };
export const Candidatos: Story = { play: appearPlay("candidatos", "w1280") };
export const UltimoCosto: Story = { play: appearPlay("ultimoCosto", "w1280") };
export const Duplicados: Story = { play: appearPlay("duplicados", "w1280") };
export const CompraDuplicada: Story = { play: appearPlay("compraDuplicada", "w1280") };
