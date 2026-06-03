import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DetailSkeleton } from "./DetailSkeleton";

const meta = {
  component: DetailSkeleton,
  tags: ["ai-generated"],
} satisfies Meta<typeof DetailSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleSection: Story = {
  args: {
    sections: 1,
  },
};

export const MultipleSections: Story = {
  args: {
    itemsPerSection: 6,
    sections: 3,
  },
};
