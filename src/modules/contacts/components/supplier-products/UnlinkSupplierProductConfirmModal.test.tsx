import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockMutateAsync = jest.fn();
const mockReset = jest.fn();
const mockRefetch = jest.fn();
const mockUsePriceHistory = jest.fn();
let mockDeactivateError: Error | null = null;

jest.mock("../../hooks/useSupplierProductMutations", () => ({
  useDeactivateSupplierProduct: () => ({
    error: mockDeactivateError,
    isPending: false,
    mutateAsync: mockMutateAsync,
    reset: mockReset,
  }),
}));

jest.mock("../../hooks/useSupplierProductPriceHistory", () => ({
  useSupplierProductPriceHistory: (...args: unknown[]) => mockUsePriceHistory(...args),
}));

import {
  buildUnlinkSupplierProductEffects,
  UnlinkSupplierProductConfirmModal,
} from "./UnlinkSupplierProductConfirmModal";

import { mockContacts, mockProducts } from "@/shared/mocks/erp-data";

import type { SupplierProduct } from "../../types/supplierProducts";

const supplierProduct: SupplierProduct = {
  id: "supp-prod-drill",
  isActive: true,
  isPreferred: true,
  lastCostRef: 8.5,
  packUnits: [
    {
      id: "pack-caja",
      isActive: true,
      isDefault: true,
      label: "Caja",
      supplierProductId: "supp-prod-drill",
      unitsPerPack: 12,
    },
    {
      id: "pack-bulto",
      isActive: true,
      isDefault: false,
      label: "Bulto",
      supplierProductId: "supp-prod-drill",
      unitsPerPack: 48,
    },
    {
      id: "pack-viejo",
      isActive: false,
      isDefault: false,
      label: "Display",
      supplierProductId: "supp-prod-drill",
      unitsPerPack: 6,
    },
  ],
  product: mockProducts.find((product) => product.id === "prod-drill"),
  productId: "prod-drill",
  supplier: mockContacts.find((contact) => contact.id === "cont-both"),
  supplierId: "cont-both",
};

function historyResult(total: number) {
  return {
    data: {
      items:
        total > 0
          ? [
              {
                createdAt: "2026-09-15T16:00:00.000Z",
                id: "hist-1",
                newCostRef: 8.5,
                origin: "compra",
                supplierProductId: "supp-prod-drill",
              },
            ]
          : [],
      limit: 1,
      skip: 0,
      total,
    },
    error: null,
    refetch: mockRefetch,
  };
}

function effectsList() {
  return screen.getByRole("list", { name: "Qué va a pasar" });
}

describe("UnlinkSupplierProductConfirmModal (CNF-12)", () => {
  beforeEach(() => {
    mockDeactivateError = null;
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ ...supplierProduct, isActive: false });
    mockReset.mockReset();
    mockRefetch.mockReset();
    mockUsePriceHistory.mockReset();
    mockUsePriceHistory.mockReturnValue(historyResult(7));
  });

  it("muestra el historial, los empaques y el habitual que dejarán de usarse", () => {
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

    const effects = effectsList();

    expect(effects).toHaveTextContent(/Vínculo con el proveedor.*Activo.*Inactivo/);
    expect(effects).toHaveTextContent(/Proveedor habitual del producto.*Habitual.*Deja de serlo/);
    expect(effects).toHaveTextContent(
      /Historial de precios de este proveedor.*7 registros · último ref 8\.50 el 15\/09\/2026.*Se conserva, sin uso/,
    );
    expect(effects).toHaveTextContent(/Empaque del proveedor.*Caja × 12 unidades.*Se conserva, sin uso/);
    expect(effects).toHaveTextContent("Bulto × 48 unidades");
    // Un empaque ya desactivado no está en uso: no se anuncia.
    expect(effects).not.toHaveTextContent("Display");
    expect(effects).toHaveTextContent(/Compras ya registradas.*No cambian/);
    // Se pide solo al abrir, el último registro y el total.
    expect(mockUsePriceHistory).toHaveBeenLastCalledWith("supp-prod-drill", { limit: 1 });
  });

  it("cerrado no consulta el historial", () => {
    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={jest.fn()}
        open={false}
        supplierProduct={supplierProduct}
      />,
    );

    expect(mockUsePriceHistory).toHaveBeenLastCalledWith(undefined, { limit: 1 });
  });

  it("sin habitual, sin historial y sin empaques lo dice sin inventar", () => {
    mockUsePriceHistory.mockReturnValue(historyResult(0));

    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={jest.fn()}
        open
        supplierProduct={{ ...supplierProduct, isPreferred: false, packUnits: [] }}
      />,
    );

    const effects = effectsList();

    expect(effects).not.toHaveTextContent("habitual");
    expect(effects).toHaveTextContent(/Historial de precios de este proveedor.*Sin registros/);
    expect(effects).toHaveTextContent(/Empaques del proveedor.*Ninguno/);
  });

  it("cancelar no desvincula", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={onOpenChange}
        open
        supplierProduct={supplierProduct}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("doble clic en confirmar desvincula una sola vez", async () => {
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

    await user.dblClick(screen.getByRole("button", { name: /desvincular producto/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("mientras carga el historial no ofrece confirmar", () => {
    mockUsePriceHistory.mockReturnValue({ data: undefined, error: null, refetch: mockRefetch });

    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={jest.fn()}
        open
        supplierProduct={supplierProduct}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Consultando el historial de precios…");
    expect(screen.queryByRole("button", { name: /desvincular producto/i })).not.toBeInTheDocument();
  });

  it("si el historial falla muestra el error, deja reintentar y no confirma a ciegas", async () => {
    const user = userEvent.setup();

    mockUsePriceHistory.mockReturnValue({
      data: undefined,
      error: new Error("Relacion proveedor-producto no encontrada."),
      refetch: mockRefetch,
    });

    render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={jest.fn()}
        open
        supplierProduct={supplierProduct}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Relacion proveedor-producto no encontrada.");
    expect(screen.queryByRole("button", { name: /desvincular producto/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("el error del servidor al desvincular se muestra tal cual", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    mockMutateAsync.mockImplementation(async () => {
      mockDeactivateError = new Error("No autorizado para desactivar relaciones proveedor-producto");
      throw mockDeactivateError;
    });

    const view = render(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={onOpenChange}
        open
        supplierProduct={supplierProduct}
      />,
    );

    await user.click(screen.getByRole("button", { name: /desvincular producto/i }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    view.rerender(
      <UnlinkSupplierProductConfirmModal
        onOpenChange={onOpenChange}
        open
        supplierProduct={supplierProduct}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No autorizado para desactivar relaciones proveedor-producto",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("buildUnlinkSupplierProductEffects", () => {
  it("un único registro y un empaque de una unidad van en singular", () => {
    const effects = buildUnlinkSupplierProductEffects(
      {
        isPreferred: false,
        packUnits: [
          {
            id: "pack-und",
            isActive: true,
            isDefault: true,
            label: "Unidad",
            supplierProductId: "supp-prod-drill",
            unitsPerPack: 1,
          },
        ],
      },
      { latest: { createdAt: "2026-09-15T16:00:00.000Z", newCostRef: 2 }, total: 1 },
    );

    expect(effects.map((effect) => effect.before)).toEqual(
      expect.arrayContaining(["1 registro · último ref 2.00 el 15/09/2026", "Unidad × 1 unidad"]),
    );
  });
});
