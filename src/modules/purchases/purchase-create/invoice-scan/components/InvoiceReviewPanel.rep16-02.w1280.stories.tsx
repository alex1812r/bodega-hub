/**
 * REP16-02 · D67(b): TEST DE PROPIEDAD del panel de revisión a 1280. Ninguna llegada asíncrona (nombre del
 * proveedor, compra del duplicado, duplicados, tasa del día, candidatos del buscador, último costo, y el error de red de
 * cada una) cambia el `top` de ningún control interactivo de ninguna fila, del aviso tras las líneas ni del pie, en
 * ningún frame, en cualquier orden y combinación (`InvoiceReviewPanel.rep16-02.cases.ts`; arnés en
 * `InvoiceReviewPanel.rep16-02.harness.tsx`). Un archivo por ancho (390, 768, 1024×1366, 1280) para que Vitest los
 * corra en paralelo; cada historia es un tramo de casos (15 s por historia).
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep16-02`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CaseHost, harnessHandlers, propertyPlay } from "./InvoiceReviewPanel.rep16-02.harness";

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP16-02 propiedad 1280: lo asíncrono no mueve controles",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tasa3_0: Story = { play: propertyPlay("tasa3", "w1280", 0) };
export const Tasa3_1: Story = { play: propertyPlay("tasa3", "w1280", 1) };
export const Estados_0: Story = { play: propertyPlay("estados", "w1280", 0) };
export const Estados_1: Story = { play: propertyPlay("estados", "w1280", 1) };
export const Estados_2: Story = { play: propertyPlay("estados", "w1280", 2) };
export const Estados_3: Story = { play: propertyPlay("estados", "w1280", 3) };
export const EstadosBuscador_0: Story = { play: propertyPlay("estadosBuscador", "w1280", 0) };
export const EstadosBuscador_1: Story = { play: propertyPlay("estadosBuscador", "w1280", 1) };
export const EstadosBuscador_2: Story = { play: propertyPlay("estadosBuscador", "w1280", 2) };
export const EstadosImpresa_0: Story = { play: propertyPlay("estadosImpresa", "w1280", 0) };
export const EstadosImpresa_1: Story = { play: propertyPlay("estadosImpresa", "w1280", 1) };
export const EstadosImpresa_2: Story = { play: propertyPlay("estadosImpresa", "w1280", 2) };
export const EstadosImpresa_3: Story = { play: propertyPlay("estadosImpresa", "w1280", 3) };
