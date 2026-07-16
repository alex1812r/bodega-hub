/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/exchange-rates/dolarApi");
jest.mock("../../../../lib/supabase/admin-client");

import { fetchOfficialDollarRate } from "@/lib/exchange-rates/dolarApi";
import { clearOfficialRateCache } from "@/lib/exchange-rates/officialRateCache";
import { DOLAR_API_OFFICIAL_SOURCE } from "@/lib/exchange-rates/constants";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET } from "./route";

describe("/api/exchange-rates/current", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    clearOfficialRateCache();
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns the latest exchange rate from mock data", async () => {
    const response = await GET(new Request("http://localhost/api/exchange-rates/current"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("rate-today");
  });

  describe("supabase data source", () => {
    const mockMaybeSingle = jest.fn();
    const query = {
      eq: jest.fn(),
      limit: jest.fn(),
      maybeSingle: mockMaybeSingle,
      order: jest.fn(),
    };
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const mockSelect = jest.fn(() => query);
    const mockInsertSingle = jest.fn();

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      clearOfficialRateCache();

      (fetchOfficialDollarRate as jest.Mock).mockResolvedValue({
        fechaActualizacion: "2026-06-03T00:00:00-04:00",
        rateVes: 558.6436,
        source: DOLAR_API_OFFICIAL_SOURCE,
      });

      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      mockInsertSingle.mockResolvedValue({
        data: {
          created_at: "2026-06-03T04:00:00.000Z",
          id: "rate-official-api",
          rate_ves: 558.6436,
          source: DOLAR_API_OFFICIAL_SOURCE,
        },
        error: null,
      });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          select: mockSelect,
        })),
      });

      (createAdminSupabaseClient as jest.Mock).mockReturnValue({
        from: jest.fn(() => ({
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: mockInsertSingle,
            })),
          })),
        })),
      });
    });

    it("returns official rate from DolarAPI via server", async () => {
      const response = await GET(new Request("http://localhost/api/exchange-rates/current"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(fetchOfficialDollarRate).toHaveBeenCalled();
      expect(body.data).toEqual(
        expect.objectContaining({
          id: "rate-official-api",
          rateVes: 558.6436,
          source: DOLAR_API_OFFICIAL_SOURCE,
        }),
      );
    });
  });
});
