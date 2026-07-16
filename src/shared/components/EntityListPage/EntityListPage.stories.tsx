import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";

import { EntityListPage } from "./EntityListPage";

type Row = {
  id: string;
  name: string;
  status: string;
};

const columns: DataTableColumn<Row>[] = [
  { header: "Nombre", key: "name", render: (row) => row.name },
  { header: "Estado", key: "status", render: (row) => row.status },
];

const meta = {
  component: EntityListPage,
  title: "Shared/Layout/EntityListPage",
  tags: ["ai-generated"],
  args: {
    actions: <Button size="sm">Nuevo registro</Button>,
    children: (
      <>
        <FilterPanel>
          <Input label="Buscar" placeholder="Buscar registro" />
        </FilterPanel>
        <DataTable
          columns={columns}
          data={[
            { id: "1", name: "Registro demo", status: "Activo" },
            { id: "2", name: "Registro secundario", status: "Pendiente" },
          ]}
          getRowId={(row) => row.id}
        />
      </>
    ),
    description: "Estructura estándar para pantallas de listado.",
    title: "Listado base",
  },
} satisfies Meta<typeof EntityListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutActions: Story = {
  args: {
    actions: undefined,
  },
};

export const SectionsLayout: Story = {
  args: {
    layout: "sections",
    title: "Configuracion del sistema",
    description: "Administra los parametros generales de BodegaHub.",
    actions: (
      <>
        <Button variant="secondary">Descartar cambios</Button>
        <Button variant="primary">Guardar</Button>
      </>
    ),
    children: (
      <div className="rounded-lg border border-border bg-surface-container-lowest p-4">
        Seccion independiente (sin card contenedora global).
      </div>
    ),
  },
};
