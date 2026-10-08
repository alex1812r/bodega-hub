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

describe("products.server listProducts: packLink=none", () => {
  type LinkRow = { pack_product_id: string; unit_product_id: string };

  function setup(links: LinkRow[]) {
    const products = createMockSupabase().chain;
    products.not = jest.fn().mockReturnValue(products);

    const linksEq = jest.fn();
    const linksQuery = {
      eq: linksEq,
      select: jest.fn(),
      then: (resolve: (value: { data: LinkRow[]; error: null }) => void) =>
        resolve({ data: links, error: null }),
    };

    linksEq.mockReturnValue(linksQuery);
    linksQuery.select.mockReturnValue(linksQuery);

    const from = jest.fn((table: string) =>
      table === "product_pack_conversions" ? linksQuery : products,
    );

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

    return { from, linksEq, products };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("leaves out every product with an active pack link, as pack or as unit", async () => {
    const { linksEq, products } = setup([
      { pack_product_id: "pack-1", unit_product_id: "unit-1" },
      { pack_product_id: "pack-2", unit_product_id: "unit-1" },
    ]);

    await listProducts(new URLSearchParams("packLink=none&isActive=true"), OTHER_STORE_ID);

    expect(linksEq).toHaveBeenCalledWith("store_id", OTHER_STORE_ID);
    expect(linksEq).toHaveBeenCalledWith("is_active", true);
    expect(products.not).toHaveBeenCalledTimes(1);
    expect(products.not).toHaveBeenCalledWith("id", "in", "(pack-1,unit-1,pack-2)");
    expect(products.eq).toHaveBeenCalledWith("store_id", OTHER_STORE_ID);
    expect(products.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("does not add an empty exclusion when the store has no pack links", async () => {
    const { products } = setup([]);

    await listProducts(new URLSearchParams("packLink=none"), DEFAULT_STORE_ID);

    expect(products.not).not.toHaveBeenCalled();
  });

  it.each(["", "packLink=", "packLink=pack", "packLink=NONE"])(
    "keeps the default listing for query [%s]",
    async (queryString) => {
      const { from, products } = setup([{ pack_product_id: "pack-1", unit_product_id: "unit-1" }]);

      await listProducts(new URLSearchParams(queryString), DEFAULT_STORE_ID);

      expect(from).not.toHaveBeenCalledWith("product_pack_conversions");
      expect(products.not).not.toHaveBeenCalled();
    },
  );
});

describe("products.server listProducts: margin filter and sort", () => {
  /** `pricingRow` es la fila de `app_settings` de la tienda (null = tienda sin configuración). */
  function setup(pricingRow: Record<string, unknown> | null = null) {
    const supabase = createMockSupabase();

    for (const method of ["gte", "is", "lt"]) {
      supabase.chain[method] = jest.fn().mockReturnValue(supabase.chain);
    }

    supabase.chain.maybeSingle = jest.fn().mockResolvedValue({ data: pricingRow, error: null });
    supabase.chain.from = supabase.from;

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    return supabase.chain;
  }

  const configuredPricing = {
    margin_green_from_pct: "40.00",
    margin_yellow_from_pct: "10.00",
    markup_chips_pct: [5, 50],
  };

  function settingsReads(chain: Record<string, jest.Mock>) {
    return chain.from.mock.calls.filter(([table]) => table === "app_settings").length;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends the low band as margin_pct below the low threshold", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams("margin=low"), DEFAULT_STORE_ID);

    expect(chain.lt.mock.calls).toEqual([["margin_pct", 15]]);
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.is).not.toHaveBeenCalled();
  });

  it("sends the mid band as the range between both thresholds", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams("margin=mid"), DEFAULT_STORE_ID);

    expect(chain.gte.mock.calls).toEqual([["margin_pct", 15]]);
    expect(chain.lt.mock.calls).toEqual([["margin_pct", 25]]);
  });

  it("sends the high band as margin_pct from the high threshold", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams("margin=high"), DEFAULT_STORE_ID);

    expect(chain.gte.mock.calls).toEqual([["margin_pct", 25]]);
    expect(chain.lt).not.toHaveBeenCalled();
  });

  it("sends the products without cost as margin_pct is null", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams("margin=none"), DEFAULT_STORE_ID);

    expect(chain.is.mock.calls).toEqual([["margin_pct", null]]);
    expect(chain.gte).not.toHaveBeenCalled();
    expect(chain.lt).not.toHaveBeenCalled();
  });

  it.each([
    ["low", [], [["margin_pct", 10]]],
    ["mid", [["margin_pct", 10]], [["margin_pct", 40]]],
    ["high", [["margin_pct", 40]], []],
  ])(
    "sends the %s band with the thresholds configured in the store, read once",
    async (band, gte, lt) => {
      const chain = setup(configuredPricing);

      await listProducts(new URLSearchParams(`margin=${band}`), OTHER_STORE_ID);

      expect(chain.gte.mock.calls).toEqual(gte);
      expect(chain.lt.mock.calls).toEqual(lt);
      expect(settingsReads(chain)).toBe(1);
      expect(chain.select).toHaveBeenCalledWith(
        "margin_yellow_from_pct, margin_green_from_pct, markup_chips_pct",
      );
      expect(chain.eq.mock.calls.filter(([column]) => column === "store_id")).toEqual([
        ["store_id", OTHER_STORE_ID],
        ["store_id", OTHER_STORE_ID],
      ]);
    },
  );

  it.each(["", "margin=none", "margin=verde", "sortBy=marginPct"])(
    "does not read the store settings when the query [%s] does not need the thresholds",
    async (queryString) => {
      const chain = setup(configuredPricing);

      await listProducts(new URLSearchParams(queryString), DEFAULT_STORE_ID);

      expect(settingsReads(chain)).toBe(0);
    },
  );

  it("asks for the suggested % of the category in the product select", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams(""), DEFAULT_STORE_ID);

    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining("category:categories(id, name, description, tax_rate, default_markup_pct,"),
      { count: "exact" },
    );
  });

  it.each(["", "margin=", "margin=all", "margin=verde"])(
    "does not filter by margin for query [%s]",
    async (queryString) => {
      const chain = setup();

      await listProducts(new URLSearchParams(queryString), DEFAULT_STORE_ID);

      expect(chain.gte).not.toHaveBeenCalled();
      expect(chain.lt).not.toHaveBeenCalled();
      expect(chain.is).not.toHaveBeenCalled();
    },
  );

  it("combines with the other filters and keeps the store of the server", async () => {
    const chain = setup();

    await listProducts(
      new URLSearchParams("margin=high&categoryId=cat-1&isActive=true&search=taladro"),
      OTHER_STORE_ID,
    );

    expect(chain.gte).toHaveBeenCalledWith("margin_pct", 25);
    expect(chain.eq).toHaveBeenCalledWith("store_id", OTHER_STORE_ID);
    expect(chain.eq).toHaveBeenCalledWith("category_id", "cat-1");
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
    expect(chain.or).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["asc", true],
    ["desc", false],
  ])("orders by margin_pct %s with nulls last and a stable tie-break", async (sortOrder, ascending) => {
    const chain = setup();

    await listProducts(
      new URLSearchParams(`sortBy=marginPct&sortOrder=${sortOrder}`),
      DEFAULT_STORE_ID,
    );

    expect(chain.order.mock.calls).toEqual([
      ["margin_pct", { ascending, nullsFirst: false }],
      ["id", { ascending: true }],
    ]);
  });
});

describe("products.server listProducts: price review (PRO-11)", () => {
  const productRow = {
    category_id: "cat-1",
    current_cost_ref: 9,
    current_stock: 5,
    id: "prod-1",
    is_active: true,
    min_stock: 2,
    name: "Harina PAN",
    sale_price_ref: 10,
    sku: "har-001",
  };
  const reviewRow = {
    current_band: "red",
    current_cost_ref: 9,
    current_margin_pct: 11.111111,
    previous_band: "green",
    previous_cost_ref: 8,
    previous_margin_pct: 25,
    product_id: "prod-1",
    purchase_id: "pur-1",
    purchase_number: "C-0001",
    purchase_received_at: "2026-10-02T10:00:00.000Z",
    snapshot_at: "2026-10-01T10:00:00.000Z",
    supplier_name: "Distribuidora Lara",
  };

  function setup(rows: unknown[] = []) {
    const supabase = createMockSupabase();
    supabase.chain.range.mockResolvedValue({ count: rows.length, data: rows, error: null });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue(supabase);

    return supabase.chain;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("embeds the price_review relation in the same query: no extra query per product", async () => {
    const chain = setup();

    await listProducts(new URLSearchParams(), DEFAULT_STORE_ID);

    const select = String(chain.select.mock.calls[0][0]);
    expect(select).toContain("price_review:price_review(");
    expect(select).not.toContain("!inner");
    expect(chain.select).toHaveBeenCalledTimes(1);
  });

  it.each(["review=1", "review=true"])("%s turns the relation into an inner join: only queued products, counted by Postgres", async (query) => {
    const chain = setup();

    await listProducts(new URLSearchParams(`${query}&categoryId=cat-1&isActive=true&limit=20&skip=20`), DEFAULT_STORE_ID);

    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("price_review:price_review!inner("), {
      count: "exact",
    });
    // Se combina con los demás filtros y con la paginación.
    expect(chain.eq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
    expect(chain.eq).toHaveBeenCalledWith("category_id", "cat-1");
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
    expect(chain.range).toHaveBeenCalledWith(20, 39);
  });

  it.each(["review=0", "review="])("%s does not filter", async (query) => {
    const chain = setup();

    await listProducts(new URLSearchParams(query), DEFAULT_STORE_ID);

    expect(String(chain.select.mock.calls[0][0])).not.toContain("!inner");
  });

  it("exposes priceReview only on the products that are in the queue", async () => {
    setup([
      { ...productRow, price_review: reviewRow },
      { ...productRow, id: "prod-2", price_review: null },
      { ...productRow, id: "prod-3", price_review: [] },
      { ...productRow, id: "prod-4", price_review: [{ ...reviewRow, purchase_id: null }] },
    ]);

    const result = await listProducts(new URLSearchParams(), DEFAULT_STORE_ID);

    expect(result.items[0].priceReview).toEqual({
      currentBand: "low",
      currentCostRef: 9,
      currentMarginPct: 11.111111,
      previousBand: "high",
      previousCostRef: 8,
      previousMarginPct: 25,
      purchase: {
        id: "pur-1",
        number: "C-0001",
        receivedAt: "2026-10-02T10:00:00.000Z",
        supplierName: "Distribuidora Lara",
      },
      snapshotAt: "2026-10-01T10:00:00.000Z",
    });
    expect(result.items[1]).not.toHaveProperty("priceReview");
    expect(result.items[2]).not.toHaveProperty("priceReview");
    expect(result.items[3].priceReview).toMatchObject({ currentBand: "low" });
    expect(result.items[3].priceReview).not.toHaveProperty("purchase");
  });
});
