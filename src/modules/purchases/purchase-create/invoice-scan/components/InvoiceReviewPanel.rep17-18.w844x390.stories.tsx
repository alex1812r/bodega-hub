/**
 * REP17-18 · D72(d): TEST DE PROPIEDAD del panel de revisión a 844×390 con algo retenido (hueco de la reserva de la tasa,
 * fila descartada y resuelta, aviso que encoge) y un gesto del usuario: rueda, dedo, pinch, salida del panel con el
 * ratón, teclado y portátil táctil. Ningún control del panel se mueve en el documento más allá del desplazamiento del
 * gesto y nada se suelta solo; «Compactar lista» compacta solo al pulsarlo, con la guarda D49
 * (`InvoiceReviewPanel.rep17-18.harness.tsx`). Un archivo por ancho para que Vitest los corra en paralelo.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep17-18`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CaseHost, harnessHandlers } from "./InvoiceReviewPanel.rep16-02.harness";
import { gesturePlay } from "./InvoiceReviewPanel.rep17-18.harness";

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP17-18 propiedad 844×390: con algo retenido ningún gesto mueve nada",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RuedaConReserva: Story = { play: gesturePlay("rueda", "reserva", "w844x390") };
export const DedoConReserva: Story = { play: gesturePlay("dedo", "reserva", "w844x390") };
export const PinchConReserva: Story = { play: gesturePlay("pinch", "reserva", "w844x390") };
export const SalidaRatonConReserva: Story = { play: gesturePlay("salida", "reserva", "w844x390") };
export const TecladoConReserva: Story = { play: gesturePlay("teclado", "reserva", "w844x390") };
export const PortatilTactilConReserva: Story = { play: gesturePlay("portatil", "reserva", "w844x390") };
export const CompactarListaConReserva: Story = { play: gesturePlay("compactar", "reserva", "w844x390") };
export const RuedaConFila: Story = { play: gesturePlay("rueda", "fila", "w844x390") };
export const DedoConFila: Story = { play: gesturePlay("dedo", "fila", "w844x390") };
export const PinchConFila: Story = { play: gesturePlay("pinch", "fila", "w844x390") };
export const SalidaRatonConFila: Story = { play: gesturePlay("salida", "fila", "w844x390") };
export const TecladoConFila: Story = { play: gesturePlay("teclado", "fila", "w844x390") };
export const PortatilTactilConFila: Story = { play: gesturePlay("portatil", "fila", "w844x390") };
export const CompactarListaConFila: Story = { play: gesturePlay("compactar", "fila", "w844x390") };
export const RuedaConAviso: Story = { play: gesturePlay("rueda", "aviso", "w844x390") };
export const DedoConAviso: Story = { play: gesturePlay("dedo", "aviso", "w844x390") };
export const PinchConAviso: Story = { play: gesturePlay("pinch", "aviso", "w844x390") };
export const SalidaRatonConAviso: Story = { play: gesturePlay("salida", "aviso", "w844x390") };
export const TecladoConAviso: Story = { play: gesturePlay("teclado", "aviso", "w844x390") };
export const PortatilTactilConAviso: Story = { play: gesturePlay("portatil", "aviso", "w844x390") };
export const CompactarListaConAviso: Story = { play: gesturePlay("compactar", "aviso", "w844x390") };
