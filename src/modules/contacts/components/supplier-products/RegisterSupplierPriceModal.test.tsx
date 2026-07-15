import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockMutateAsync = jest.fn();

jest.mock("../../hooks/useSupplierProductMutations", () => ({
  useRegisterSupplierPrice: () => ({
    isPending: false,
    mutateAsync: mockMutateAsync,
  }),
}));

import { RegisterSupplierPriceModal } from "./RegisterSupplierPriceModal";

import { mockContacts, mockProducts } from "@/shared/mocks/erp-data";

import type { SupplierProduct } from "../../types/supplierProducts";

const supplierProduct: SupplierProduct = {
  id: "supp-prod-drill",
  isActive: true,
  lastCostRef: 8.5,
  packUnits: [
    {
      id: "sp-pack-drill-bulto",
      isActive: true,
      isDefault: true,
      label: "Bulto",
      supplierProductId: "supp-prod-drill",
      unitsPerPack: 12,
    },
  ],
  product: mockProducts.find((product) => product.id === "prod-drill"),
  productId: "prod-drill",
  supplier: mockContacts.find((contact) => contact.id === "cont-both"),
  supplierId: "cont-both",
};

describe("RegisterSupplierPriceModal", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({
      supplierProduct: { ...supplierProduct, lastCostRef: 9.1 },
      variationPercent: 7.06,
    });
  });

  it("shows estimated variation preview when typing a new cost", async () => {
    const user = userEvent.setup();

    render(
      <RegisterSupplierPriceModal
        onOpenChange={jest.fn()}
        open
        supplierProduct={supplierProduct}
      />,
    );

    await user.type(screen.getByLabelText(/nuevo costo unitario/i), "9.1");

    expect(screen.getByText(/variación estimada/i)).toBeVisible();
    expect(screen.getByText(/\+7\.1%/)).toBeVisible();
  });

  it("submits a price registration and closes on success", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    const onSuccess = jest.fn();

    render(
      <RegisterSupplierPriceModal
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open
        supplierProduct={supplierProduct}
      />,
    );

    await user.type(screen.getByLabelText(/nuevo costo unitario/i), "9.1");
    await user.click(screen.getByRole("button", { name: /registrar precio/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        newCostRef: 9.1,
        newPackCostRef: undefined,
        notes: undefined,
        origin: "cotizacion",
        priceInputMode: "unit",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it("registers a pack price and converts it to unit cost", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(
      <RegisterSupplierPriceModal
        onOpenChange={onOpenChange}
        open
        supplierProduct={supplierProduct}
      />,
    );

    await user.click(screen.getByRole("button", { name: /empaque \(bulto 12 und\)/i }));
    await user.type(screen.getByLabelText(/precio del empaque/i), "109.2");
    expect(screen.getByText(/costo unitario calculado/i)).toHaveTextContent("$9.10");

    await user.click(screen.getByRole("button", { name: /registrar precio/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        newCostRef: 9.1,
        newPackCostRef: 109.2,
        notes: "$109.20 ref / Bulto 12 und",
        origin: "cotizacion",
        priceInputMode: "pack",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
