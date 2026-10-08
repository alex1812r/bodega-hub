import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { contactsQueryKeys } from "@/modules/contacts/hooks/useContacts";
import type { ContactEntityOption, EntityFetcher } from "@/shared/components/EntityAutocomplete";

import { PurchaseSupplierCard } from "./PurchaseSupplierCard";

const suppliers: ContactEntityOption[] = [
  {
    id: "sup-1",
    isActive: true,
    label: "Distribuidora Norte C.A.",
    phone: "0412-0000000",
    taxId: "J-12345678-9",
    type: "proveedor",
  },
  {
    id: "sup-2",
    isActive: true,
    label: "Mayorista del Sur",
    phone: "0414-1111111",
    taxId: "J-87654321-0",
    type: "ambos",
  },
];

const supplierFetcher: EntityFetcher<"contact"> = async ({ query }) =>
  suppliers.filter((supplier) => supplier.label.toLowerCase().includes(query.toLowerCase()));

const meta = {
  args: {
    onSupplierChange: () => undefined,
    selectedSupplierId: "",
    supplierFetcher,
  },
  component: PurchaseSupplierCard,
  decorators: [
    (Story) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

      queryClient.setQueryData(contactsQueryKeys.detail("sup-1"), {
        id: "sup-1",
        isActive: true,
        name: "Distribuidora Norte C.A.",
        type: "proveedor",
      });

      return (
        <QueryClientProvider client={queryClient}>
          <Story />
        </QueryClientProvider>
      );
    },
  ],
  title: "Modules/Purchases/PurchaseSupplierCard",
  tags: ["ai-generated"],
} satisfies Meta<typeof PurchaseSupplierCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sin proveedor: escribe al menos dos letras ("no", "sur") para buscar. */
export const Default: Story = {};

/** El id llega desde fuera (borrador restaurado o compra duplicada). */
export const SelectedFromOutside: Story = {
  args: { selectedSupplierId: "sup-1" },
};
