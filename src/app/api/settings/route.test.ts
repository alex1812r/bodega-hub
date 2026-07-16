/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET, PATCH } from "./route";

describe("/api/settings", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns app settings for admin", async () => {
    const response = await GET(new Request("http://localhost/api/settings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.businessName).toBe("BodegaHub");
  });

  it("updates settings for admin", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/settings", {
        body: JSON.stringify({ invoicePrefix: "FAC" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.invoicePrefix).toBe("FAC");
  });

  describe("supabase data source", () => {
    const mockMaybeSingle = jest.fn();
    const mockEq = jest.fn(() => ({
      maybeSingle: mockMaybeSingle,
      select: jest.fn(() => ({
        maybeSingle: mockMaybeSingle,
      })),
    }));
    const mockSelect = jest.fn(() => ({
      eq: mockEq,
    }));
    const mockUpdate = jest.fn();
    const mockGetUser = jest.fn();

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockMaybeSingle.mockResolvedValue({
        data: {
          business_name: "BodegaHub",
          default_tax_rate: 16,
          id: 1,
          invoice_prefix: "FAC",
          low_stock_threshold: 5,
        },
        error: null,
      });
      mockUpdate.mockReturnValue({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            maybeSingle: mockMaybeSingle,
          })),
        })),
      });
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-admin" } },
        error: null,
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        auth: { getUser: mockGetUser },
        from: jest.fn(() => ({
          select: mockSelect,
          update: mockUpdate,
        })),
      });
    });

    it("returns app settings from supabase", async () => {
      const response = await GET(new Request("http://localhost/api/settings"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({
        businessName: "BodegaHub",
        defaultTaxRate: 16,
        invoicePrefix: "FAC",
        lowStockThreshold: 5,
      });
    });

    it("updates app settings in supabase", async () => {
      const response = await PATCH(
        new Request("http://localhost/api/settings", {
          body: JSON.stringify({ invoicePrefix: "FAC" }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.invoicePrefix).toBe("FAC");
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice_prefix: "FAC",
          updated_by: "user-admin",
        }),
      );
    });
  });
});
