import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * SCN-07 · «Escanear factura» en la compra nueva: solo con `purchases.create`,
 * `?scan=1` lo abre al entrar (y se limpia de la URL) y el `ProcessGuard` nombra
 * el escaneo mientras está en curso. El modal se reduce a botones: sus tests son aparte.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCan = jest.fn();
// Referencia estable: un catálogo nuevo en cada render reinicia los metadatos de línea sin fin.
const mockSearchResult = { catalog: [], error: null, isSearching: false };

function mockBuildTaxRate(code: string, label: string, pct: number, sortOrder: number) {
  return { code, id: `tax-${code}`, isActive: true, isDefault: code === "general", isGlobal: true, label, pct, sortOrder };
}

const mockTaxCatalog = {
  error: null,
  isLoading: false,
  rates: [mockBuildTaxRate("exento", "Exento", 0, 10), mockBuildTaxRate("general", "General", 16, 30)],
  refetch: jest.fn(),
};

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 510 }, error: null }),
}));
jest.mock("../../settings/hooks/useSettings", () => ({
  settingsQueryKeys: { paymentMethods: () => ["settings", "payment-methods"] },
  usePricingSettings: () => ({ data: undefined }),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockCan(permission),
    isLoading: false,
    profile: { storeId: "store-1", user: { id: "user-1" } },
  }),
}));
jest.mock("../../../shared/hooks/useTaxRates", () => ({
  useTaxRates: () => mockTaxCatalog,
}));
jest.mock("./hooks/usePurchaseProductSearch", () => ({
  usePurchaseProductSearch: () => mockSearchResult,
}));
jest.mock("./components/PurchaseSupplierCard", () => ({
  PurchaseSupplierCard: () => null,
}));
jest.mock("../../invoice-scan/client/components/InvoiceScanModal", () => ({
  InvoiceScanModal: ({
    onBusyChange,
    onOpenChange,
    onScanned,
  }: {
    onBusyChange: (busy: boolean) => void;
    onOpenChange: (open: boolean) => void;
    onScanned: (response: unknown) => void;
  }) => (
    <div data-testid="invoice-scan-modal">
      <button onClick={() => onBusyChange(true)} type="button">
        empezar escaneo
      </button>
      <button onClick={() => onBusyChange(false)} type="button">
        terminar escaneo
      </button>
      <button onClick={() => onScanned({ scanId: "scan-1" })} type="button">
        factura leída
      </button>
      <button onClick={() => onOpenChange(false)} type="button">
        cerrar escaneo
      </button>
    </div>
  ),
}));

import { createQueryWrapper, installFetchStub } from "@/modules/inventory/utils/requestAttempt.testUtils";
import { ToastProvider } from "@/shared/components/Toast";
import Link from "next/link";

import { PurchaseCreatePage } from "./page";

function renderPage() {
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <Link href="/sales">Ventas</Link>
        <PurchaseCreatePage />
      </ToastProvider>
    </QueryWrapper>,
  );

  return userEvent.setup({ delay: null });
}

function scanButton() {
  return screen.queryByRole("button", { name: "Escanear factura" });
}

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockCan.mockReset();
  mockCan.mockReturnValue(true);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/purchases/create");
  installFetchStub(() => null);
});

describe("PurchaseCreatePage · Escanear factura (SCN-07)", () => {
  it("con purchases.create el botón abre el modal de escaneo", async () => {
    const user = renderPage();

    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();

    await user.click(scanButton() as HTMLElement);

    expect(screen.getByTestId("invoice-scan-modal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "cerrar escaneo" }));

    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("sin purchases.create no hay botón «Escanear factura»", () => {
    mockCan.mockImplementation((permission: string) => permission !== "purchases.create");
    renderPage();

    expect(scanButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("?scan=1 abre el modal al entrar y quita el parámetro con router.replace sin scroll", async () => {
    window.history.replaceState(null, "", "/purchases/create?scan=1&returnTo=%2Fpurchases");
    renderPage();

    expect(await screen.findByTestId("invoice-scan-modal")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/purchases/create?returnTo=%2Fpurchases", { scroll: false });
  });

  it("?scan=1 sin purchases.create no abre nada, pero limpia la URL", async () => {
    mockCan.mockImplementation((permission: string) => permission !== "purchases.create");
    window.history.replaceState(null, "", "/purchases/create?scan=1");
    renderPage();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/purchases/create", { scroll: false }));
    expect(screen.queryByTestId("invoice-scan-modal")).not.toBeInTheDocument();
  });

  it("sin scan en la URL no navega", () => {
    renderPage();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("con un escaneo en curso el guardia nombra el escaneo; al terminar deja de preguntar", async () => {
    const user = renderPage();

    await user.click(scanButton() as HTMLElement);
    await user.click(screen.getByRole("button", { name: "empezar escaneo" }));

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    expect(guard).toHaveTextContent("Escaneo de factura en curso");
    expect(guard).toHaveTextContent("Si sales ahora, la lectura de la factura se cancela.");

    await user.click(within(guard).getByRole("button", { name: "Seguir aquí" }));
    await user.click(screen.getByRole("button", { name: "factura leída" }));
    await user.click(screen.getByRole("button", { name: "terminar escaneo" }));

    fireEvent.click(screen.getByRole("link", { name: "Ventas" }));

    expect(screen.queryByRole("dialog", { name: "¿Salir sin terminar?" })).not.toBeInTheDocument();
  });
});
