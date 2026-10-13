import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";

import { PageHeader } from "./PageHeader";

/**
 * Encabezado de pantalla. Desde `sm` el título y las acciones comparten línea
 * mientras el título conserve al menos 16rem; si no, las acciones bajan a una
 * segunda línea (alineadas a la derecha) y se reparten en varias si hace falta.
 */
const meta = {
  args: {
    title: "Productos",
  },
  component: PageHeader,
  tags: ["ai-generated"],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {};

export const WithDescriptionAndAction: Story = {
  args: {
    actions: <Button>Nuevo producto</Button>,
    badge: <Badge variant="success">Activo</Badge>,
    description: "Catálogo de la tienda con precios, existencias y márgenes.",
  },
};

const manyActions = (
  <>
    <Button variant="outline">Volver</Button>
    <Button variant="outline">Descargar PDF</Button>
    <Button variant="outline">Editar</Button>
    <Button variant="outline">Registrar pago</Button>
    <Button>Recibir mercancía</Button>
  </>
);

/**
 * Cinco acciones y un título largo: el título conserva su ancho y parte por
 * palabras; las acciones pasan a la segunda línea cuando no caben.
 */
export const ManyActionsLongTitle: Story = {
  args: {
    actions: manyActions,
    description: "Recibida el 9 de octubre de 2026 · 14 productos",
    title: "Compra a Distribuidora de Alimentos y Bebidas del Centro Occidente",
  },
};

/** El mismo encabezado en el ancho útil de una ventana de 1024 px con el menú lateral abierto. */
export const ManyActionsNarrowContainer: Story = {
  args: ManyActionsLongTitle.args,
  decorators: [
    (StoryComponent) => (
      <div className="w-[720px] border border-dashed border-border p-4">
        <StoryComponent />
      </div>
    ),
  ],
};
