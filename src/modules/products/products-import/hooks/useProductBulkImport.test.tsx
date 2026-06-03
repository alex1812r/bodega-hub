import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { useProductBulkImport } from "./useProductBulkImport";

jest.mock("../services/fetchExistingSkus", () => ({
  fetchExistingSkus: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock("../services/buildProductImportTemplate", () => ({
  downloadProductImportTemplateFromApi: jest.fn().mockResolvedValue(true),
}));

jest.mock("../services/parseProductImportWorkbook", () => ({
  parseProductImportWorkbook: jest.fn().mockReturnValue([
    {
      rowIndex: 3,
      sku: "BOD-001",
      name: "Chicle",
      status: "valid",
      messages: [],
      input: { sku: "BOD-001", name: "Chicle", salePriceRef: 2 },
    },
  ]),
}));

jest.mock("../services/runProductImportJob", () => ({
  runProductImportJob: jest.fn().mockResolvedValue([
    { rowIndex: 3, sku: "BOD-001", status: "success" },
  ]),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

describe("useProductBulkImport", () => {
  const categories = [{ id: "cat-1", name: "Chucherias", isActive: true }] as never[];

  beforeAll(() => {
    File.prototype.arrayBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(8));
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("parses file and moves to preview", async () => {
    const { result } = renderHook(() => useProductBulkImport({ categories }), {
      wrapper: createWrapper(),
    });

    const file = new File(["binary"], "productos.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await act(async () => {
      await result.current.parseFile(file);
    });

    await waitFor(() => expect(result.current.status).toBe("validated"));
    expect(result.current.step).toBe("preview");
    expect(result.current.validatedRows).toHaveLength(1);
  });

  it("runs import job and finishes in summary", async () => {
    const { result } = renderHook(() => useProductBulkImport({ categories }), {
      wrapper: createWrapper(),
    });

    const file = new File(["binary"], "productos.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await act(async () => {
      await result.current.parseFile(file);
    });

    await act(async () => {
      await result.current.startImport({ onError: "continue" });
    });

    expect(result.current.step).toBe("summary");
    expect(result.current.results).toHaveLength(1);
  });
});
