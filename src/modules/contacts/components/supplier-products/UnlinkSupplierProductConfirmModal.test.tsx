import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockMutateAsync = jest.fn();

jest.mock("../../hooks/useSupplierProductMutations", () => ({
  useDeactivateSupplierProduct: () => ({
    isPending: false,
    mutateAsync: mockMutateAsync,
  }),
}));

import { UnlinkSupplierProductConfirmModal } from "./UnlinkSupplierProductConfirmModal";

import { mockContacts, mockProducts } from "@/shared/mocks/erp-data";

import type { SupplierProduct } from "../../types/supplierProducts";

const supplierProduct: SupplierProduct = {
  id: "supp-prod-drill",
  isActive: true,
  lastCostRef: 8.5,
  product: mockProducts.find((product) => product.id === "prod-drill"),
  productId: "prod-drill",
  supplier: mockContacts.find((contact) => contact.id === "cont-both"),
  supplierId: "cont-both",
};

describe("UnlinkSupplierProductConfirmModal", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ ...supplierProduct, isActive: false });
  });

  it("shows unlink confirmation copy for the selected relation", () => {
    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={jest.fn()}
        open
        supplierProduct={supplierProduct}
      />,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/taladro percutor/i)).toBeVisible();
    expect(screen.getByText(/comercial doble via/i)).toBeVisible();
  });

  it("deactivates the relation when confirmed", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    const onSuccess = jest.fn();

    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open
        supplierProduct={supplierProduct}
      />,
    );

    await user.click(screen.getByRole("button", { name: /desvincular producto/i }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });
});
