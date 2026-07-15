import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockMutateAsync = jest.fn();

jest.mock("../../hooks/useProducts", () => ({
  useUpdateProduct: () => ({
    isPending: false,
    mutateAsync: mockMutateAsync,
  }),
}));

import { DeactivateProductConfirmModal } from "./DeactivateProductConfirmModal";

import { mockCategories, mockProducts } from "@/shared/mocks/erp-data";

import type { ProductWithCategory } from "../../hooks/useProducts";

const product: ProductWithCategory = {
  ...mockProducts.find((item) => item.id === "prod-drill")!,
  category: mockCategories.find((category) => category.id === "cat-tools"),
};

describe("DeactivateProductConfirmModal", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ ...product, isActive: false });
  });

  it("shows deactivation confirmation copy for the selected product", () => {
    render(
      <DeactivateProductConfirmModal onOpenChange={jest.fn()} open product={product} />,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/taladro percutor/i)).toBeVisible();
    expect(screen.getByText(/HER-TAL-001/i)).toBeVisible();
  });

  it("deactivates the product when confirmed", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    const onSuccess = jest.fn();

    render(
      <DeactivateProductConfirmModal
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open
        product={product}
      />,
    );

    await user.click(screen.getByRole("button", { name: /desactivar producto/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({ isActive: false }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });
});
