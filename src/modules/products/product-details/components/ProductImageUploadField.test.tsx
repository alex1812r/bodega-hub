import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductImageUploadField } from "./ProductImageUploadField";

jest.mock("../../../../shared/components/ImageCropModal", () => ({
  ImageCropModal: () => null,
}));

function preview() {
  return screen.queryByAltText("Vista previa del producto");
}

describe("ProductImageUploadField · teclado (PRO-F13)", () => {
  it("the hidden file input is not a tab stop; the button is, and it opens the file picker", async () => {
    const user = userEvent.setup();
    const openPicker = jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

    try {
      const { container } = render(
        <>
          <ProductImageUploadField />
          <button type="button">Siguiente</button>
        </>,
      );
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      const uploadButton = screen.getByRole("button", { name: /Subir imagen/ });

      expect(fileInput).toHaveAttribute("tabindex", "-1");
      expect(fileInput).toHaveAttribute("aria-hidden", "true");

      await user.tab();
      expect(uploadButton).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(openPicker).toHaveBeenCalledTimes(1);
      expect(openPicker.mock.contexts[0]).toBe(fileInput);

      // El siguiente Tab sale del campo: no se detiene en el input oculto.
      await user.tab();
      expect(screen.getByRole("button", { name: "Siguiente" })).toHaveFocus();
    } finally {
      openPicker.mockRestore();
    }
  });
});

describe("ProductImageUploadField · vista previa", () => {
  it("shows the saved image, or the empty state without one", () => {
    const { unmount } = render(<ProductImageUploadField imageUrl="https://cdn.test/a.webp" />);
    expect(preview()).toHaveAttribute("src", "https://cdn.test/a.webp");
    expect(screen.getByRole("button", { name: /Cambiar imagen/ })).toBeVisible();
    unmount();

    render(<ProductImageUploadField />);
    expect(preview()).not.toBeInTheDocument();
    expect(screen.getByText("Sin imagen")).toBeVisible();
    expect(screen.getByRole("button", { name: /Subir imagen/ })).toBeVisible();
  });

  it("follows the imageUrl prop when it changes", () => {
    const { rerender } = render(<ProductImageUploadField imageUrl="https://cdn.test/a.webp" />);

    rerender(<ProductImageUploadField imageUrl="https://cdn.test/b.webp" />);
    expect(preview()).toHaveAttribute("src", "https://cdn.test/b.webp");

    rerender(<ProductImageUploadField imageUrl={null} />);
    expect(preview()).not.toBeInTheDocument();
    expect(screen.getByText("Sin imagen")).toBeVisible();
  });

  it("keeps a removed preview hidden until imageUrl actually changes", async () => {
    const user = userEvent.setup();
    const onRemove = jest.fn();
    const { rerender } = render(
      <ProductImageUploadField imageUrl="https://cdn.test/a.webp" onRemove={onRemove} />,
    );

    await user.click(screen.getByRole("button", { name: /Quitar/ }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(preview()).not.toBeInTheDocument();

    rerender(<ProductImageUploadField imageUrl="https://cdn.test/a.webp" onRemove={onRemove} />);
    expect(preview()).not.toBeInTheDocument();

    rerender(<ProductImageUploadField imageUrl="https://cdn.test/b.webp" onRemove={onRemove} />);
    expect(preview()).toHaveAttribute("src", "https://cdn.test/b.webp");
  });
});
