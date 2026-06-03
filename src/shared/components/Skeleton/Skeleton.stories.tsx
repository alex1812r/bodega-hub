import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Skeleton } from "./Skeleton";

const meta = {
  component: Skeleton,
  tags: ["ai-generated"],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Block: Story = {
  args: {
    className: "w-64",
  },
};

export const Text: Story = {
  args: {
    className: "w-48",
    variant: "text",
  },
};

export const Circle: Story = {
  args: {
    variant: "circle",
  },
};
