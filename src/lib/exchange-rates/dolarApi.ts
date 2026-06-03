import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";

import {
  DEFAULT_DOLAR_API_FETCH_TIMEOUT_MS,
  DEFAULT_DOLAR_API_OFFICIAL_URL,
  DOLAR_API_OFFICIAL_SOURCE,
} from "./constants";

const dolarApiOfficialResponseSchema = z.object({
  compra: z.number().nullable().optional(),
  fechaActualizacion: z.string(),
  fuente: z.string(),
  moneda: z.string(),
  nombre: z.string(),
  promedio: z.number().positive(),
  venta: z.number().nullable().optional(),
});

export type OfficialDollarRate = {
  fechaActualizacion: string;
  rateVes: number;
  source: typeof DOLAR_API_OFFICIAL_SOURCE;
};

function getOfficialUrl() {
  return process.env.DOLAR_API_OFFICIAL_URL?.trim() || DEFAULT_DOLAR_API_OFFICIAL_URL;
}

function getFetchTimeoutMs() {
  const raw = process.env.DOLAR_API_FETCH_TIMEOUT_MS;

  if (!raw) {
    return DEFAULT_DOLAR_API_FETCH_TIMEOUT_MS;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DOLAR_API_FETCH_TIMEOUT_MS;
}

export async function fetchOfficialDollarRate(): Promise<OfficialDollarRate> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getFetchTimeoutMs());

  try {
    const response = await fetch(getOfficialUrl(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(
        502,
        "INTERNAL_ERROR",
        `No se pudo obtener la tasa oficial (${response.status}).`,
      );
    }

    const json: unknown = await response.json();
    const parsed = dolarApiOfficialResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new ApiError(
        502,
        "INTERNAL_ERROR",
        "La respuesta de la tasa oficial no tiene el formato esperado.",
      );
    }

    return {
      fechaActualizacion: parsed.data.fechaActualizacion,
      rateVes: parsed.data.promedio,
      source: DOLAR_API_OFFICIAL_SOURCE,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(
        503,
        "INTERNAL_ERROR",
        "La consulta de tasa oficial excedio el tiempo de espera.",
      );
    }

    throw new ApiError(
      503,
      "INTERNAL_ERROR",
      "No se pudo conectar con el proveedor de tasa oficial.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
