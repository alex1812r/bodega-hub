import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SaleCreatePage } from "./page";

const meta = {
  component: SaleCreatePage,
  title: "Modules/Sales/SaleCreatePage",
  tags: ["ai-generated"],
  // El POS usa `useRouter` de next/navigation para llevar al detalle de una venta
  // cuyo cobro fallo; sin app router montado el story lanza un invariant.
  parameters: { nextjs: { appDirectory: true } },
} satisfies Meta<typeof SaleCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
