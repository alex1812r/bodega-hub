/**
 * REP17-03 · D70(b): TEST DE PROPIEDAD de TODO el panel de revisión a 1024×1366. Ninguna llegada asíncrona cambia el
 * `top` de ningún control interactivo de la cabecera, las filas, el contenido tras las filas (aviso de duplicado) ni el
 * pie: los casos de REP16-02 medidos en todo el panel (`Panel*`) y los escenarios de la pasada 18
 * (`InvoiceReviewPanel.rep17-03.harness.tsx`): tasa escrita y luego la del día (M-p18B-1), duplicado tardío
 * (B-p18B-1) y, con D72, nada se suelta tras un arrastre corto (B-p18B-2). Un archivo por ancho para que Vitest los corra en paralelo.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep17-03`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CaseHost, harnessHandlers, propertyPlay } from "./InvoiceReviewPanel.rep16-02.harness";
import { scenarioPlay } from "./InvoiceReviewPanel.rep17-03.harness";

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP17-03 propiedad 1024×1366: lo asíncrono no mueve nada del panel",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TasaEscritaLuegoLaDelDia: Story = { play: scenarioPlay("tasaEscrita", "w1024x1366") };
export const DuplicadoTardio: Story = { play: scenarioPlay("duplicadoTardio", "w1024x1366") };
export const NoSeSueltaTrasArrastreCorto: Story = { play: scenarioPlay("noSueltaArrastre", "w1024x1366") };
export const PanelTasa3_0: Story = { play: propertyPlay("tasa3", "w1024x1366", 0, "panel") };
export const PanelTasa3_1: Story = { play: propertyPlay("tasa3", "w1024x1366", 1, "panel") };
export const PanelEstados_0: Story = { play: propertyPlay("estados", "w1024x1366", 0, "panel") };
export const PanelEstados_1: Story = { play: propertyPlay("estados", "w1024x1366", 1, "panel") };
export const PanelEstados_2: Story = { play: propertyPlay("estados", "w1024x1366", 2, "panel") };
export const PanelEstados_3: Story = { play: propertyPlay("estados", "w1024x1366", 3, "panel") };
export const PanelEstadosBuscador_0: Story = { play: propertyPlay("estadosBuscador", "w1024x1366", 0, "panel") };
export const PanelEstadosBuscador_1: Story = { play: propertyPlay("estadosBuscador", "w1024x1366", 1, "panel") };
export const PanelEstadosBuscador_2: Story = { play: propertyPlay("estadosBuscador", "w1024x1366", 2, "panel") };
export const PanelEstadosImpresa_0: Story = { play: propertyPlay("estadosImpresa", "w1024x1366", 0, "panel") };
export const PanelEstadosImpresa_1: Story = { play: propertyPlay("estadosImpresa", "w1024x1366", 1, "panel") };
export const PanelEstadosImpresa_2: Story = { play: propertyPlay("estadosImpresa", "w1024x1366", 2, "panel") };
export const PanelEstadosImpresa_3: Story = { play: propertyPlay("estadosImpresa", "w1024x1366", 3, "panel") };
