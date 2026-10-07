import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { RememberedFiltersChip } from "./RememberedFiltersChip";

/**
 * Chip que acompaña a `useRememberedListFilters`: aparece cuando una lista se
 * abre desde el menú (sin parámetros en la URL) y recupera los filtros de la
 * última visita. "Limpiar" vuelve a los valores por defecto y olvida lo guardado.
 *
 * ```tsx
 * const list = useUrlListState(productsListSchema);
 * const remembered = useRememberedListFilters("products", list);
 *
 * {remembered.restored ? <RememberedFiltersChip onClear={remembered.clear} /> : null}
 * ```
 */
const meta = {
  args: {
    onClear: fn(),
  },
  component: RememberedFiltersChip,
  tags: ["ai-generated"],
} satisfies Meta<typeof RememberedFiltersChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Limpiar" }));

    await expect(args.onClear).toHaveBeenCalledTimes(1);
  },
};

export const InFilterBar: Story = {
  render: (args) => (
    <div className="flex w-full max-w-[390px] flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">12 productos</span>
      <RememberedFiltersChip {...args} />
    </div>
  ),
};
