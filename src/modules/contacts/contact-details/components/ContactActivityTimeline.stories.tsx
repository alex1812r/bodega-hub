import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ContactActivityTimeline } from "./ContactActivityTimeline";

const meta = {
  component: ContactActivityTimeline,
  decorators: [
    (Story) => (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-6">
        <Story />
      </div>
    ),
  ],
  title: "Modules/Contacts/ContactActivityTimeline",
  tags: ["ai-generated"],
  args: {
    items: [
      {
        amountVes: 7650,
        createdAt: "2026-05-18",
        dateLabel: "18/05/2026",
        description: "Monto: Bs. 7,650.00.",
        id: "ACT-001",
        title: "Venta registrada: VEN-0002",
        type: "venta",
      },
      {
        amountVes: 3000,
        createdAt: "2026-05-17",
        dateLabel: "17/05/2026",
        description: "Monto: Bs. 3,000.00.",
        id: "ACT-002",
        title: "Pago registrado: PAG-0002",
        type: "pago",
      },
    ],
  },
} satisfies Meta<typeof ContactActivityTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    items: [],
  },
};
