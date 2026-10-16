/**
 * Formato de verdad del banco de evaluación (SCN-10d).
 *
 * Fuente: `.notes/factura-escaneo/evaluacion/truth-format.md`. Cada archivo
 * `scripts/invoice-eval/truth/<id>.json` describe lo que un lector perfecto
 * devolvería (`extraction`, mismo contrato que el escaneo) más, por línea, el
 * producto esperado del catálogo y si la línea está tapada en la foto.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { invoiceExtractionLineSchema, invoiceExtractionSchema } from "../../src/modules/invoice-scan/contracts";

/** Campos de línea que la verdad puede declarar inciertos (excluidos de exactitud). */
export const truthUncertainFieldSchema = invoiceExtractionLineSchema.keyof();
export type TruthUncertainField = z.infer<typeof truthUncertainFieldSchema>;

export const truthLineSchema = z.object({
  /** Slug del producto UNIDAD del catálogo; null si no es mercancía (ENVIO). */
  productKey: z.string().min(1).nullable(),
  /** La foto tapa la línea: el banco exige no inventarla, no leerla. */
  occluded: z.boolean(),
  uncertainFields: z.array(truthUncertainFieldSchema),
  note: z.string(),
});
export type TruthLine = z.infer<typeof truthLineSchema>;

export const truthVerificationSchema = z.object({
  checkedAgainstImage: z.boolean(),
  manifestDiffs: z.array(z.string()),
  arithmetic: z.string(),
});

export const invoiceTruthSchema = z
  .object({
    id: z.string().min(1),
    synthetic: z.boolean(),
    /** Rutas relativas a `scripts/invoice-eval/`, en orden. */
    pages: z.array(z.string().min(1)).min(1),
    /** Slug del proveedor; null si la imagen no es una factura. */
    supplierKey: z.string().min(1).nullable(),
    /** Id de la factura original si esta es una segunda foto de la misma. */
    duplicateOf: z.string().min(1).nullable(),
    extraction: invoiceExtractionSchema,
    lines: z.array(truthLineSchema),
    verification: truthVerificationSchema,
  })
  .refine((truth) => truth.lines.length === truth.extraction.lines.length, {
    message: "lines debe tener el mismo largo que extraction.lines",
    path: ["lines"],
  });
export type InvoiceTruth = z.infer<typeof invoiceTruthSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(raíz)"}: ${issue.message}`)
    .join("; ");
}

/** Valida un objeto ya parseado; `source` solo se usa en el mensaje de error. */
export function parseTruth(raw: unknown, source: string): InvoiceTruth {
  const result = invoiceTruthSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Verdad inválida en ${source}: ${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Lee y valida todos los `*.json` de `dir`, ordenados por id. Falla con el
 * nombre del archivo si el JSON no parsea, no cumple el schema o su `id` no
 * coincide con el nombre del archivo.
 */
export function loadTruth(dir: string): InvoiceTruth[] {
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort();
  const truths = files.map((file) => {
    const path = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Verdad inválida en ${file}: JSON mal formado (${reason})`);
    }
    const truth = parseTruth(raw, file);
    const expectedId = basename(file, ".json");
    if (truth.id !== expectedId) {
      throw new Error(`Verdad inválida en ${file}: id "${truth.id}" no coincide con el archivo ("${expectedId}")`);
    }
    return truth;
  });
  return truths.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}
