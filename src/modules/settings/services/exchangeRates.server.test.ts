/**
 * @jest-environment node
 */

jest.mock("../../../lib/exchange-rates/dolarApi");
jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { fetchOfficialDollarRate } from "@/lib/exchange-rates/dolarApi";
import { clearOfficialRateCache } from "@/lib/exchange-rates/officialRateCache";
import { DOLAR_API_OFFICIAL_SOURCE } from "@/lib/exchange-rates/constants";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { getCurrentExchangeRate } from "./exchangeRates.server";

describe("exchangeRates.server getCurrentExchangeRate", () => {
  const mockMaybeSingle = jest.fn();
  const mockEq = jest.fn(() => ({
    order: jest.fn(() => ({
      limit: jest.fn(() => ({
        maybeSingle: mockMaybeSingle,
      })),
    })),
  }));
  const mockSelect = jest.fn(() => ({
    eq: mockEq,
  }));

  const mockInsertSingle = jest.fn();
  const mockInsert = jest.fn(() => ({
    select: jest.fn(() => ({
      single: mockInsertSingle,
    })),
  }));

  beforeEach(() => {
    clearOfficialRateCache();
    jest.clearAllMocks();

    (fetchOfficialDollarRate as jest.Mock).mockResolvedValue({
      fechaActualizacion: "2026-06-03T00:00:00-04:00",
      rateVes: 558.6436,
      source: DOLAR_API_OFFICIAL_SOURCE,
    });

    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsertSingle.mockResolvedValue({
      data: {
        created_at: "2026-06-03T04:00:00.000Z",
        id: "rate-official-new",
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
        insert: mockInsert,
      })),
    });
  });

  it("fetches DolarAPI and persists when there is no official row", async () => {
    const rate = await getCurrentExchangeRate();

    expect(fetchOfficialDollarRate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
    expect(rate.rateVes).toBe(558.6436);
    expect(rate.source).toBe(DOLAR_API_OFFICIAL_SOURCE);
    expect(rate.id).toBe("rate-official-new");
  });

  it("returns cached rate without calling DolarAPI again", async () => {
    await getCurrentExchangeRate();
    jest.clearAllMocks();

    const rate = await getCurrentExchangeRate();

    expect(fetchOfficialDollarRate).not.toHaveBeenCalled();
    expect(rate.rateVes).toBe(558.6436);
  });

  it("skips insert when same day and same rate", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        created_at: "2026-06-03T12:00:00.000Z",
        id: "rate-existing",
        rate_ves: 558.6436,
        source: DOLAR_API_OFFICIAL_SOURCE,
      },
      error: null,
    });

    const rate = await getCurrentExchangeRate();

    expect(mockInsert).not.toHaveBeenCalled();
    expect(rate.id).toBe("rate-existing");
  });
});
