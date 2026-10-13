import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** COM-10 · el proveedor se busca en servidor, sin select con la lista completa. */

const mockMutateAsync = jest.fn();
const mockApiFetch = jest.fn();

jest.mock("../../hooks/useSupplierProductMutations", () => ({
  useCreateSupplierProduct: () => ({ isPending: false, mutateAsync: mockMutateAsync }),
}));

jest.mock("../../../products/hooks/useProducts", () => ({
  useProducts: () => ({ data: undefined, isFetching: false }),
}));

jest.mock("../../../../shared/api/apiFetch", () => ({
  ...jest.requireActual("../../../../shared/api/apiFetch"),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { LinkSupplierProductModal } from "./LinkSupplierProductModal";

const contactsPage = {
  items: [
    {
      id: "sup-polar",
      isActive: true,
      name: "Alimentos Polar",
      phone: "0212-5550000",
      taxId: "J-00041312-6",
      type: "proveedor",
    },
    {
      id: "cli-polar",
      isActive: true,
      name: "Polar Cliente",
      phone: "",
      taxId: "",
      type: "cliente",
    },
  ],
  limit: 8,
  skip: 0,
  total: 2,
};

function renderFromProduct() {
  return render(
    <LinkSupplierProductModal
      onOpenChange={jest.fn()}
      open
      productId="prod-harina"
      productName="Harina PAN"
      productSku="har-001"
      supplierId=""
    />,
  );
}

function supplierInput() {
  return screen.getByRole("combobox", { name: /proveedor/i });
}

describe("LinkSupplierProductModal", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({});
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue(contactsPage);
  });

  it("no pinta un select nativo de proveedor ni carga la lista al abrir", () => {
    renderFromProduct();

    const dialog = screen.getByRole("dialog");

    expect(supplierInput().tagName).toBe("INPUT");
    expect(dialog.querySelector("select")).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("busca proveedores activos en servidor al escribir y envía el id elegido", async () => {
    const user = userEvent.setup();

    renderFromProduct();

    await user.type(supplierInput(), "pol");

    const option = await screen.findByRole("option", { name: /alimentos polar/i });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/contacts",
      expect.objectContaining({
        query: expect.objectContaining({ isActive: true, search: "pol", type: "proveedor" }),
      }),
    );
    // Detalle secundario por defecto del componente: tipo · teléfono.
    expect(option).toHaveTextContent("Proveedor · 0212-5550000");
    // Un cliente que devolviera el servidor no se ofrece como proveedor.
    expect(screen.queryByRole("option", { name: /polar cliente/i })).not.toBeInTheDocument();

    await user.click(option);

    expect(supplierInput()).toHaveValue("Alimentos Polar");

    await user.click(screen.getByRole("button", { name: "Vincular proveedor" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        lastCostRef: undefined,
        notes: undefined,
        productId: "prod-harina",
        supplierId: "sup-polar",
        supplierSku: undefined,
      });
    });
  });

  it("sin proveedor elegido no envía y muestra el mensaje en el campo", async () => {
    const user = userEvent.setup();

    renderFromProduct();

    await user.click(screen.getByRole("button", { name: "Vincular proveedor" }));

    expect(await screen.findByText("Selecciona un proveedor.")).toBeInTheDocument();
    expect(supplierInput()).toBeInvalid();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("al limpiar el proveedor elegido vuelve a exigirlo", async () => {
    const user = userEvent.setup();

    renderFromProduct();

    await user.type(supplierInput(), "pol");
    await user.click(await screen.findByRole("option", { name: /alimentos polar/i }));
    await user.click(screen.getByRole("button", { name: "Limpiar Proveedor" }));
    await user.click(screen.getByRole("button", { name: "Vincular proveedor" }));

    expect(await screen.findByText("Selecciona un proveedor.")).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("abierto desde el contacto usa el proveedor fijo y no ofrece buscador de proveedor", () => {
    render(
      <LinkSupplierProductModal
        onOpenChange={jest.fn()}
        open
        supplierId="sup-polar"
        supplierName="Alimentos Polar"
      />,
    );

    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByRole("combobox", { name: /proveedor/i })).not.toBeInTheDocument();
    expect(dialog.querySelector("select")).toBeNull();
  });
});
