import type { Meta, StoryObj } from "@storybook/react";

import { ProductImportStep1Template } from "./step1-template/ProductImportStep1Template";
import { ProductImportStep2File } from "./step2-file/ProductImportStep2File";
import { ProductImportStep3Preview } from "./step3-preview/ProductImportStep3Preview";
import { ProductImportStep4Importing } from "./step4-importing/ProductImportStep4Importing";
import { ProductImportStep5Summary } from "./step5-summary/ProductImportStep5Summary";
import { ProductImportStepper } from "./shared/ProductImportStepper";
import { ProductImportWizardHeader } from "./shared/ProductImportWizardHeader";

const meta = {
  title: "Modules/Products/ProductImportWizard",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Step1Template: Story = {
  render: () => (
    <div className="max-w-5xl space-y-6">
      <ProductImportWizardHeader step="template" />
      <ProductImportStepper currentStep="template" />
      <ProductImportStep1Template
        categoryNames={["Bebidas", "Víveres"]}
        isDownloading={false}
        onContinue={() => undefined}
        onDownload={() => undefined}
        templateMessage={null}
      />
    </div>
  ),
};

export const Step2File: Story = {
  render: () => (
    <div className="max-w-5xl space-y-6">
      <ProductImportWizardHeader step="file" />
      <ProductImportStepper currentStep="file" />
      <ProductImportStep2File
        errorMessage={null}
        fileName={null}
        isParsing={false}
        onBack={() => undefined}
        onFileSelected={() => undefined}
      />
    </div>
  ),
};

export const Step3Preview: Story = {
  render: () => (
    <div className="max-w-5xl space-y-6">
      <ProductImportWizardHeader step="preview" />
      <ProductImportStepper currentStep="preview" />
      <ProductImportStep3Preview
        categories={[
          { id: "1", isActive: true, name: "Bebidas" },
          { id: "2", isActive: true, name: "Víveres" },
        ]}
        errorCount={1}
        errorPolicy="continue"
        importableCount={2}
        onBack={() => undefined}
        onErrorPolicyChange={() => undefined}
        onImport={() => undefined}
        onUpdateRow={() => undefined}
        rows={[
          {
            rowIndex: 3,
            sku: "PRD-001",
            name: "Refresco Cola 2L",
            status: "valid",
            messages: [],
            input: {
              sku: "PRD-001",
              name: "Refresco Cola 2L",
              categoryId: "1",
              salePriceRef: 1.5,
              currentStock: 120,
            },
          },
          {
            rowIndex: 4,
            sku: "PRD-002",
            name: "Harina",
            status: "error",
            messages: ["precio_ref debe ser un numero valido."],
          },
        ]}
        warningCount={0}
      />
    </div>
  ),
};

export const Step4Importing: Story = {
  render: () => (
    <div className="max-w-5xl space-y-6">
      <ProductImportWizardHeader step="importing" />
      <ProductImportStepper currentStep="importing" />
      <ProductImportStep4Importing
        onCancel={() => undefined}
        progress={{
          total: 485,
          processed: 315,
          succeeded: 300,
          failed: 15,
          currentRow: {
            rowIndex: 318,
            sku: "PRD-318",
            name: "Producto",
            status: "valid",
            messages: [],
          },
        }}
      />
    </div>
  ),
};

export const Step5Summary: Story = {
  render: () => (
    <div className="max-w-5xl space-y-6">
      <ProductImportWizardHeader step="summary" />
      <ProductImportStepper currentStep="summary" />
      <ProductImportStep5Summary
        onDownloadLog={() => undefined}
        onReset={() => undefined}
        results={[
          { rowIndex: 3, sku: "PRD-001", status: "success" },
          { rowIndex: 4, sku: "PRD-002", status: "failed", error: "SKU duplicado" },
        ]}
      />
    </div>
  ),
};
