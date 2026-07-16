/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET, POST } from "./route";

describe("/api/exchange-rates", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns exchange rates", async () => {
    const response = await GET(new Request("http://localhost/api/exchange-rates"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("filters exchange rates by date range", async () => {
    const response = await GET(
      new Request("http://localhost/api/exchange-rates?from=2026-05-18&to=2026-05-18"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].id).toBe("rate-today");
  });

  it("creates a simulated exchange rate", async () => {
    const response = await POST(
      new Request("http://localhost/api/exchange-rates", {
        body: JSON.stringify({ rateVes: 512, source: "Manual" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.rateVes).toBe(512);
  });

  it("validates positive exchange rate", async () => {
    const response = await POST(
      new Request("http://localhost/api/exchange-rates", {
        body: JSON.stringify({ rateVes: 0 }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "contador",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  describe("supabase data source", () => {
    const mockRange = jest.fn();
    const mockSelect = jest.fn(() => ({
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: mockRange,
    }));
    const mockInsert = jest.fn();
    const mockSingle = jest.fn();
    const mockGetUser = jest.fn();

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockRange.mockResolvedValue({
        count: 1,
        data: [
          {
            created_at: "2026-05-18T12:00:00.000Z",
            id: "rate-1",
            rate_ves: 510,
            source: "Manual",
          },
        ],
        error: null,
      });
      mockSingle.mockResolvedValue({
        data: {
          created_at: "2026-05-18T12:00:00.000Z",
          id: "rate-new",
          rate_ves: 512,
          source: "Manual",
        },
        error: null,
      });
      mockInsert.mockReturnValue({
        select: jest.fn(() => ({
          single: mockSingle,
        })),
      });
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-admin" } },
        error: null,
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        auth: { getUser: mockGetUser },
        from: jest.fn((table: string) => {
          if (table === "exchange_rates") {
            return {
              insert: mockInsert,
              select: mockSelect,
            };
          }

          return { select: mockSelect };
        }),
      });
    });

    it("lists exchange rates from supabase with pagination", async () => {
      const response = await GET(new Request("http://localhost/api/exchange-rates?skip=0&limit=10"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({
          id: "rate-1",
          rateVes: 510,
          source: "Manual",
        }),
      ]);
      expect(body.data.total).toBe(1);
      expect(mockRange).toHaveBeenCalledWith(0, 9);
    });

    it("creates an exchange rate in supabase", async () => {
      const response = await POST(
        new Request("http://localhost/api/exchange-rates", {
          body: JSON.stringify({ rateVes: 512, source: "Manual" }),
          headers: {
            "content-type": "application/json",
            "x-demo-role": "contador",
          },
          method: "POST",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.rateVes).toBe(512);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          created_by: "user-admin",
          rate_ves: 512,
          source: "Manual",
          store_id: "00000000-0000-4000-8000-000000000001",
        }),
      );
    });
  });
});
