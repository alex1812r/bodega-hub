import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { CategoryQuickCreateModal } from "./CategoryQuickCreateModal";

const meta = {
  component: CategoryQuickCreateModal,
  tags: ["ai-generated"],
  args: {
    onCreated: fn(),
    onOpenChange: fn(),
  },
} satisfies Meta<typeof CategoryQuickCreateModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Alta rápida desde el formulario de producto: solo Nombre y alícuota de IVA. */
export const Default: Story = {};
