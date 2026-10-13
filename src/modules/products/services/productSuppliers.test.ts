import { ApiError } from "@/lib/api/apiError";

import {
  attachPreferredSuppliers,
  mergeProductSupplierInputs,
  parseSaveProductSuppliersInput,
  PRODUCT_SUPPLIER_MAX_COST_REF,
  PRODUCT_SUPPLIERS_MAX,
  saveProductSuppliersSchema,
  sortProductSupplierLinks,
  type ProductSupplierLink,
} from "./productSuppliers";

/** Mensajes de los `issues` de Zod (o el del `ApiError`) con los que el `PUT` responde 400. */
function rejectionMessages(body: unknown): string[] {
  try {
    parseSaveProductSuppliersInput(body);
  } catch (error) {
    if (error instanceof ApiError) return [`${error.status}: ${error.message}`];

    const result = saveProductSuppliersSchema.safeParse(body);
    if (!result.success) return result.error.issues.map((issue) => issue.message);

    throw error;
  }

  throw new Error("Se esperaba un rechazo");
}

describe("parseSaveProductSuppliersInput", () => {
  it("normaliza cada fila: costo a 2 decimales, código en minúsculas, habitual false por defecto y claves ausentes sin tocar", () => {
    expect(
      parseSaveProductSuppliersInput({
        suppliers: [
          { costRef: 4.126, isPreferred: true, supplierId: " sup-1 ", supplierSku: " ABC-01 " },
          { supplierId: "sup-2" },
          { costRef: null, supplierId: "sup-3", supplierSku: null },
          { costRef: 0, supplierId: "sup-4", supplierSku: "" },
        ],
      }),
    ).toEqual([
      { costRef: 4.13, isPreferred: true, supplierId: "sup-1", supplierSku: "abc-01" },
      { isPreferred: false, supplierId: "sup-2" },
      { isPreferred: false, supplierId: "sup-3", supplierSku: null },
      { costRef: 0, isPreferred: false, supplierId: "sup-4", supplierSku: null },
    ]);
  });

  it("acepta la lista vacía (quitar todos los proveedores) y el tope de 50", () => {
    const fifty = Array.from({ length: PRODUCT_SUPPLIERS_MAX }, (_, index) => ({ supplierId: `sup-${index}` }));

    expect(parseSaveProductSuppliersInput({ suppliers: [] })).toEqual([]);
    expect(parseSaveProductSuppliersInput({ suppliers: fifty })).toHaveLength(50);
  });

  it("funde el mismo proveedor repetido: posición de la primera aparición, datos de la última y habitual si alguna lo marca", () => {
    expect(
      parseSaveProductSuppliersInput({
        suppliers: [
          { costRef: 1, isPreferred: true, supplierId: "sup-1", supplierSku: "viejo" },
          { supplierId: "sup-2" },
          { costRef: 9, supplierId: "sup-1" },
        ],
      }),
    ).toEqual([
      { costRef: 9, isPreferred: true, supplierId: "sup-1" },
      { isPreferred: false, supplierId: "sup-2" },
    ]);
  });

  it("dos filas del MISMO proveedor marcadas habitual no son error; dos proveedores distintos sí (400 en español)", () => {
    const sameSupplier = parseSaveProductSuppliersInput({
      suppliers: [
        { isPreferred: true, supplierId: "sup-1" },
        { isPreferred: true, supplierId: "sup-1" },
      ],
    });

    expect(sameSupplier).toEqual([{ isPreferred: true, supplierId: "sup-1" }]);
    expect(
      rejectionMessages({
        suppliers: [
          { isPreferred: true, supplierId: "sup-1" },
          { isPreferred: true, supplierId: "sup-2" },
        ],
      }),
    ).toEqual(["400: Solo un proveedor puede ser el habitual del producto."]);
  });

  it.each([
    ["costo negativo", { suppliers: [{ costRef: -0.01, supplierId: "sup-1" }] }, "El costo del proveedor no puede ser negativo."],
    ["costo NaN", { suppliers: [{ costRef: Number.NaN, supplierId: "sup-1" }] }, "El costo del proveedor debe ser un número."],
    ["costo infinito", { suppliers: [{ costRef: Number.POSITIVE_INFINITY, supplierId: "sup-1" }] }, "El costo del proveedor debe ser un número."],
    ["costo como texto", { suppliers: [{ costRef: "4", supplierId: "sup-1" }] }, "El costo del proveedor debe ser un número."],
    [
      "costo fuera de rango",
      { suppliers: [{ costRef: PRODUCT_SUPPLIER_MAX_COST_REF + 1, supplierId: "sup-1" }] },
      "El costo del proveedor está fuera de rango.",
    ],
    ["proveedor vacío", { suppliers: [{ supplierId: "  " }] }, "El proveedor es obligatorio."],
    ["sin proveedor", { suppliers: [{ costRef: 1 }] }, "El proveedor es obligatorio."],
    ["habitual que no es booleano", { suppliers: [{ isPreferred: "si", supplierId: "sup-1" }] }, "La marca de proveedor habitual no es válida."],
    ["código que no es texto", { suppliers: [{ supplierId: "sup-1", supplierSku: 7 }] }, "El código del proveedor no es válido."],
    ["sin lista", {}, "La lista de proveedores no es válida."],
    ["lista que no es lista", { suppliers: "sup-1" }, "La lista de proveedores no es válida."],
    [
      "más de 50",
      { suppliers: Array.from({ length: PRODUCT_SUPPLIERS_MAX + 1 }, (_, index) => ({ supplierId: `sup-${index}` })) },
      "Un producto admite como máximo 50 proveedores.",
    ],
  ])("rechaza %s con mensaje en español", (_case, body, message) => {
    expect(rejectionMessages(body)).toEqual([message]);
  });
});

describe("mergeProductSupplierInputs", () => {
  it("no cambia una lista sin repetidos", () => {
    const inputs = [
      { isPreferred: false, supplierId: "a" },
      { costRef: 2, isPreferred: true, supplierId: "b" },
    ];

    expect(mergeProductSupplierInputs(inputs)).toEqual(inputs);
  });
});

describe("sortProductSupplierLinks / attachPreferredSuppliers", () => {
  const link = (id: string, supplierName: string, isPreferred = false): ProductSupplierLink => ({
    costRef: 0,
    id,
    isPreferred,
    supplierId: `sup-${id}`,
    supplierIsActive: true,
    supplierName,
  });

  it("ordena el habitual primero y después por nombre", () => {
    expect(
      sortProductSupplierLinks([link("1", "Zeta"), link("2", "Beta", true), link("3", "Alfa")]).map((item) => item.id),
    ).toEqual(["2", "3", "1"]);
  });

  it("añade preferredSupplier solo a los productos que tienen habitual", () => {
    expect(
      attachPreferredSuppliers(
        [{ id: "p1" }, { id: "p2" }],
        new Map([["p2", { id: "sup-1", name: "Proveedor Uno" }]]),
      ),
    ).toEqual([{ id: "p1" }, { id: "p2", preferredSupplier: { id: "sup-1", name: "Proveedor Uno" } }]);
  });
});
