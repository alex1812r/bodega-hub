import { buildContext, buildExtraction, buildLine } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";
import { MISSING_RATE_WARNING, NO_PRICE_ISSUE, USD_DOCUMENT_ISSUE } from "./match/money";

describe("matchInvoice · moneda y tasa", () => {
  it("Bs con tasa del sistema: costo por unidad de entrada en Bs y en REF", () => {
    const result = matchInvoice(buildExtraction(), buildContext());

    expect(result.rate).toEqual({ system: 100 });
    expect(result.lines[0]).toMatchObject({ status: "confirmed", unitCostVes: 50, unitCostRef: 0.5 });
  });

  it("sin tasa del sistema y con tasa impresa: usa la impresa con aviso (6.7)", () => {
    const result = matchInvoice(buildExtraction({ printedRate: 80 }), buildContext({ systemRate: undefined }));

    expect(result.rate).toEqual({
      printed: 80,
      warning: "No hay tasa del día en el sistema: se usó la tasa impresa en la factura (80,00).",
    });
    expect(result.lines[0].unitCostRef).toBe(0.63);
    expect(result.lines[0].unitCostVes).toBe(50);
  });

  it("sin ninguna tasa: no precarga REF y avisa que falta la tasa del día", () => {
    const result = matchInvoice(buildExtraction(), buildContext({ systemRate: undefined }));

    expect(result.rate).toEqual({ warning: MISSING_RATE_WARNING });
    expect(result.lines[0].unitCostRef).toBeUndefined();
    expect(result.lines[0].unitCostVes).toBe(50);
  });

  it("tasa impresa > 3 % de la del sistema: aviso con ambas, convierte con la del sistema (6.20)", () => {
    const result = matchInvoice(
      buildExtraction({ printedRate: 850.4, lines: [buildLine({ unitPrice: 450, lineTotal: 5400 })] }),
      buildContext({ systemRate: 900 }),
    );

    expect(result.rate).toEqual({
      system: 900,
      printed: 850.4,
      warning: "La factura trae tasa 850,40; hoy es 900,00.",
    });
    expect(result.lines[0].unitCostRef).toBe(0.5);
    expect(result.lines[0].status).toBe("confirmed");
  });

  it("tasa impresa dentro del 3 %: sin aviso (875,65 vs 900,00 es un 2,7 %)", () => {
    const result = matchInvoice(buildExtraction({ printedRate: 102 }), buildContext());

    expect(result.rate).toEqual({ system: 100, printed: 102 });
    const plan = matchInvoice(buildExtraction({ printedRate: 875.65 }), buildContext({ systemRate: 900 }));
    expect(plan.rate?.warning).toBeUndefined();
  });

  it("formatea miles con punto en el aviso", () => {
    const result = matchInvoice(buildExtraction({ printedRate: 1234.5 }), buildContext({ systemRate: 1000 }));

    expect(result.rate?.warning).toBe("La factura trae tasa 1.234,50; hoy es 1.000,00.");
  });

  it("currency USD: todas las líneas dudosas con anomalía y nada como Bs (6.21)", () => {
    const result = matchInvoice(
      buildExtraction({ currency: "USD", lines: [buildLine(), buildLine({ description: "COSA RARA" })] }),
      buildContext(),
    );

    for (const line of result.lines) {
      expect(line.status).toBe("doubtful");
      expect(line.issues).toContain(USD_DOCUMENT_ISSUE);
      expect(line.unitCostVes).toBeUndefined();
      expect(line.unitCostRef).toBeUndefined();
    }
  });

  it("'$' en el texto de una línea marca todo el documento como anomalía (6.21)", () => {
    const result = matchInvoice(
      buildExtraction({ lines: [buildLine(), buildLine({ rawText: "ACEITE 1L $ 2,50", description: "ACEITE 1L" })] }),
      buildContext(),
    );

    expect(result.lines.every((line) => line.status === "doubtful")).toBe(true);
    expect(result.lines[0].issues).toContain(USD_DOCUMENT_ISSUE);
  });

  it("línea sin precio: dudosa con aviso y sin costos", () => {
    const result = matchInvoice(
      buildExtraction({ lines: [buildLine({ unitPrice: 0, lineTotal: Number.NaN })] }),
      buildContext(),
    );

    expect(result.lines[0].status).toBe("doubtful");
    expect(result.lines[0].productId).toBe("p-malta");
    expect(result.lines[0].issues).toEqual([NO_PRICE_ISSUE]);
    expect(result.lines[0].unitCostVes).toBeUndefined();
  });
});

describe("matchInvoice · alícuota", () => {
  function taxOf(line: Parameters<typeof buildLine>[0], ctx = buildContext()) {
    return matchInvoice(buildExtraction({ lines: [buildLine(line)] }), ctx).lines[0].taxRateCode;
  }

  it("exento por categoría del producto", () => {
    expect(taxOf({ description: "HARINA PAN 1KG" })).toBe("exento");
  });

  it("exento leído (taxHint o '(E)' en el texto) gana a la categoría", () => {
    expect(taxOf({ taxHint: "exento" })).toBe("exento");
    expect(taxOf({ rawText: "MALTA POLAR 355 ML (E)" })).toBe("exento");
  });

  it("alícuota por categoría cuando la factura no dice nada", () => {
    expect(taxOf({ description: "ACEITE", supplierSku: "ACE-1" })).toBe("reducida");
    expect(taxOf({ taxHint: "unknown" })).toBe("general");
  });

  it("alícuota leída activa gana a la categoría; inactiva cae a la categoría", () => {
    expect(taxOf({ description: "HARINA PAN 1KG", taxHint: "general" })).toBe("general");
    const ctx = buildContext();
    ctx.taxRates = ctx.taxRates.filter((rate) => rate.kind !== "reducida");
    expect(taxOf({ description: "HARINA PAN 1KG", taxHint: "reducida" }, ctx)).toBe("exento");
  });

  it("sin producto: la por defecto de la tienda, luego la general, luego 'general'", () => {
    const ctx = buildContext();
    ctx.taxRates = ctx.taxRates.map((rate) => ({ ...rate, isDefault: rate.code === "reducida" }));
    expect(taxOf({ description: "COSA RARA" }, ctx)).toBe("reducida");
    expect(taxOf({ description: "COSA RARA" })).toBe("general");
    expect(taxOf({ description: "COSA RARA" }, buildContext({ taxRates: [] }))).toBe("general");
  });
});

describe("matchInvoice · totales", () => {
  it("suma de líneas igual al subtotal leído: sin descuadre", () => {
    const result = matchInvoice(buildExtraction({ subtotal: 600, tax: 96, total: 696 }), buildContext());

    expect(result.totals).toEqual({ read: 696, computed: 600, mismatch: false });
  });

  it("solo total con IVA incluido: sin descuadre", () => {
    const result = matchInvoice(buildExtraction({ total: 696 }), buildContext());

    expect(result.totals.mismatch).toBe(false);
  });

  it("total que no cuadra con las líneas: mismatch", () => {
    const result = matchInvoice(buildExtraction({ total: 800 }), buildContext());

    expect(result.totals).toEqual({ read: 800, computed: 600, mismatch: true });
  });

  it("subtotal + IVA que no da el total leído: mismatch", () => {
    const result = matchInvoice(buildExtraction({ subtotal: 600, tax: 96, total: 720 }), buildContext());

    expect(result.totals.mismatch).toBe(true);
  });

  it("dentro de la tolerancia (1 Bs mínimo): sin descuadre", () => {
    const result = matchInvoice(buildExtraction({ subtotal: 600.9 }), buildContext());

    expect(result.totals.mismatch).toBe(false);
  });

  it("sin totales leídos: computed y sin descuadre", () => {
    const result = matchInvoice(buildExtraction(), buildContext());

    expect(result.totals).toEqual({ computed: 600, mismatch: false });
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    "alias exacto con cantidad %p: dudosa con aviso de cantidad inválida",
    (quantity) => {
      const line = matchInvoice(buildExtraction({ lines: [buildLine({ quantity })] }), buildContext()).lines[0];

      expect(line.status).toBe("doubtful");
      expect(line.issues).toContain("Cantidad inválida en la factura: revísala.");
    },
  );

  it.each([
    ["unitPrice negativo", { unitPrice: -50 }],
    ["unitPrice NaN", { unitPrice: Number.NaN }],
    ["lineTotal negativo", { lineTotal: -600 }],
    ["lineTotal infinito", { lineTotal: Number.POSITIVE_INFINITY }],
  ])("alias exacto con %s y el otro importe válido: dudosa con aviso de precio inválido", (_label, overrides) => {
    const line = matchInvoice(buildExtraction({ lines: [buildLine(overrides)] }), buildContext()).lines[0];

    expect(line.status).toBe("doubtful");
    expect(line.issues).toContain("Precio inválido en la factura: revísalo.");
  });

  it("desvío de exactamente +40 % no avisa (4,20 frente a 3,00); +40,01 % sí (6.18)", () => {
    const at = (total: number) =>
      matchInvoice(
        buildExtraction({
          lines: [buildLine({ description: "COLA 2L", supplierSku: "REF 2L", quantity: 1, unitPrice: total, lineTotal: total })],
        }),
        buildContext(),
      ).lines[0];

    expect(at(420)).toMatchObject({ status: "confirmed", issues: [] });
    expect(at(420.03).status).toBe("doubtful");
    expect(at(420.03).issues[0]).toMatch(/^¿Precio por caja o por unidad\?/);
  });
});
