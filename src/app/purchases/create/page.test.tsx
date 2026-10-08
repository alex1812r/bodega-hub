/**
 * COM-F6 · `/purchases/create` exige `purchases.create`. El contador ve Compras
 * (`purchases.view`) pero no puede registrar una: recibe la pantalla de sin acceso y el
 * formulario no llega a montarse (ni a lanzar sus consultas).
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { rolePermissions, type StoreUserRole } from "@bodega/core";

let mockRole: StoreUserRole = "contador";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../modules/auth/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    data: {
      deniedPermissions: [],
      grantedPermissions: [],
      permissions: rolePermissions[mockRole],
      role: mockRole,
      user: { id: "user-1", isActive: true, name: "Usuario de prueba" },
    },
    isError: false,
    isLoading: false,
  }),
}));
jest.mock("../../../modules/auth/hooks/useLogout", () => ({
  useLogout: () => ({ mutate: jest.fn() }),
}));
jest.mock("../../../modules/settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, isError: false }),
}));
jest.mock("../../../shared/components/AppShell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
jest.mock("../../../modules/purchases/purchase-create/page", () => ({
  PurchaseCreatePage: () => <p>formulario de compra</p>,
}));

import Page from "./page";

describe("/purchases/create · permiso de la ruta (COM-F6)", () => {
  it("el contador (sin purchases.create) ve la pantalla de sin acceso y el formulario no se monta", () => {
    mockRole = "contador";
    render(<Page />);

    expect(screen.getByText("No tienes permiso para acceder")).toBeInTheDocument();
    expect(screen.queryByText("formulario de compra")).not.toBeInTheDocument();
  });

  it("almacén y admin (con purchases.create) entran al formulario", () => {
    for (const role of ["almacen", "admin"] as const) {
      mockRole = role;

      const { unmount } = render(<Page />);

      expect(screen.getByText("formulario de compra")).toBeInTheDocument();
      expect(screen.queryByText("No tienes permiso para acceder")).not.toBeInTheDocument();
      unmount();
    }
  });
});
