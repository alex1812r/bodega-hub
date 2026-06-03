import type { Meta, StoryObj } from "@storybook/react";

import { ProductImportPreviewTable } from "./ProductImportPreviewTable";
import { ProductImportProgressPanel } from "./ProductImportProgress";
import { ProductImportSummary } from "./ProductImportSummary";

function TemplateStepPreview() {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Paso 1 — Plantilla</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Descargar plantilla Excel con categorias del servidor.
      </p>
    </div>
  );
}

const meta = {
  title: "Modules/Products/ProductImportWizard",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const PreviewStep: Story = {
  render: () => (
    <ProductImportPreviewTable
      rows={[
        {
          rowIndex: 3,
          sku: "BOD-001",
          name: "Chicle",
          status: "valid",
          messages: [],
        },
        {
          rowIndex: 4,
          sku: "BOD-002",
          name: "Oreo",
          status: "warning",
          messages: ["Este SKU ya existe en el catalogo."],
        },
      ]}
    />
  ),
};

export const ImportingStep: Story = {
  render: () => (
    <ProductImportProgressPanel
      progress={{
        total: 10,
        processed: 6,
        succeeded: 5,
        failed: 1,
        currentRow: {
          rowIndex: 9,
          sku: "BOD-009",
          name: "Malta",
          status: "valid",
          messages: [],
        },
      }}
    />
  ),
};

export const SummaryStep: Story = {
  render: () => (
    <ProductImportSummary
      onReset={() => undefined}
      results={[
        { rowIndex: 3, sku: "BOD-001", status: "success" },
        { rowIndex: 4, sku: "BOD-002", status: "failed", error: "SKU duplicado" },
      ]}
    />
  ),
};

export const TemplateStep: Story = {
  render: () => <TemplateStepPreview />,
};
