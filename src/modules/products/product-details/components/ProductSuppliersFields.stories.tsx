import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import type { ContactEntityOption, EntityFetcher } from "@/shared/components/EntityAutocomplete";

import {
  createProductSuppliersState,
  EMPTY_PRODUCT_SUPPLIERS_STATE,
  ProductSuppliersFields,
  type ProductSuppliersFormState,
} from "./ProductSuppliersFields";

/**
 * Proveedores de un producto dentro de su formulario (PRO-14): la lista de
 * vínculos con costo y código opcionales, el habitual (uno por producto) y un
 * buscador para añadir. En el formulario va dentro de "Más opciones" →
 * "Proveedores"; aquí se muestra suelto.
 *
 * El buscador de estas historias no llama al servidor: prueba «polar»,
 * «mavesa» o «cargill».
 */
const meta = {
  component: ProductSuppliersFields,
  tags: ["ai-generated"],
} satisfies Meta<typeof ProductSuppliersFields>;

export default meta;
type Story = StoryObj;

function contact(id: string, label: string): ContactEntityOption {
  return { id, isActive: true, label, phone: "0212-5550101", taxId: "", type: "proveedor" };
}

const demoSuppliers = [
  contact("sup-polar", "Alimentos Polar"),
  contact("sup-mavesa", "Mavesa"),
  contact("sup-cargill", "Cargill de Venezuela"),
];

const fetchDemoSuppliers: EntityFetcher<"contact"> = async ({ query }) =>
  demoSuppliers.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

const twoSuppliers = createProductSuppliersState([
  {
    isPreferred: true,
    lastCostRef: 1.5,
    supplier: { isActive: true, name: "Alimentos Polar" },
    supplierId: "sup-polar",
    supplierSku: "pol-001",
  },
  { lastCostRef: 0, supplier: { isActive: true, name: "Mavesa" }, supplierId: "sup-mavesa" },
]);

const withInactiveSupplier = createProductSuppliersState([
  {
    isPreferred: true,
    lastCostRef: 1.5,
    supplier: { isActive: true, name: "Alimentos Polar" },
    supplierId: "sup-polar",
  },
  {
    lastCostRef: 1.4,
    supplier: { isActive: false, name: "Distribuidora El Trigal (cerrada)" },
    supplierId: "sup-trigal",
  },
]);

type DemoProps = {
  initialState?: ProductSuppliersFormState;
  isLoading?: boolean;
  loadError?: string;
  showErrors?: boolean;
};

function Demo({ initialState = EMPTY_PRODUCT_SUPPLIERS_STATE, ...props }: DemoProps) {
  const [state, setState] = useState(initialState);

  return (
    <div className="max-w-xl">
      <ProductSuppliersFields
        {...props}
        onChange={setState}
        onRetryLoad={() => undefined}
        state={state}
        supplierFetcher={fetchDemoSuppliers}
      />
    </div>
  );
}

/** Alta: sin proveedores. El primero que se añade queda como habitual. */
export const Empty: Story = {
  render: () => <Demo />,
};

/** Dos proveedores: el habitual marcado y cada uno con su costo y su código. */
export const TwoSuppliers: Story = {
  render: () => <Demo initialState={twoSuppliers} />,
};

/** Un proveedor inactivo sigue en la lista, pero no puede marcarse habitual. */
export const InactiveSupplier: Story = {
  render: () => <Demo initialState={withInactiveSupplier} />,
};

/** Al quitar al habitual, pasa al siguiente de la lista y se avisa. */
export const RemovePreferred: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Quitar a Alimentos Polar" }));

    await expect(canvas.getByRole("status")).toHaveTextContent("El habitual pasa a Mavesa.");
    await expect(canvas.getByRole("radio", { name: "Habitual: Mavesa" })).toBeChecked();
  },
  render: () => <Demo initialState={twoSuppliers} />,
};

/** Tras intentar guardar: un costo que no vale se señala en su campo. */
export const CostError: Story = {
  render: () => (
    <Demo
      initialState={{
        ...twoSuppliers,
        rows: twoSuppliers.rows.map((row, index) =>
          index === 1 ? { ...row, costRef: "99999999999" } : row,
        ),
      }}
      showErrors
    />
  ),
};

/** Edición: mientras se cargan los proveedores del producto. */
export const Loading: Story = {
  render: () => <Demo isLoading />,
};

/** Edición: la carga falló; la lista no se muestra ni se guarda. */
export const LoadError: Story = {
  render: () => <Demo loadError="No se pudo consultar los proveedores." />,
};

/** 390 px: cada fila apila el nombre, el costo, el código y el botón de quitar. */
export const Mobile390: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  parameters: {
    viewport: {
      options: {
        mobile390: {
          name: "Móvil 390 px",
          styles: { height: "844px", width: "390px" },
          type: "mobile",
        },
      },
    },
  },
  render: () => <Demo initialState={withInactiveSupplier} />,
};
