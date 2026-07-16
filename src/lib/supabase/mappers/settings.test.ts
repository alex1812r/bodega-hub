import { mapAppSettings, mapExchangeRate, mapUserProfile } from "./settings";

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
      invoicePrefix: "FAC",
      lowStockThreshold: 5,
    });
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
