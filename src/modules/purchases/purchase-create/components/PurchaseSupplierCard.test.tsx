import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

/**
 * COM-10 · el proveedor de la compra se busca en servidor.
 * COM-F9 · contra `GET /api/purchases/suppliers` (permiso `purchases.create`), nunca
 * contra `/api/contacts`, que el rol almacén no puede leer.
 */

const mockApiFetch = jest.fn();

jest.mock("../../../../shared/api/apiFetch", () => ({
  ...jest.requireActual("../../../../shared/api/apiFetch"),
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { PurchaseSupplierCard } from "./PurchaseSupplierCard";

const SUPPLIERS_PATH = "/api/purchases/suppliers";

const norte = {
  id: "sup-norte",
  isActive: true,
  name: "Distribuidora Norte C.A.",
  taxId: "J-12345678-9",
};

type FetchOptions = { query?: { id?: string } };

/** Como el BFF: con `id` un proveedor, sin él la página de la búsqueda. */
function respondWith(suppliers: Array<typeof norte>) {
  mockApiFetch.mockImplementation(async (path: string, options?: FetchOptions) => {
    if (path !== SUPPLIERS_PATH) {
      throw new Error(`Petición no esperada: ${path}`);
    }

    const id = options?.query?.id;

    if (id === undefined) {
      return { items: suppliers, limit: 8, skip: 0, total: suppliers.length };
    }

    const supplier = suppliers.find((item) => item.id === id);

    if (!supplier) {
      throw new Error("Proveedor no encontrado.");
    }

    return supplier;
  });
}

function contactsCalls() {
  return mockApiFetch.mock.calls.filter(([path]) => String(path).startsWith("/api/contacts"));
}

function lookupCalls() {
  return mockApiFetch.mock.calls.filter(
    ([path, options]) => path === SUPPLIERS_PATH && (options as FetchOptions)?.query?.id,
  );
}

function Harness({
  initialId,
  onSupplierChange,
}: {
  initialId: string;
  /** Devuelve `false` para no aceptar el cambio (la página pregunta antes de aplicarlo). */
  onSupplierChange: (id: string, name?: string) => boolean | void;
}) {
  const [supplierId, setSupplierId] = useState(initialId);

  return (
    <PurchaseSupplierCard
      onSupplierChange={(id, name) => {
        if (onSupplierChange(id, name) !== false) {
          setSupplierId(id);
        }
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
    respondWith([norte]);
  });

  it("busca en el endpoint de compras, no en contactos, y avisa del id y el nombre elegidos", async () => {
    const user = userEvent.setup();
    const { onSupplierChange } = renderCard();

    expect(supplierInput().tagName).toBe("INPUT");
    expect(document.querySelector("select")).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();

    await user.type(supplierInput(), "nor");

    const option = await screen.findByRole("option", { name: /distribuidora norte/i });

    expect(mockApiFetch).toHaveBeenCalledWith(
      SUPPLIERS_PATH,
      expect.objectContaining({ query: { limit: 8, search: "nor" } }),
    );
    expect(contactsCalls()).toEqual([]);
    expect(option).toHaveTextContent("J-12345678-9");

    await user.click(option);

    expect(onSupplierChange).toHaveBeenCalledWith("sup-norte", "Distribuidora Norte C.A.");
    expect(supplierInput()).toHaveValue("Distribuidora Norte C.A.");
    // El nombre ya lo trae la opción elegida: no se relee el proveedor.
    expect(lookupCalls()).toEqual([]);
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

  it("si la página no acepta el cambio, sigue mostrando el proveedor anterior sin releerlo (COM-F3)", async () => {
    const user = userEvent.setup();
    const sur = { ...norte, id: "sup-sur", name: "Distribuidora Sur C.A." };
    const { onSupplierChange } = renderCard();

    respondWith([norte, sur]);

    await user.type(supplierInput(), "dis");
    await user.click(await screen.findByRole("option", { name: /distribuidora norte/i }));
    expect(supplierInput()).toHaveValue("Distribuidora Norte C.A.");

    // Desde aquí la página retiene los cambios (pregunta antes de quitar las líneas).
    onSupplierChange.mockReturnValue(false);

    await user.clear(supplierInput());
    await user.type(supplierInput(), "dis");
    await user.click(await screen.findByRole("option", { name: /distribuidora sur/i }));

    expect(onSupplierChange).toHaveBeenLastCalledWith("sup-sur", "Distribuidora Sur C.A.");
    expect(supplierInput()).toHaveValue("Distribuidora Norte C.A.");

    await user.click(screen.getByRole("button", { name: "Limpiar Proveedor" }));

    expect(onSupplierChange).toHaveBeenLastCalledWith("", undefined);
    expect(lookupCalls()).toEqual([]);
    expect(contactsCalls()).toEqual([]);
  });

  it("resuelve por id en el endpoint de compras el nombre del proveedor que llega por props, con estado neutro mientras carga", async () => {
    const resolvers: Array<(value: unknown) => void> = [];

    mockApiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    renderCard("sup-norte");

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(SUPPLIERS_PATH, { query: { id: "sup-norte" } });
    expect(supplierInput()).toHaveValue("");
    expect(supplierInput()).toHaveAttribute("placeholder", "Cargando proveedor…");

    resolvers[0](norte);

    expect(await screen.findByDisplayValue("Distribuidora Norte C.A.")).toBe(supplierInput());
  });

  it("muestra el nombre de un proveedor inactivo que llega por props", async () => {
    respondWith([{ ...norte, isActive: false }]);

    renderCard("sup-norte");

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
    renderCard("sup-borrado");

    expect(await screen.findByText("Proveedor no encontrado.")).toBeInTheDocument();
    expect(supplierInput()).toBeInvalid();
    expect(contactsCalls()).toEqual([]);
  });
});
