import { buildContext, buildExtraction, SUPPLIER_CHEVERE, SUPPLIER_PEPSI, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { matchInvoice } from "./match";

describe("matchInvoice · proveedor", () => {
  it("resuelve por RIF normalizado (sin guiones, prefijo ni espacios)", () => {
    const result = matchInvoice(
      buildExtraction({ supplier: { name: "Nombre ilegible", taxId: "j 40123456 7" } }),
      buildContext(),
    );

    expect(result.supplier.contactId).toBe(SUPPLIER_CHEVERE);
    expect(result.supplier.candidates).toEqual([
      { contactId: SUPPLIER_CHEVERE, name: "Chevere Depot", score: 1, reason: "RIF igual" },
    ]);
  });

  it("resuelve por nombre con score alto y margen sobre el segundo", () => {
    const result = matchInvoice(buildExtraction({ supplier: { name: "PEPSI COLA VENEZUELA" } }), buildContext());

    expect(result.supplier.contactId).toBe(SUPPLIER_PEPSI);
    expect(result.supplier.candidates?.[0]).toMatchObject({ contactId: SUPPLIER_PEPSI, reason: "nombre parecido 1,00" });
  });

  it("usa el score ya calculado por la base cuando viene", () => {
    const ctx = buildContext({
      supplierCandidates: [
        { contactId: SUPPLIER_POLAR, name: "Distribuidora Polar C.A.", score: 0.91 },
        { contactId: SUPPLIER_PEPSI, name: "Pepsi-Cola Venezuela", score: 0.3 },
      ],
    });
    const result = matchInvoice(buildExtraction({ supplier: { name: "POLAR" } }), ctx);

    expect(result.supplier.contactId).toBe(SUPPLIER_POLAR);
    expect(result.supplier.candidates?.map((c) => c.reason)).toEqual(["nombre parecido 0,91", "nombre parecido 0,30"]);
  });

  it("dos nombres parecidos sin margen: solo candidatos y ninguna línea confirmada", () => {
    const ctx = buildContext({
      supplierCandidates: [
        { contactId: SUPPLIER_POLAR, name: "Distribuidora Polar C.A.", score: 0.85 },
        { contactId: "sup-polar-2", name: "Distribuidora Polar Oriente", score: 0.82 },
      ],
    });
    const result = matchInvoice(buildExtraction({ supplier: { name: "DISTRIBUIDORA POLAR" } }), ctx);

    expect(result.supplier.contactId).toBeUndefined();
    expect(result.supplier.candidates).toHaveLength(2);
    expect(result.lines.some((line) => line.status === "confirmed")).toBe(false);
  });

  it("no resuelve por nombre un contacto cuyo RIF contradice el leído", () => {
    const result = matchInvoice(
      buildExtraction({ supplier: { name: "Chevere Depot", taxId: "J-99999999-9" } }),
      buildContext(),
    );

    expect(result.supplier.contactId).toBeUndefined();
    expect(result.supplier.candidates?.[0].contactId).toBe(SUPPLIER_CHEVERE);
  });

  it("sin candidatos: proveedor vacío", () => {
    const result = matchInvoice(buildExtraction(), buildContext({ supplierCandidates: [] }));

    expect(result.supplier).toEqual({});
    expect(result.lines[0].status).not.toBe("confirmed");
  });
});

describe("matchInvoice · duplicado", () => {
  it("mismo proveedor y número normalizado: duplicateOfScanId", () => {
    const result = matchInvoice(
      buildExtraction({ number: "000-12345" }),
      buildContext({
        previousScans: [
          { scanId: "scan-otro", supplierId: SUPPLIER_CHEVERE, number: "12345" },
          { scanId: "scan-viejo", supplierId: SUPPLIER_POLAR, number: "0012345" },
        ],
      }),
    );

    expect(result.duplicateOfScanId).toBe("scan-viejo");
  });

  it("por RIF aunque el escaneo anterior no tenga proveedor resuelto", () => {
    const result = matchInvoice(
      buildExtraction(),
      buildContext({ previousScans: [{ scanId: "scan-rif", supplierTaxId: "J-00041312-3", number: "12345" }] }),
    );

    expect(result.duplicateOfScanId).toBe("scan-rif");
  });

  it("otro número u otro proveedor: no es duplicado", () => {
    const result = matchInvoice(
      buildExtraction(),
      buildContext({
        previousScans: [
          { scanId: "a", supplierId: SUPPLIER_POLAR, number: "12346" },
          { scanId: "b", supplierId: SUPPLIER_CHEVERE, number: "12345" },
        ],
      }),
    );

    expect(result.duplicateOfScanId).toBeUndefined();
  });
});

describe("matchInvoice · proveedor por RIF con letra (SCN-11-F5)", () => {
  const ctx = () =>
    buildContext({
      supplierCandidates: [
        { contactId: SUPPLIER_POLAR, name: "Inversiones Pérez C.A.", taxId: "J-508357612" },
        { contactId: SUPPLIER_PEPSI, name: "Otra Empresa", taxId: "J-11111111-1" },
      ],
    });

  it("una cédula V- no resuelve al contacto J- con los mismos dígitos", () => {
    const result = matchInvoice(buildExtraction({ supplier: { name: "Persona", taxId: "V-508357612" } }), ctx());

    expect(result.supplier.contactId).toBeUndefined();
    expect(result.supplier.candidates?.some((c) => c.reason === "RIF igual")).toBe(false);
  });

  it("ni por nombre si el RIF guardado tiene otra letra", () => {
    const result = matchInvoice(
      buildExtraction({ supplier: { name: "Inversiones Pérez C.A.", taxId: "V-508357612" } }),
      ctx(),
    );

    expect(result.supplier.contactId).toBeUndefined();
  });

  it("si el RIF leído no trae letra, bastan los dígitos", () => {
    const result = matchInvoice(buildExtraction({ supplier: { name: "Persona", taxId: "508357612" } }), ctx());

    expect(result.supplier.contactId).toBe(SUPPLIER_POLAR);
  });
});
