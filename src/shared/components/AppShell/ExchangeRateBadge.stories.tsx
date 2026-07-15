import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ExchangeRateBadge } from "./ExchangeRateBadge";

const meta = {
  component: ExchangeRateBadge,
  tags: ["ai-generated"],
} satisfies Meta<typeof ExchangeRateBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    rateVes: 36.5,
  },
};

export const Unavailable: Story = {
  args: {},
};

export const WithError: Story = {
  args: {
    hasError: true,
    rateVes: 36.5,
  },
};
