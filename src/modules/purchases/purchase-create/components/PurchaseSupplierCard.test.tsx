import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

/** COM-10 · el proveedor de la compra se busca en servidor. */

const mockApiFetch = jest.fn();

jest.mock("../../../../shared/api/apiFetch", () => ({
  ...jest.requireActual("../../../../shared/api/apiFetch"),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { PurchaseSupplierCard } from "./PurchaseSupplierCard";

const norte = {
  id: "sup-norte",
  isActive: true,
  name: "Distribuidora Norte C.A.",
  phone: "0412-0000000",
  taxId: "J-12345678-9",
  type: "proveedor",
};

function Harness({
  initialId,
  onSupplierChange,
}: {
  initialId: string;
  onSupplierChange: (id: string, name?: string) => void;
}) {
  const [supplierId, setSupplierId] = useState(initialId);

  return (
    <PurchaseSupplierCard
      onSupplierChange={(id, name) => {
        setSupplierId(id);
        onSupplierChange(id, name);
      }}
      selectedSupplierId={supplierId}
    />
  );
}

function renderCard(initialId = "") {
  const onSupplierChange = jest.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <Harness initialId={initialId} onSupplierChange={onSupplierChange} />
    </QueryClientProvider>,
  );

  return { onSupplierChange };
}

function supplierInput() {
  return screen.getByRole("combobox", { name: /proveedor/i });
}

describe("PurchaseSupplierCard", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async (path: string) =>
      path === "/api/contacts" ? { items: [norte], limit: 8, skip: 0, total: 1 } : norte,
    );
  });

  it("busca en servidor proveedores activos y avisa del id y el nombre elegidos", async () => {
    const user = userEvent.setup();
    const { onSupplierChange } = renderCard();

    expect(supplierInput().tagName).toBe("INPUT");
    expect(document.querySelector("select")).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();

    await user.type(supplierInput(), "nor");

    const option = await screen.findByRole("option", { name: /distribuidora norte/i });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/contacts",
      expect.objectContaining({
        query: expect.objectContaining({ isActive: true, search: "nor", type: "proveedor" }),
      }),
    );
    expect(option).toHaveTextContent("Proveedor · 0412-0000000");

    await user.click(option);

    expect(onSupplierChange).toHaveBeenCalledWith("sup-norte", "Distribuidora Norte C.A.");
    expect(supplierInput()).toHaveValue("Distribuidora Norte C.A.");
    // El nombre ya lo trae la opción elegida: no se relee el contacto.
    expect(mockApiFetch).not.toHaveBeenCalledWith("/api/contacts/sup-norte");
  });

  it("limpiar la selección avisa con cadena vacía", async () => {
    const user = userEvent.setup();
    const { onSupplierChange } = renderCard();

    await user.type(supplierInput(), "nor");
    await user.click(await screen.findByRole("option", { name: /distribuidora norte/i }));
    await user.click(screen.getByRole("button", { name: "Limpiar Proveedor" }));

    expect(onSupplierChange).toHaveBeenLastCalledWith("", undefined);
    expect(supplierInput()).toHaveValue("");
  });

  it("muestra el nombre cuando el id llega por props, con estado neutro mientras carga", async () => {
    const resolvers: Array<(value: unknown) => void> = [];

    mockApiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    renderCard("sup-norte");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/contacts/sup-norte");
    expect(supplierInput()).toHaveValue("");
    expect(supplierInput()).toHaveAttribute("placeholder", "Cargando proveedor…");

    resolvers[0](norte);

    expect(await screen.findByDisplayValue("Distribuidora Norte C.A.")).toBe(supplierInput());
  });

  it("permite limpiar un proveedor que llegó por props", async () => {
    const user = userEvent.setup();
    const { onSupplierChange } = renderCard("sup-norte");

    await screen.findByDisplayValue("Distribuidora Norte C.A.");
    await user.click(screen.getByRole("button", { name: "Limpiar Proveedor" }));

    expect(onSupplierChange).toHaveBeenCalledWith("", undefined);
    expect(supplierInput()).toHaveValue("");
  });

  it("muestra el error del servidor si el proveedor recibido no se puede leer", async () => {
    mockApiFetch.mockRejectedValue(new Error("El contacto no existe."));

    renderCard("sup-borrado");

    expect(await screen.findByText("El contacto no existe.")).toBeInTheDocument();
    expect(supplierInput()).toBeInvalid();
  });
});
