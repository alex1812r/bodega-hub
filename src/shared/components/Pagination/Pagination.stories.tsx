import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { Pagination } from "./Pagination";

const meta = {
  component: Pagination,
  tags: ["ai-generated"],
  args: {
    limit: 10,
    skip: 0,
    total: 95,
    onSkipChange: () => undefined,
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstPage: Story = {};

export const MiddlePage: Story = {
  args: {
    skip: 30,
    total: 95,
  },
};

export const LastPage: Story = {
  args: {
    skip: 90,
    total: 95,
  },
};

export const SinglePage: Story = {
  args: {
    skip: 0,
    total: 7,
  },
};

export const EmptyResults: Story = {
  args: {
    skip: 0,
    total: 0,
  },
};

export const ManyPages: Story = {
  args: {
    limit: 10,
    skip: 90,
    total: 250,
  },
};

export const WithPageSizeSelector: Story = {
  render: (args) => {
    const [skip, setSkip] = useState(args.skip);
    const [limit, setLimit] = useState(args.limit);

    return (
      <Pagination
        {...args}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={skip}
      />
    );
  },
  args: {
    total: 128,
  },
};

export const Disabled: Story = {
  args: {
    isDisabled: true,
    skip: 20,
    total: 95,
  },
};
