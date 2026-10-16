import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen } from "storybook/test";

import type { InvoiceScanLimits, InvoiceScanResponse } from "../../contracts";
import type { PreparedInvoice } from "../prepareInvoiceFile";
import { InvoiceScanModal } from "./InvoiceScanModal";

/** Página de muestra: un JPEG mínimo pintado en un canvas para la miniatura. */
async function samplePage(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 400;
  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 300, 400);
    context.fillStyle = "#334155";
    for (let y = 40; y < 380; y += 24) {
      context.fillRect(24, y, 252, 6);
    }
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? new Blob()), "image/jpeg"));
}

function fakePrepare(warnings: string[]) {
  return async (file: File): Promise<PreparedInvoice> => {
    const blob = await samplePage();

    return {
      pages: [{ blob, bytes: blob.size, height: 400, mediaType: "image/jpeg", width: 300 }],
      quality: { pages: [{ brightness: 120, sharpness: 600 }], warnings },
      sha256: "d".repeat(64),
      sourceName: file.name,
      sourceType: file.type,
    };
  };
}

const response: InvoiceScanResponse = {
  cached: false,
  extraction: { confidence: 0.92, currency: "VES", lines: [], supplier: { name: "Distribuidora Ejemplo" }, warnings: [] },
  limits: { limit: 50, remaining: 46, used: 4 },
  matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
  scanId: "scan-story",
};

/** Stub de `fetch`: el API de escaneo no existe en Storybook. */
function stubScanApi(limits: InvoiceScanLimits) {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" }, status });

    if (url.endsWith("/api/purchases/invoice-scan/limits")) {
      return json({ data: limits });
    }

    if (url.endsWith("/api/purchases/invoice-scan") && init?.method === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return json({ data: response });
    }

    return original(input, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

const meta = {
  args: {
    onBusyChange: fn(),
    onOpenChange: fn(),
    onScanned: fn(),
    open: true,
    prepareFile: fakePrepare([]),
  },
  beforeEach: () => stubScanApi({ limit: 50, remaining: 47, used: 3 }),
  component: InvoiceScanModal,
  tags: ["ai-generated"],
  title: "Modules/InvoiceScan/InvoiceScanModal",
} satisfies Meta<typeof InvoiceScanModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Zona de arrastrar/soltar y contador de la cuota del día. */
export const Default: Story = {
  play: async () => {
    await expect(await screen.findByText("Escaneos hoy: 3 de 50")).toBeInTheDocument();
  },
};

/** La foto sale oscura: el modal ofrece repetirla o escanear igual. */
export const WithQualityWarning: Story = {
  args: { prepareFile: fakePrepare(["La foto está muy oscura."]) },
  name: "Con aviso de calidad",
};

/** Cuota agotada: el botón de seleccionar queda deshabilitado con su mensaje. */
export const QuotaExhausted: Story = {
  beforeEach: () => stubScanApi({ limit: 50, remaining: 0, used: 50 }),
  name: "Cuota agotada",
};

export const NarrowScreen: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "390 px",
};
