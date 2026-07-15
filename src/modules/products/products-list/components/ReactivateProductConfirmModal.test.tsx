import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockMutateAsync = jest.fn();

jest.mock("../../hooks/useProducts", () => ({
  useUpdateProduct: () => ({
    error: null,
    isPending: false,
    mutateAsync: mockMutateAsync,
  }),
}));

import { ReactivateProductConfirmModal } from "./ReactivateProductConfirmModal";

import { mockCategories, mockProducts } from "@/shared/mocks/erp-data";

import type { ProductWithCategory } from "../../hooks/useProducts";

const product: ProductWithCategory = {
  ...mockProducts.find((item) => item.id === "prod-drill")!,
  category: mockCategories.find((category) => category.id === "cat-tools"),
  isActive: false,
};

describe("ReactivateProductConfirmModal", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ ...product, isActive: true });
  });

  it("shows reactivation confirmation copy for the selected product", () => {
    render(
      <ReactivateProductConfirmModal onOpenChange={jest.fn()} open product={product} />,
    );

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/taladro percutor/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /reactivar producto/i })).toBeVisible();
  });

  it("reactivates the product when confirmed", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    const onSuccess = jest.fn();

    render(
      <ReactivateProductConfirmModal
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open
        product={product}
      />,
    );

    await user.click(screen.getByRole("button", { name: /reactivar producto/i }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({ isActive: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });
});
