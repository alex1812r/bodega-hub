import { z } from "zod";

import { assistantDatePresets } from "../dates";

export const presetSchema = z
  .enum(assistantDatePresets)
  .describe(
    "Periodo relativo al dia de hoy en Caracas. Usalo cuando la pregunta no traiga fechas exactas.",
  );

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.")
  .describe("Fecha en formato YYYY-MM-DD (dia operativo de Caracas).");

/** Bloque de fechas comun a casi todas las herramientas. */
export const rangeShape = {
  from: isoDateSchema.optional().describe("Fecha inicial inclusiva. Omitir si usas preset."),
  preset: presetSchema.optional(),
  to: isoDateSchema.optional().describe("Fecha final inclusiva. Omitir si usas preset."),
};

export const limitShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Cuantas filas devolver (1 a 20). Por defecto 5."),
};
