import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TableSkeleton } from "./TableSkeleton";

const meta = {
  component: TableSkeleton,
  decorators: [
    (Story) => (
      <table className="min-w-full">
        <tbody>
          <Story />
        </tbody>
      </table>
    ),
  ],
  tags: ["ai-generated"],
  args: {
    columns: 4,
    rows: 5,
  },
} satisfies Meta<typeof TableSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithoutActions: Story = {};

export const WithActions: Story = {
  args: {
    showActions: true,
  },
};
