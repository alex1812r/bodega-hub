import type { Meta, StoryObj } from "@storybook/react";

import { ProductImportProgressPanel } from "./ProductImportProgress";

const meta = {
  component: ProductImportProgressPanel,
  title: "Modules/Products/ProductImportProgress",
} satisfies Meta<typeof ProductImportProgressPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  args: {
    progress: {
      total: 12,
      processed: 5,
      succeeded: 4,
      failed: 1,
      currentRow: {
        rowIndex: 8,
        sku: "BOD-008",
        name: "Producto en curso",
        status: "valid",
        messages: [],
      },
    },
  },
};

export const Completed: Story = {
  args: {
    progress: {
      total: 12,
      processed: 12,
      succeeded: 11,
      failed: 1,
    },
  },
};
