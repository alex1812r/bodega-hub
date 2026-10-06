/**
 * @jest-environment node
 */
import {
  LAB_CASH_REGISTERS,
  LAB_PACK_UNITS_PER_PACK,
  LAB_PASSWORD,
  LAB_USERS,
  STORE_SCOPED_DELETE_ORDER,
  assertSeedEnv,
  buildLabCatalog,
  formatSummary,
  labEan13,
  runSeed,
} from "./seed-lab";

const GOOD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:14321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STOCK_LAB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:14322/postgres",
  STOCK_TEST_ALLOW_WRITES_HOST: "127.0.0.1",
};

describe("buildLabCatalog", () => {
  const plan = buildLabCatalog();
  const bySku = new Map(plan.products.map((p) => [p.sku, p]));

  it("es determinista", () => {
    expect(buildLabCatalog()).toEqual(plan);
  });

  it("tiene 40 productos con SKU único", () => {
    expect(plan.products).toHaveLength(40);
    expect(new Set(plan.products.map((p) => p.sku)).size).toBe(40);
  });

  it("tiene 5 HOT activos, sin empaque y con stock inicial >= 500", () => {
    const hot = plan.products.filter((p) => p.kind === "hot");
    expect(hot.map((p) => p.sku)).toEqual(["LAB-HOT-01", "LAB-HOT-02", "LAB-HOT-03", "LAB-HOT-04", "LAB-HOT-05"]);
    for (const p of hot) {
      expect(p.isActive).toBe(true);
      expect(p.initialStock).toBeGreaterThanOrEqual(500);
      expect(p.barcode).not.toBeNull();
    }
    const packSkus = plan.packPairs.flatMap((pair) => [pair.packSku, pair.unitSku]);
    expect(hot.some((p) => packSkus.includes(p.sku))).toBe(false);
  });

  it("tiene 5 pares empaque/unidad con units_per_pack 6,12,24,6,12 y productos existentes", () => {
    expect(plan.packPairs).toHaveLength(5);
    expect(plan.packPairs.map((pair) => pair.unitsPerPack)).toEqual([...LAB_PACK_UNITS_PER_PACK]);
    expect(plan.packPairs.map((pair) => pair.packSku)).toEqual(["LAB-PACK-01", "LAB-PACK-02", "LAB-PACK-03", "LAB-PACK-04", "LAB-PACK-05"]);
    expect(plan.packPairs.map((pair) => pair.unitSku)).toEqual(["LAB-UNIT-01", "LAB-UNIT-02", "LAB-UNIT-03", "LAB-UNIT-04", "LAB-UNIT-05"]);
    for (const pair of plan.packPairs) {
      expect(bySku.get(pair.packSku)?.kind).toBe("pack");
      expect(bySku.get(pair.unitSku)?.kind).toBe("unit");
      expect(bySku.get(pair.packSku)?.isActive).toBe(true);
      expect(bySku.get(pair.unitSku)?.isActive).toBe(true);
    }
    // 1 activo por pack y por unidad (índices únicos parciales).
    expect(new Set(plan.packPairs.map((pair) => pair.packSku)).size).toBe(5);
    expect(new Set(plan.packPairs.map((pair) => pair.unitSku)).size).toBe(5);
  });

  it("tiene 3 inactivos (con stock para que entren por adjust_stock) y solo esos están inactivos", () => {
    const inactive = plan.products.filter((p) => !p.isActive);
    expect(inactive.map((p) => p.sku)).toEqual(["LAB-INACT-01", "LAB-INACT-02", "LAB-INACT-03"]);
    for (const p of inactive) {
      expect(p.kind).toBe("inactive");
      expect(p.initialStock).toBeGreaterThan(0);
    }
  });

  it("tiene exactamente 2 productos que quedan en stock 0", () => {
    const zero = plan.products.filter((p) => p.initialStock === 0);
    expect(zero.map((p) => p.sku)).toEqual(["LAB-ZERO-01", "LAB-ZERO-02"]);
    expect(zero.every((p) => p.isActive)).toBe(true);
  });

  it("tiene 2 productos con mínimo 500 y stock 20", () => {
    const min = plan.products.filter((p) => p.kind === "min");
    expect(min.map((p) => p.sku)).toEqual(["LAB-MIN-01", "LAB-MIN-02"]);
    for (const p of min) {
      expect(p.minStock).toBe(500);
      expect(p.initialStock).toBe(20);
    }
    expect(plan.products.filter((p) => p.minStock === 500)).toHaveLength(2);
  });

  it("el resto son LAB-NNN", () => {
    const generic = plan.products.filter((p) => p.kind === "generic");
    expect(generic).toHaveLength(40 - 5 - 10 - 3 - 2 - 2);
    for (const p of generic) expect(p.sku).toMatch(/^LAB-\d{3}$/);
  });

  it("los barcodes son EAN-13 únicos y hay productos con y sin barcode", () => {
    const withBarcode = plan.products.filter((p) => p.barcode !== null);
    const without = plan.products.filter((p) => p.barcode === null);
    expect(withBarcode.length).toBeGreaterThanOrEqual(18);
    expect(without.length).toBeGreaterThanOrEqual(15);
    expect(new Set(withBarcode.map((p) => p.barcode)).size).toBe(withBarcode.length);
    for (const p of withBarcode) expect(p.barcode).toMatch(/^759\d{10}$/);
  });

  it("tiene 6 categorías (3 con IVA 16 y 3 con 0) y productos en ambas", () => {
    expect(plan.categories).toHaveLength(6);
    expect(plan.categories.filter((c) => c.taxRate === 16)).toHaveLength(3);
    expect(plan.categories.filter((c) => c.taxRate === 0)).toHaveLength(3);
    const taxByKey = new Map(plan.categories.map((c) => [c.key, c.taxRate]));
    const rates = new Set(plan.products.map((p) => taxByKey.get(p.categoryKey)));
    expect(rates).toEqual(new Set([16, 0]));
    for (const p of plan.products) expect(taxByKey.has(p.categoryKey)).toBe(true);
  });

  it("tiene 3 proveedores con ~8 productos activos cada uno y algunos empaques", () => {
    expect(plan.suppliers).toHaveLength(3);
    for (const supplier of plan.suppliers) {
      expect(supplier.productSkus).toHaveLength(8);
      expect(supplier.packUnits.length).toBeGreaterThan(0);
      for (const sku of supplier.productSkus) expect(bySku.get(sku)?.isActive).toBe(true);
      for (const unit of supplier.packUnits) {
        expect(supplier.productSkus).toContain(unit.sku);
        expect(unit.unitsPerPack).toBeGreaterThan(1);
      }
    }
    expect(new Set(plan.suppliers.map((s) => s.taxId)).size).toBe(3);
  });

  it("tiene 5 clientes más Consumidor final como único is_pos_default", () => {
    expect(plan.customers).toHaveLength(6);
    const defaults = plan.customers.filter((c) => c.isPosDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Consumidor final");
    const taxIds = plan.customers.map((c) => c.taxId).filter((t): t is string => t !== null);
    expect(new Set(taxIds).size).toBe(5);
  });

  it("38 productos entran por adjust_stock con stock > 0", () => {
    expect(plan.products.filter((p) => p.initialStock > 0)).toHaveLength(38);
    expect(plan.products.every((p) => Number.isInteger(p.initialStock) && p.initialStock >= 0)).toBe(true);
  });
});

describe("labEan13", () => {
  it("genera 13 dígitos con dígito de control válido", () => {
    const code = labEan13(1);
    expect(code).toHaveLength(13);
    const digits = code.split("").map(Number);
    const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + (i % 2 === 0 ? d : d * 3), 0);
    expect((sum + digits[12]) % 10).toBe(0);
    expect(labEan13(1)).not.toBe(labEan13(2));
  });
});

describe("contrato de usuarios y cajas", () => {
  it("define los 5 usuarios del contrato con la clave Lab2026!", () => {
    expect(LAB_PASSWORD).toBe("Lab2026!");
    expect(LAB_USERS.map((u) => [u.email, u.role])).toEqual([
      ["lab-admin@lab.local", "admin"],
      ["lab-vendedor-1@lab.local", "vendedor"],
      ["lab-vendedor-2@lab.local", "vendedor"],
      ["lab-almacen@lab.local", "almacen"],
      ["lab-contador@lab.local", "contador"],
    ]);
  });

  it("asigna Caja Lab 1 y 2 a los vendedores", () => {
    expect(LAB_CASH_REGISTERS).toEqual([
      { name: "Caja Lab 1", userKey: "vendedor1" },
      { name: "Caja Lab 2", userKey: "vendedor2" },
    ]);
  });

  it("borra hijos antes que padres (stock_movements antes que products; profiles al final)", () => {
    const idx = (t: string) => STORE_SCOPED_DELETE_ORDER.indexOf(t);
    expect(idx("stock_movements")).toBeLessThan(idx("products"));
    expect(idx("sales")).toBeLessThan(idx("exchange_rates"));
    expect(idx("cash_movements")).toBeLessThan(idx("cash_sessions"));
    expect(idx("cash_sessions")).toBeLessThan(idx("cash_registers"));
    expect(idx("supplier_products")).toBeLessThan(idx("contacts"));
    expect(idx("profiles")).toBe(STORE_SCOPED_DELETE_ORDER.length - 1);
  });
});

describe("assertSeedEnv", () => {
  it("acepta el entorno local permitido", () => {
    expect(assertSeedEnv(GOOD_ENV)).toEqual({
      supabaseUrl: GOOD_ENV.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: "anon",
      serviceRoleKey: "service",
      dbUrl: GOOD_ENV.STOCK_LAB_DB_URL,
      allowedHost: "127.0.0.1",
    });
  });

  it("rechaza una API que no sea el host permitido", () => {
    expect(() =>
      assertSeedEnv({ ...GOOD_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }),
    ).toThrow(/abc\.supabase\.co.*no es el host permitido/);
  });

  it("rechaza una base que no sea el host permitido", () => {
    expect(() =>
      assertSeedEnv({ ...GOOD_ENV, STOCK_LAB_DB_URL: "postgresql://u:p@db.prod.internal:5432/postgres" }),
    ).toThrow(/db\.prod\.internal/);
  });

  it("rechaza si falta STOCK_TEST_ALLOW_WRITES_HOST o una variable requerida", () => {
    expect(() => assertSeedEnv({ ...GOOD_ENV, STOCK_TEST_ALLOW_WRITES_HOST: undefined })).toThrow(
      /STOCK_TEST_ALLOW_WRITES_HOST/,
    );
    expect(() => assertSeedEnv({ ...GOOD_ENV, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("runSeed", () => {
  it("aborta sin conectar cuando el host no está permitido", async () => {
    await expect(
      runSeed({ ...GOOD_ENV, STOCK_LAB_DB_URL: "postgresql://u:p@db.prod.internal:5432/postgres" }),
    ).rejects.toThrow(/db\.prod\.internal/);
  });
});

describe("formatSummary", () => {
  it("imprime una línea por entidad", () => {
    const lines = formatSummary({
      productos: 40,
      inactivos: 3,
      stockCero: 2,
      pares: 5,
      usuarios: 5,
      cajas: 2,
      proveedores: 3,
      clientes: 6,
      categorias: 6,
      movimientosInventarioInicial: 38,
      productosConStock: 38,
    });
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe("productos=40");
    expect(lines[9]).toContain("movimientos_inventario_inicial=38");
  });
});
