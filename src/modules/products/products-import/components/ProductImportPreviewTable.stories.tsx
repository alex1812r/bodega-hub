import type { Meta, StoryObj } from "@storybook/react";

import { ProductImportPreviewTable } from "./ProductImportPreviewTable";

const meta = {
  component: ProductImportPreviewTable,
  title: "Modules/Products/ProductImportPreviewTable",
} satisfies Meta<typeof ProductImportPreviewTable>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedRows: Story = {
  args: {
    rows: [
      {
        rowIndex: 3,
        sku: "BOD-001",
        name: "Chicle",
        status: "valid",
        messages: [],
        input: { sku: "BOD-001", name: "Chicle", salePriceRef: 1.2 },
      },
      {
        rowIndex: 4,
        sku: "BOD-002",
        name: "Oreo",
        status: "warning",
        messages: ["Este SKU ya existe en el catalogo."],
        input: { sku: "BOD-002", name: "Oreo", salePriceRef: 2 },
      },
      {
        rowIndex: 5,
        sku: "",
        name: "",
        status: "error",
        messages: ["El SKU es obligatorio.", "El nombre es obligatorio."],
      },
    ],
  },
};
