/**
 * Schema mínimo de `InvoiceMatch` (contrato en `../contracts.ts`, que solo
 * declara el tipo) para validar el `matched` guardado antes de servirlo desde
 * el caché (caos-4 B1). Acepta campos de más: Emparejamiento puede añadirlos.
 */
import { z } from "zod";

import { invoiceMatchStatuses, type InvoiceMatch } from "../contracts";

const score = z.number();

const lineMatchSchema = z.object({
  candidates: z
    .array(z.object({ name: z.string(), productId: z.string(), reason: z.string(), score }))
    .optional(),
  disassembleOnReceive: z.boolean().optional(),
  entryMode: z.enum(["unit", "pack"]),
  index: z.number().int().nonnegative(),
  issues: z.array(z.string()),
  lastUnitCostRef: z.number().positive().optional(),
  packUnitId: z.string().optional(),
  productId: z.string().optional(),
  status: z.enum(invoiceMatchStatuses),
  taxRateCode: z.string(),
  unitCostRef: z.number().optional(),
  unitCostVes: z.number().optional(),
  unitsPerPack: z.number().positive().optional(),
});

export const invoiceMatchSchema: z.ZodType<InvoiceMatch> = z.object({
  duplicateOfScanId: z.string().optional(),
  lines: z.array(lineMatchSchema),
  rate: z
    .object({ printed: z.number().optional(), system: z.number().optional(), warning: z.string().optional() })
    .optional(),
  supplier: z.object({
    candidates: z
      .array(z.object({ contactId: z.string(), name: z.string(), reason: z.string(), score }))
      .optional(),
    contactId: z.string().optional(),
  }),
  totals: z.object({ computed: z.number(), mismatch: z.boolean(), read: z.number().optional() }),
});
