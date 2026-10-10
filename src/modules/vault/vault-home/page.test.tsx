/**
 * GQ-03 · el Baúl no pide lo que el rol no puede leer: los modales de operación
 * (y con ellos `GET /api/cash/closures/pending`, que exige `vault.manage`) solo
 * se montan para quien puede operar el baúl. El contador (`vault.view`) recibía
 * un 403 con solo abrir la pantalla.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";

import type { Permission } from "@/shared/auth/permissions";

let mockPermissions: Permission[] = [];

jest.mock("next/navigation", () => ({
  usePathname: () => "/vault",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: Permission) => mockPermissions.includes(permission),
    isLoading: false,
  }),
}));

import { createQueryWrapper, jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

import { VaultHomePage } from "./page";

const VAULT = { balanceEfectivoVes: 100, balanceRef: 20, balanceVes: 300 };

function installApi() {
  const fetchMock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);

    return Promise.resolve(jsonResponse({ data: url === "/api/vault" ? VAULT : [] }));
  });

  global.fetch = fetchMock as unknown as typeof fetch;

  return () => fetchMock.mock.calls.map(([input]) => String(input));
}

describe("VaultHomePage · peticiones por permiso (GQ-03)", () => {
  const originalMatchMedia = window.matchMedia;

  beforeAll(() => {
    // jsdom no trae matchMedia; la tabla lo usa para elegir tabla o tarjetas.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        matches: false,
        media: query,
        removeEventListener: () => undefined,
      }),
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("con solo vault.view no pide los cierres pendientes ni ofrece operaciones", async () => {
    mockPermissions = ["vault.view"];

    const requested = installApi();

    render(<VaultHomePage />, { wrapper: createQueryWrapper() });

    await waitFor(() => expect(requested()).toContain("/api/vault"));
    await screen.findByText("Sin movimientos");

    expect(requested()).not.toContain("/api/cash/closures/pending");
    expect(screen.queryByRole("button", { name: "Operaciones del baúl" })).not.toBeInTheDocument();
  });

  it("con vault.manage ofrece las operaciones y carga los cierres pendientes", async () => {
    mockPermissions = ["vault.view", "vault.manage"];

    const requested = installApi();

    render(<VaultHomePage />, { wrapper: createQueryWrapper() });

    expect(await screen.findByRole("button", { name: "Operaciones del baúl" })).toBeInTheDocument();
    await waitFor(() => expect(requested()).toContain("/api/cash/closures/pending"));
  });
});
