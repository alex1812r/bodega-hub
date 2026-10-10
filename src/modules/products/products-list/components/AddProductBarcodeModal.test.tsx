import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProductWithCategory } from "@/modules/products/hooks/useProducts";

import { AddProductBarcodeModal } from "./AddProductBarcodeModal";

const mutateAsync = jest.fn();

jest.mock("../../hooks/useProducts", () => ({
  useAddProductBarcode: () => ({ isPending: false, mutateAsync }),
}));

jest.mock("../../../sales/sale-create/components/PosCameraBarcodeScanner", () => ({
  PosCameraBarcodeScanner: () => <div data-testid="camera" />,
}));

const harina = { id: "prod-1", name: "Harina" } as ProductWithCategory;
const arroz = { id: "prod-2", name: "Arroz" } as ProductWithCategory;

function modal(product: ProductWithCategory | null, open: boolean, onOpenChange = jest.fn()) {
  return <AddProductBarcodeModal onOpenChange={onOpenChange} open={open} product={product} />;
}

async function fillFormWithError(user: ReturnType<typeof userEvent.setup>) {
  mutateAsync.mockRejectedValueOnce(new Error("Codigo duplicado"));
  await user.type(screen.getByLabelText("Código de barras"), "7591234567890");
  await user.click(screen.getByRole("button", { name: "Abrir cámara para escanear" }));
  await user.click(screen.getByRole("button", { name: "Guardar código" }));
  expect(await screen.findByText("Codigo duplicado")).toBeVisible();
  expect(screen.getByTestId("camera")).toBeInTheDocument();
}

function expectPristine() {
  expect(screen.getByLabelText("Código de barras")).toHaveValue("");
  expect(screen.queryByText("Codigo duplicado")).not.toBeInTheDocument();
  expect(screen.queryByTestId("camera")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Guardar código" })).toBeDisabled();
}

describe("AddProductBarcodeModal", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it("opens empty, with the camera closed and no error", () => {
    render(modal(harina, true));

    expectPristine();
    expect(screen.getByText(/Asigna el código de barras a .Harina./)).toBeVisible();
  });

  it("saves the normalized barcode and asks to close", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    mutateAsync.mockResolvedValueOnce({});
    render(modal(harina, true, onOpenChange));

    await user.type(screen.getByLabelText("Código de barras"), " 7591234567890 ");
    await user.click(screen.getByRole("button", { name: "Guardar código" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mutateAsync).toHaveBeenCalledWith({ barcode: "7591234567890" });
  });

  it("resets barcode, camera and error when it is closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(harina, true));

    await fillFormWithError(user);
    rerender(modal(harina, false));
    rerender(modal(harina, true));

    expectPristine();
  });

  it("resets barcode, camera and error when the product changes while open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(harina, true));

    await fillFormWithError(user);
    rerender(modal(arroz, true));

    expectPristine();
    expect(screen.getByText(/Asigna el código de barras a .Arroz./)).toBeVisible();
  });
});
