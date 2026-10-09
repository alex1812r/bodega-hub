import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";

import { Badge } from "@/shared/components/Badge";

import { DataTable, type DataTableColumn } from "./DataTable";

type ProductRow = {
  id: string;
  name: string;
  status: "activo" | "bajo";
  stock: number;
};

const data: ProductRow[] = [
  { id: "P-001", name: "Aceite 1L", status: "activo", stock: 24 },
  { id: "P-002", name: "Harina PAN", status: "bajo", stock: 3 },
];

const columns: DataTableColumn<ProductRow>[] = [
  { header: "Producto", key: "name", render: (row) => row.name },
  { header: "Stock", key: "stock", render: (row) => row.stock },
  {
    header: "Estado",
    key: "status",
    render: (row) => (
      <Badge variant={row.status === "activo" ? "success" : "warning"}>
        {row.status}
      </Badge>
    ),
  },
];

const meta = {
  component: DataTable<ProductRow>,
  tags: ["ai-generated"],
  args: {
    columns,
    data,
    getRowId: (row) => row.id,
  },
} satisfies Meta<typeof DataTable<ProductRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithActions: Story = {
  args: {
    actions: () => [
      { label: "Ver detalle", onSelect: fn() },
      { label: "Editar", onSelect: fn() },
    ],
  },
};

/**
 * Tabla `stitch` (ancho mínimo de 720 px) en un contenedor de 560 px, como en
 * una ventana de 1024 px con el menú lateral abierto: la tabla hace scroll
 * horizontal dentro de su contenedor y la columna "Acciones" queda fijada a la
 * derecha, con el menú "…" siempre a la vista.
 */
export const StickyActionsNarrowContainer: Story = {
  args: {
    actions: () => [
      { label: "Ver detalle", onSelect: fn() },
      { label: "Editar", onSelect: fn() },
    ],
    layout: "table",
    variant: "stitch",
  },
  decorators: [
    (StoryComponent) => (
      <div className="w-[560px]">
        <StoryComponent />
      </div>
    ),
  ],
};

export const Empty: Story = {
  args: {
    data: [],
  },
};

export const Loading: Story = {
  args: {
    data: [],
    isLoading: true,
  },
};

export const Fetching: Story = {
  args: {
    isFetching: true,
  },
};

export const Error: Story = {
  args: {
    data: [],
    error: "El servidor no respondio a tiempo.",
    onRetry: fn(),
  },
};

/**
 * `renderExpandedRow`: la fila "Harina PAN" lleva su contenido expandido en una
 * fila a todo el ancho (al pie de la tarjeta en móvil). Qué fila está abierta y
 * el botón que la abre los pone quien usa la tabla.
 */
export const ExpandedRow: Story = {
  args: {
    renderExpandedRow: (row) =>
      row.id === "P-002" ? (
        <div className="bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant dark:bg-slate-950">
          Últimos movimientos de {row.name}: 3 unidades en existencia.
        </div>
      ) : null,
  },
};

export const EmptyWithAction: Story = {
  args: {
    data: [],
    emptyState: (
      <div>
        <p className="font-medium text-slate-950 dark:text-slate-100">
          No hay productos cargados.
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Crea el primer producto para comenzar.
        </p>
      </div>
    ),
  },
};
