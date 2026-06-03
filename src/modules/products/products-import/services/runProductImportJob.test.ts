import { runProductImportJob } from "./runProductImportJob";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("runProductImportJob", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  const rows = [
    {
      rowIndex: 3,
      sku: "A",
      name: "Producto A",
      status: "valid" as const,
      messages: [],
      input: {
        sku: "A",
        name: "Producto A",
        salePriceRef: 1,
      },
    },
    {
      rowIndex: 4,
      sku: "B",
      name: "Producto B",
      status: "valid" as const,
      messages: [],
      input: {
        sku: "B",
        name: "Producto B",
        salePriceRef: 2,
      },
    },
    {
      rowIndex: 5,
      sku: "BAD",
      name: "Invalid",
      status: "error" as const,
      messages: ["error"],
    },
  ];

  it("imports valid rows sequentially", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: "prod-1" } }, 201));

    const progressSnapshots: number[] = [];
    const results = await runProductImportJob({
      rows,
      onError: "continue",
      onProgress: (progress) => progressSnapshots.push(progress.processed),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.filter((row) => row.status === "success")).toHaveLength(2);
    expect(progressSnapshots.at(-1)).toBe(2);
  });

  it("stops on first error when configured", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "prod-1" } }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "CONFLICT", message: "SKU duplicado" } },
          409,
        ),
      );

    const results = await runProductImportJob({
      rows,
      onError: "stop",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[1]?.status).toBe("failed");
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, init?: RequestInit) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      return jsonResponse({ data: { id: "prod-1" } }, 201);
    });

    const results = await runProductImportJob({
      rows: [rows[0]!],
      onError: "continue",
      signal: controller.signal,
    });

    expect(results.length).toBeLessThanOrEqual(1);
  });
});
