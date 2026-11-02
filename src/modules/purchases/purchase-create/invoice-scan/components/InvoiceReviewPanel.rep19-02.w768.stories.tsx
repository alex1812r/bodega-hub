/**
 * REP19-02 · D77(e): TEST DE PROPIEDAD del panel de revisión a 768. Lo que una llegada asíncrona hace aparecer bajo
 * el dedo MIENTRAS el usuario teclea en otro campo (teclas cada 30, 60 y 110 ms), tocado en menos de 1 s, no tiene
 * efecto (M-p20B-1). Lo que provoca el usuario sigue tocable en menos de 1 s: el primer listado del buscador tecleando
 * (D76(a)) y «Cambiar producto» tras «ver confirmadas» (M-q1809-1). Ver `InvoiceReviewPanel.rep19-02.harness.tsx`.
 *
 * Correr: `npx vitest --project storybook run src/modules/purchases/purchase-create/invoice-scan/components/InvoiceReviewPanel.rep19-02`
 * Fuera de Vitest (Storybook en el navegador) no hay viewport real y la medición se omite.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CaseHost, harnessHandlers } from "./InvoiceReviewPanel.rep16-02.harness";
import { changeProductPlay, mountedWithRatePlay, typingPlay } from "./InvoiceReviewPanel.rep19-02.harness";

const meta = {
  component: CaseHost,
  parameters: { layout: "fullscreen", msw: { handlers: harnessHandlers } },
  tags: ["!dev", "!autodocs"],
  title: "Modules/Purchases/InvoiceReviewPanel/REP19-02 propiedad 768: llegada mientras se teclea",
} satisfies Meta<typeof CaseHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TasaTecleandoCada30: Story = { play: typingPlay("tasaK30", "w768") };
export const TasaTecleandoCada60: Story = { play: typingPlay("tasaK60", "w768") };
export const TasaTecleandoCada110: Story = { play: typingPlay("tasaK110", "w768") };
export const TasaImpresaTecleandoEnCabecera: Story = { play: typingPlay("tasaImpresaCabeceraK60", "w768") };
export const DuplicadoTecleando: Story = { play: typingPlay("duplicadosK30", "w768") };
export const PrimerListadoTecleandoTocable: Story = { play: typingPlay("primerListado", "w768") };
export const CambiarProductoTrasVer300: Story = { play: changeProductPlay(300, "w768") };
export const CambiarProductoTrasVer700: Story = { play: changeProductPlay(700, "w768") };
export const RecienMontadoConTasaDescartarTocable: Story = { play: mountedWithRatePlay("w768") };
