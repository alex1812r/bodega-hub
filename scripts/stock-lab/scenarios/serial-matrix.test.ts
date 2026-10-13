/** @jest-environment node */
import {
  KINDS,
  KIND_SPECS,
  OPS,
  PACK_SIZES,
  adjustHttp,
  adjustRef,
  buildAdjustBody,
  buildImportRowBody,
  buildPurchaseBody,
  buildSaleBody,
  buildSerialMatrix,
  caseId,
  listSerialMatrix,
  mulRound2,
  purchaseHttp,
  purchaseUnits,
  round2,
  saleHttp,
  saleTotals,
  skuFor,
} from "./serial-matrix";

describe("matriz serie 8.1", () => {
  const matrix = buildSerialMatrix();
  const ids = matrix.map((item) => item.id);

  it("es el producto cartesiano completo tipos × operaciones, sin huecos ni duplicados", () => {
    expect(KINDS).toEqual(["iva", "noiva", "pack", "inactive", "zero"]);
    expect(matrix).toHaveLength(KINDS.length * OPS.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of KINDS) {
      for (const op of OPS) expect(ids).toContain(caseId(kind, op.key));
    }
  });

  it("cubre todas las operaciones de la sección 8.1 del plan", () => {
    const keys = OPS.map((op) => op.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "sale_paid",
        "sale_pending_then_paid",
        "sale_cancel_before_pay",
        "sale_cancel_after_pay",
        "sale_return_partial",
        "sale_return_total",
        "purchase_received_unit",
        "purchase_received_pack_6",
        "purchase_received_pack_12",
        "purchase_received_pack_24",
        "purchase_pack_upp_mismatch",
        "purchase_pack_on_pack_sku",
        "purchase_ordered_then_receive",
        "purchase_receive_twice",
        "purchase_cancel_received",
        "purchase_cancel_received_sold",
        "purchase_return_partial",
        "purchase_return_total",
        "adjust_in",
        "adjust_out",
        "adjust_out_over_stock",
        "conversion_normal_6",
        "conversion_normal_12",
        "conversion_normal_24",
        "conversion_insufficient",
        "new_product_stock_form",
        "new_product_stock_import",
        "sale_over_stock_rejected",
        "sale_inactive_rejected",
      ]),
    );
    expect(PACK_SIZES).toEqual([6, 12, 24]);
  });

  it("ids estables y cada caso tiene título, hipótesis y run", () => {
    expect(ids).toEqual(expect.arrayContaining(["iva.sale_paid", "pack.purchase_received_pack_12", "inactive.sale_inactive_rejected"]));
    for (const item of matrix) {
      expect(item.id).toMatch(/^(iva|noiva|pack|inactive|zero)\.[a-z0-9_]+$/);
      expect(item.title.length).toBeGreaterThan(10);
      expect(item.hypothesis.length).toBeGreaterThan(0);
      for (const hypothesis of item.hypothesis) expect(hypothesis).toMatch(/^H\d+$/);
      expect(typeof item.run).toBe("function");
    }
  });

  it("toda celda que no aplica es un skip con motivo (ninguna se omite en silencio)", () => {
    const skipped = matrix.filter((item) => item.skip !== undefined);
    for (const item of skipped) expect((item.skip ?? "").length).toBeGreaterThan(20);
    expect(skipped.map((item) => item.id).sort()).toEqual(
      [
        ...["iva", "noiva", "inactive", "zero"].flatMap((kind) =>
          ["purchase_pack_upp_mismatch", "purchase_pack_on_pack_sku", "conversion_normal_6", "conversion_normal_12", "conversion_normal_24", "conversion_insufficient"].map(
            (op) => `${kind}.${op}`,
          ),
        ),
        "pack.new_product_stock_import",
        "zero.sale_cancel_before_pay",
        "zero.sale_cancel_after_pay",
        "zero.sale_return_partial",
        "zero.sale_return_total",
      ].sort(),
    );
  });

  it("--list imprime una línea por celda con id, estado y título", () => {
    const lines = listSerialMatrix();
    expect(lines).toHaveLength(matrix.length);
    expect(lines[0]).toBe("iva.sale_paid\trun\tVenta pagada (atómica, con pago) · producto con IVA");
    expect(lines.find((line) => line.startsWith("zero.sale_return_total\t"))).toContain("\tskip: sin stock no existe venta");
  });

  it("los 5 tipos de producto son los del plan", () => {
    expect(KIND_SPECS.iva.taxRate).toBe(16);
    expect(KIND_SPECS.noiva.taxRate).toBe(0);
    expect(KIND_SPECS.pack.pack).toBe(true);
    expect(KIND_SPECS.inactive.inactive).toBe(true);
    expect(KIND_SPECS.inactive.stock).toBeGreaterThan(0);
    expect(KIND_SPECS.zero.stock).toBe(0);
  });
});

describe("cálculo de esperados y payloads", () => {
  const rate = { id: "rate-1", rateVes: 871.3689 };

  it("redondeo a 2 decimales como numeric de Postgres", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(mulRound2(4.64, 871.3689)).toBe(4043.15);
    expect(mulRound2(10, 871.3689)).toBe(8713.69);
    expect(mulRound2(1, 52)).toBe(52);
    expect(mulRound2(0.05, 0.1)).toBe(0.01);
  });

  it("totales de venta con y sin IVA", () => {
    expect(saleTotals(2, 2, 16, 871.3689)).toEqual({ subtotalRef: 4, taxRef: 0.64, totalRef: 4.64, totalVes: 4043.15 });
    expect(saleTotals(3, 2, 0, 52)).toEqual({ subtotalRef: 6, taxRef: 0, totalRef: 6, totalVes: 312 });
  });

  it("venta pagada y pendiente llevan clientRequestId (obligatoria); la pendiente va sin payments", () => {
    const paid = buildSaleBody({ mode: "paid", customerId: "c", rate, productId: "p", quantity: 2, unitPriceRef: 2, taxRate: 16, clientRequestId: "req" });
    expect(paid).toMatchObject({
      clientRequestId: "req",
      customerId: "c",
      exchangeRateId: "rate-1",
      refRateVes: 871.3689,
      items: [{ productId: "p", quantity: 2, unitPriceRef: 2 }],
      taxRef: 0.64,
      payments: [{ method: "pago_movil", currency: "VES", amount: 4043.15, referenceCode: "0402" }],
    });
    const pending = buildSaleBody({ mode: "pending", customerId: "c", rate, productId: "p", quantity: 2, unitPriceRef: 2, taxRate: 0 });
    expect(pending).not.toHaveProperty("payments");
    expect(pending.clientRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const again = buildSaleBody({ mode: "pending", customerId: "c", rate, productId: "p", quantity: 2, unitPriceRef: 2, taxRate: 0 });
    expect(again.clientRequestId).not.toBe(pending.clientRequestId);
    expect(pending.taxRef).toBe(0);
  });

  it("compra por unidad y por empaque: packCount × unitsPerPack exacto (H2)", () => {
    for (const unitsPerPack of PACK_SIZES) {
      expect(purchaseUnits({ mode: "pack", packCount: 3, unitsPerPack })).toBe(3 * unitsPerPack);
    }
    expect(purchaseUnits({ mode: "unit", quantity: 10 })).toBe(10);
    const unit = buildPurchaseBody({ supplierId: "s", status: "pedido", rate, productId: "p", taxRate: 16, line: { mode: "unit", quantity: 10 } });
    expect(unit).toMatchObject({ supplierId: "s", status: "pedido", subtotalRef: 10, subtotalVes: 8713.69, taxRef: 1.6, taxVes: 1394.19, discountRef: 0, discountVes: 0 });
    expect((unit.items as unknown[])[0]).toMatchObject({ entryMode: "unit", quantity: 10, unitCostRef: 1, unitCostVes: 871.37, taxRate: 16, subtotalRef: 10 });
    const pack = buildPurchaseBody({ supplierId: "s", status: "recibido", rate, productId: "p", taxRate: 0, line: { mode: "pack", packCount: 3, unitsPerPack: 12 } });
    const item = (pack.items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({ entryMode: "pack", packLabel: "Bulto x12", packCount: 3, unitsPerPack: 12, packCostRef: 12, subtotalRef: 36 });
    expect(item).not.toHaveProperty("quantity");
    expect(pack.subtotalRef).toBe(36);
  });

  it("la fila de import replica toProductInput (sku en minúsculas, stock_inicial vacío = 0, minStock 5)", () => {
    expect(buildImportRowBody({ sku: "S402-X", name: "n", categoryId: "cat", stockInicial: 7 })).toEqual({
      sku: "s402-x",
      name: "n",
      categoryId: "cat",
      salePriceRef: 2,
      currentCostRef: 1,
      currentStock: 7,
      minStock: 5,
    });
    expect(buildImportRowBody({ sku: "a", name: "n", categoryId: "cat", stockInicial: undefined }).currentStock).toBe(0);
  });

  it("una venta solo se acepta con producto activo y stock suficiente", () => {
    expect(saleHttp({ active: true, stock: 20 }, 2)).toBe("accept");
    expect(saleHttp({ active: true, stock: 20 }, 21)).toBe("reject");
    expect(saleHttp({ active: true, stock: 0 }, 1)).toBe("reject");
    expect(saleHttp({ active: false, stock: 20 }, 1)).toBe("reject");
  });

  it("un ajuste que deja stock negativo se rechaza", () => {
    expect(adjustHttp({ active: true, stock: 20 }, 5)).toBe("accept");
    expect(adjustHttp({ active: true, stock: 20 }, -3)).toBe("accept");
    expect(adjustHttp({ active: true, stock: 0 }, -3)).toBe("reject");
    expect(adjustHttp({ active: false, stock: 20 }, -25)).toBe("reject");
  });

  it("producto inactivo (COM-15a, 20261011b): la entrada se rechaza y la salida se acepta; ya no se observa", () => {
    expect(adjustHttp({ active: false, stock: 20 }, 5)).toBe("reject");
    expect(adjustHttp({ active: false, stock: 0 }, 1)).toBe("reject");
    expect(adjustHttp({ active: false, stock: 20 }, -3)).toBe("accept");
    expect(adjustHttp({ active: false, stock: 20 }, -20)).toBe("accept");
    for (const active of [true, false]) {
      for (const delta of [5, -3, -25]) expect(adjustHttp({ active, stock: 20 }, delta)).not.toBe("either");
    }
  });

  it("COM-15: una compra sobre un producto inactivo se rechaza (ya no se observa); las variantes de empaque siguen en observación", () => {
    expect(purchaseHttp({ active: true })).toBe("accept");
    expect(purchaseHttp({ active: false })).toBe("reject");
    expect(purchaseHttp({ active: true }, true)).toBe("either");
    expect(purchaseHttp({ active: false }, true)).toBe("either");
  });

  it("SKU con el prefijo del ticket, el run y un sufijo único", () => {
    expect(skuFor("stk402-smoke", "abc", "pack.purchase_received_pack_12")).toBe("S402-stk402-smoke-abc-pack-purchase-received-pack-12");
    expect(skuFor("r", "n", "iva.sale_paid", "u")).toBe("S402-r-n-iva-sale-paid-u");
  });
});

describe("devoluciones por ajuste: solo ligadas a su documento (STK-603)", () => {
  it("buildAdjustBody solo envía saleId / purchaseId cuando se liga la devolución", () => {
    expect(buildAdjustBody({ productId: "p", quantityDelta: 1, type: "devolucion_cliente", reason: "r" })).toEqual({
      productId: "p",
      quantityDelta: 1,
      type: "devolucion_cliente",
      reason: "r",
    });
    expect(buildAdjustBody({ productId: "p", quantityDelta: 1, type: "devolucion_cliente", reason: "r", link: { saleId: "v" } })).toMatchObject({ saleId: "v" });
    const purchase = buildAdjustBody({ productId: "p", quantityDelta: -3, type: "devolucion_proveedor", reason: "r", link: { purchaseId: "c" } });
    expect(purchase).toMatchObject({ purchaseId: "c" });
    expect(purchase).not.toHaveProperty("saleId");
  });

  it("el movimiento de una devolución ligada debe apuntar a su documento; el ajuste libre a ninguno", () => {
    expect(adjustRef(undefined)).toBeNull();
    expect(adjustRef({})).toBeNull();
    expect(adjustRef({ saleId: "v" })).toEqual({ kind: "sale", id: "v" });
    expect(adjustRef({ purchaseId: "c" })).toEqual({ kind: "purchase", id: "c" });
  });

  it("las celdas de devolución parcial ya no describen el ajuste suelto como camino vigente", () => {
    for (const key of ["sale_return_partial", "purchase_return_partial"]) {
      const op = OPS.find((item) => item.key === key);
      expect(op?.title).toMatch(/sin documento → 400/);
      expect(op?.title).toMatch(/ligada/);
      expect(op?.title).not.toMatch(/hoy: ajuste/);
    }
  });
});
