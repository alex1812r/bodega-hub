import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import type { SupplierProductAlias } from "../../types/supplierProductAliases";

const mockAuth: { permissions: string[] } = { permissions: [] };

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockAuth.permissions.includes(permission),
    isLoading: false,
  }),
}));

import { formatAliasPack, SupplierProductAliasesSection } from "./SupplierProductAliasesSection";

const SUPPLIER = "33333333-3333-4333-8333-333333333333";

function alias(overrides: Partial<SupplierProductAlias>): SupplierProductAlias {
  return {
    aliasNorm: "harina pan 1kg",
    hits: 3,
    id: "alias-1",
    inSupplierProducts: true,
    lastSeenAt: "2026-10-14T16:00:00.000Z",
    packLabel: "Bulto",
    productId: "prod-harina",
    productName: "Harina PAN",
    unitsPerPack: 20,
    ...overrides,
  };
}

let serverItems: SupplierProductAlias[] = [];
let deleteStatus = 200;
const calls: { method: string; url: string }[] = [];

function json(status: number, body: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

beforeEach(() => {
  calls.length = 0;
  deleteStatus = 200;
  mockAuth.permissions = ["purchases.view", "purchases.create"];
  serverItems = [
    alias({}),
    alias({ aliasNorm: "harina p a n bulto", hits: 1, id: "alias-2", packLabel: null, unitsPerPack: null }),
    alias({ aliasNorm: "taladro 500w", id: "alias-3", inSupplierProducts: false, productId: "prod-drill", productName: "Taladro" }),
  ];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    if (method === "DELETE") {
      if (deleteStatus !== 200) {
        return json(deleteStatus, { error: { code: "NOT_FOUND", message: "Alias no encontrado" } });
      }
      const id = decodeURIComponent(url.split("/").pop() ?? "");
      serverItems = serverItems.filter((item) => item.id !== id);
      return json(200, { data: { id } });
    }

    return json(200, { data: { items: serverItems } });
  }) as unknown as typeof fetch;
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SupplierProductAliasesSection productHref={(id) => `/products/${id}`} supplierId={SUPPLIER} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("SupplierProductAliasesSection", () => {
  it("agrupa por producto del proveedor y deja aparte \"Otros alias\" con empaque, veces y última vez", async () => {
    renderSection();

    const harina = await screen.findByRole("group", { name: "Alias de Harina PAN" });
    expect(within(harina).getAllByTestId("supplier-alias")).toHaveLength(2);
    expect(within(harina).getByText("harina pan 1kg")).toBeInTheDocument();
    expect(within(harina).getByText("Bulto × 20")).toBeInTheDocument();
    expect(within(harina).getByText("Visto 3 veces")).toBeInTheDocument();
    expect(within(harina).getByText("Visto 1 vez")).toBeInTheDocument();
    expect(within(harina).getByText("Por unidad")).toBeInTheDocument();
    expect(within(harina).getAllByText(/^Última vez /)).toHaveLength(2);

    const others = screen.getByRole("group", { name: "Otros alias" });
    expect(within(others).getByText("taladro 500w")).toBeInTheDocument();
    expect(within(others).getByRole("link", { name: "Taladro" })).toHaveAttribute("href", "/products/prod-drill");
    expect(calls[0]).toEqual({ method: "GET", url: `/api/contacts/${SUPPLIER}/product-aliases` });
  });

  it("estado vacío", async () => {
    serverItems = [];
    renderSection();

    expect(await screen.findByText("Aún no hay alias aprendidos de facturas")).toBeInTheDocument();
  });

  it("Quitar alias: acción directa sin diálogo nativo, aviso y la lista se vuelve a pedir", async () => {
    const confirmSpy = jest.spyOn(window, "confirm");
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Quitar alias «harina pan 1kg»" }));

    expect(await screen.findByText("Alias quitado: «harina pan 1kg»")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("harina pan 1kg")).not.toBeInTheDocument());
    expect(calls.map((call) => call.method)).toEqual(["GET", "DELETE", "GET"]);
    expect(calls[1].url).toBe(`/api/contacts/${SUPPLIER}/product-aliases/alias-1`);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("404 al quitar: aviso informativo y refresco de la lista", async () => {
    deleteStatus = 404;
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Quitar alias «taladro 500w»" }));

    expect(await screen.findByText("El alias ya no existe")).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
  });

  it("sin purchases.create no se muestra \"Quitar alias\"", async () => {
    mockAuth.permissions = ["purchases.view"];
    renderSection();

    await screen.findByText("harina pan 1kg");
    expect(screen.queryByRole("button", { name: /Quitar alias/ })).not.toBeInTheDocument();
  });

  it("sin purchases.view no pinta la sección ni consulta", () => {
    mockAuth.permissions = ["products.view"];
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });
});

describe("formatAliasPack", () => {
  it.each([
    [{ packLabel: "Caja", unitsPerPack: 12 }, "Caja × 12"],
    [{ packLabel: "Caja", unitsPerPack: null }, "Caja"],
    [{ packLabel: null, unitsPerPack: 6 }, "Empaque × 6"],
    [{ packLabel: null, unitsPerPack: null }, "Por unidad"],
  ])("%j → %s", (input, expected) => {
    expect(formatAliasPack(input)).toBe(expected);
  });
});
