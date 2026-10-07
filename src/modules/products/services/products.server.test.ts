/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listProducts } from "./products.server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

function createMockSupabase() {
  const chain: Record<string, jest.Mock> = {
    eq: jest.fn(),
    or: jest.fn(),
    order: jest.fn(),
    range: jest.fn().mockResolvedValue({ count: 0, data: [], error: null }),
    select: jest.fn(),
  };

  chain.eq.mockReturnValue(chain);
  chain.or.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);

  return { chain, from: jest.fn(() => chain) };
}

describe("products.server listProducts: exact sku filter", () => {
  function setup() {
    const supabase = createMockSupabase();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    return supabase.chain;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filters by the exact sku normalized like product creation", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams("sku=%20%20HER-TAL-001%20"), DEFAULT_STORE_ID);

    expect(chain.eq).toHaveBeenCalledWith("sku", "her-tal-001");
    expect(chain.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
  });

  it("scopes the query to the store received from the server, never from the query", async () => {
    const chain = setup();

    await listProducts(
      new URLSearchParams(`sku=her-tal-001&store_id=${DEFAULT_STORE_ID}&storeId=${DEFAULT_STORE_ID}`),
      OTHER_STORE_ID,
    );

    expect(chain.eq).toHaveBeenCalledWith("store_id", OTHER_STORE_ID);
    expect(chain.eq).not.toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
  });

  it.each(["", "sku=", "sku=%20%20"])("does not filter by sku for query [%s]", async (queryString) => {
    const chain = setup();

    await listProducts(new URLSearchParams(queryString), DEFAULT_STORE_ID);

    expect(chain.eq).not.toHaveBeenCalledWith("sku", expect.anything());
  });

  it("takes precedence over the partial search, like barcode", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams("sku=her-tal-001&search=taladro"), DEFAULT_STORE_ID);

    expect(chain.eq).toHaveBeenCalledWith("sku", "her-tal-001");
    expect(chain.or).not.toHaveBeenCalled();
  });

  it("combines with barcode, category and active filters", async () => {
    const chain = setup();

    await listProducts(
      new URLSearchParams("sku=her-tal-001&barcode=7501234567890&categoryId=cat-1&isActive=true"),
      DEFAULT_STORE_ID,
    );

    expect(chain.eq).toHaveBeenCalledWith("sku", "her-tal-001");
    expect(chain.eq).toHaveBeenCalledWith("barcode", "7501234567890");
    expect(chain.eq).toHaveBeenCalledWith("category_id", "cat-1");
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("keeps the existing barcode and search behavior without sku", async () => {
    const barcodeChain = setup();
    await listProducts(new URLSearchParams("barcode=7501234567890&search=taladro"), DEFAULT_STORE_ID);

    expect(barcodeChain.eq).toHaveBeenCalledWith("barcode", "7501234567890");
    expect(barcodeChain.or).not.toHaveBeenCalled();

    const searchChain = setup();
    await listProducts(new URLSearchParams("search=taladro"), DEFAULT_STORE_ID);

    expect(searchChain.or).toHaveBeenCalledWith(expect.stringContaining("sku.ilike.%taladro%"));
  });
});
