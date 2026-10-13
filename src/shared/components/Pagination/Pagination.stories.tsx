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

/**
 * Variante `stitch` (listas): en escritorio, "Anterior", números y "Siguiente".
 * Estrecha la ventana a 390 px: quedan dos flechas y "Página X de Y", y el
 * resumen pasa a su propia línea; nada desborda.
 */
export const Stitch: Story = {
  args: {
    entityLabel: "productos",
    skip: 90,
    total: 250,
    variant: "stitch",
  },
};

/** La misma variante dentro de un contenedor de 358 px (ventana de 390 px con sus márgenes). */
export const StitchNarrowContainer: Story = {
  args: {
    entityLabel: "productos",
    skip: 90,
    total: 250,
    variant: "stitch",
  },
  decorators: [
    (StoryComponent) => (
      <div className="w-[358px] border border-dashed border-border">
        <StoryComponent />
      </div>
    ),
  ],
};

export const Disabled: Story = {
  args: {
    isDisabled: true,
    skip: 20,
    total: 95,
  },
};
