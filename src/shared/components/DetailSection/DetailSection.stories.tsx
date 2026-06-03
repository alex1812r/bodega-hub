import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/components/Button";
import { InfoGrid } from "@/shared/components/InfoGrid";

import { DetailSection } from "./DetailSection";

const meta = {
  component: DetailSection,
  tags: ["ai-generated"],
  args: {
    title: "Datos generales",
    description: "Informacion principal del registro.",
    actions: <Button size="sm">Editar</Button>,
    children: (
      <InfoGrid
        items={[
          { label: "Nombre", value: "Aceite 1L" },
          { label: "Estado", value: "Activo" },
          { label: "Categoria", value: "Alimentos" },
        ]}
      />
    ),
  },
} satisfies Meta<typeof DetailSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
