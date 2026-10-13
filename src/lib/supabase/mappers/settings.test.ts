import {
  mapAppSettings,
  mapExchangeRate,
  mapPricingSettings,
  mapUserProfile,
} from "./settings";

describe("settings mappers", () => {
  it("maps exchange rate rows to API shape", () => {
    expect(
      mapExchangeRate({
        created_at: "2026-05-18T12:00:00.000Z",
        id: "rate-1",
        rate_ves: "45.5000",
        source: "BCV",
      }),
    ).toEqual({
      createdAt: "2026-05-18T12:00:00.000Z",
      id: "rate-1",
      rateVes: 45.5,
      source: "BCV",
    });
  });

  it("maps app settings rows to API shape", () => {
    expect(
      mapAppSettings({
        business_name: "BodegaHub",
        default_tax_rate: "16",
        id: 1,
        invoice_prefix: "FAC",
        low_stock_threshold: 5,
      }),
    ).toEqual({
      businessName: "BodegaHub",
      defaultTaxRate: 16,
      enabledPaymentMethods: [
        "efectivo_ves",
        "efectivo_usd",
        "pago_movil",
        "punto_venta",
        "transferencia",
      ],
      invoicePrefix: "FAC",
      lowStockThreshold: 5,
    });
  });

  it("maps the pricing columns to numbers with the chips in ascending order", () => {
    expect(
      mapPricingSettings({
        margin_green_from_pct: "40.00",
        margin_yellow_from_pct: "10.50",
        markup_chips_pct: ["50.00", 5, "12.25"],
      }),
    ).toEqual({ chipsPct: [5, 12.25, 50], greenFromPct: 40, yellowFromPct: 10.5 });
  });

  it.each([null, undefined, {}, { markup_chips_pct: [] }])(
    "falls back to the @bodega/core defaults without pricing columns (%p)",
    (row) => {
      expect(mapPricingSettings(row)).toEqual({
        chipsPct: [12, 20, 30],
        greenFromPct: 25,
        yellowFromPct: 15,
      });
    },
  );

  it("keeps a yellow threshold of 0 (it is a value, not a missing column)", () => {
    expect(
      mapPricingSettings({ margin_green_from_pct: 30, margin_yellow_from_pct: 0, markup_chips_pct: [10] }),
    ).toEqual({ chipsPct: [10], greenFromPct: 30, yellowFromPct: 0 });
  });

  it("maps profile rows with permission overrides", () => {
    expect(
      mapUserProfile(
        {
          denied_permissions: ["payments.view"],
          full_name: "Vendedor Demo",
          granted_permissions: ["contacts.manage"],
          id: "user-seller",
          is_active: true,
          role: "vendedor",
        },
        "vendedor@example.com",
      ),
    ).toEqual({
      deniedPermissions: ["payments.view"],
      email: "vendedor@example.com",
      grantedPermissions: ["contacts.manage"],
      id: "user-seller",
      isActive: true,
      name: "Vendedor Demo",
      role: "vendedor",
    });
  });
});
