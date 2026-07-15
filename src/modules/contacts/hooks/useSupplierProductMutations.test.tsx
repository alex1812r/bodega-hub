import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useCreateSupplierProduct,
  useDeactivateSupplierProduct,
  useRegisterSupplierPrice,
  useUpdateSupplierProductMetadata,
} from "./useSupplierProductMutations";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

describe("useSupplierProductMutations", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("creates a supplier-product link", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          data: {
            id: "supp-prod-new",
            productId: "prod-paint",
            supplierId: "cont-supplier",
          },
        },
        201,
      ),
    );

    const { result } = renderHook(() => useCreateSupplierProduct(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      productId: "prod-paint",
      supplierId: "cont-supplier",
      supplierSku: "SUP-PAINT",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/supplier-products",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updates supplier-product metadata", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "supp-prod-cable",
          notes: "Actualizado",
          productId: "prod-cable",
          supplierId: "cont-supplier",
          supplierSku: "SUP-CAB-V2",
        },
      }),
    );

    const { result } = renderHook(() => useUpdateSupplierProductMetadata("supp-prod-cable"), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ notes: "Actualizado", supplierSku: "SUP-CAB-V2" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/supplier-products/supp-prod-cable",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("registers a supplier price quotation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          supplierProduct: {
            id: "supp-prod-drill",
            lastCostRef: 9.1,
            productId: "prod-drill",
            supplierId: "cont-both",
          },
          variationPercent: 7.06,
        },
      }),
    );

    const { result } = renderHook(() => useRegisterSupplierPrice("supp-prod-drill"), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      newCostRef: 9.1,
      notes: "Relevamiento",
      origin: "cotizacion",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/supplier-products/supp-prod-drill/prices",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deactivates a supplier-product relation", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "supp-prod-switch",
          isActive: false,
          productId: "prod-switch",
          supplierId: "cont-supplier",
        },
      }),
    );

    const { result } = renderHook(() => useDeactivateSupplierProduct("supp-prod-switch"), {
      wrapper: createWrapper(),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/supplier-products/supp-prod-switch/deactivate",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
