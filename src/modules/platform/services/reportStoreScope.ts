import { ApiError } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { normalizeStoreIds } from "@/modules/reports/services/storeScope";

import type { PlatformStoreScope } from "../types/reports";
import * as storesMock from "./stores.mock-server";

export type { PlatformStoreScope };

export function parsePlatformStoreScope(
  searchParams: URLSearchParams,
): PlatformStoreScope {
  const raw = searchParams.get("storeScope");
  if (raw === "one" || raw === "selected" || raw === "all") {
    return raw;
  }
  return "all";
}

export function parseSelectedStoreIds(searchParams: URLSearchParams): string[] {
  const fromCsv = (searchParams.get("storeIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const fromRepeated = searchParams.getAll("storeId").map((id) => id.trim()).filter(Boolean);
  return normalizeStoreIds([...fromCsv, ...fromRepeated]);
}

async function listAllStoreIds(): Promise<string[]> {
  if (resolveDataSource() === "mock") {
    return storesMock.listStores(new URLSearchParams("limit=100&skip=0")).items.map((store) => store.id);
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("stores").select("id").order("name");
  throwIfSupabaseError(error);
  return (data ?? []).map((row) => (row as { id: string }).id);
}

/**
 * Resuelve el alcance de tiendas para reportes de plataforma.
 * - all: todas las tiendas
 * - one / selected: exige storeIds validos
 */
export async function resolvePlatformReportStoreIds(
  searchParams: URLSearchParams,
): Promise<string[]> {
  const scope = parsePlatformStoreScope(searchParams);
  const selected = parseSelectedStoreIds(searchParams);
  const allIds = await listAllStoreIds();

  if (allIds.length === 0) {
    throw new ApiError(400, "BAD_REQUEST", "No hay tiendas disponibles para reportar.");
  }

  if (scope === "all") {
    return allIds;
  }

  if (selected.length === 0) {
    throw new ApiError(400, "BAD_REQUEST", "Selecciona al menos una tienda.");
  }

  if (scope === "one" && selected.length !== 1) {
    throw new ApiError(400, "BAD_REQUEST", "Selecciona exactamente una tienda.");
  }

  const unknown = selected.filter((id) => !allIds.includes(id));
  if (unknown.length > 0) {
    throw new ApiError(400, "BAD_REQUEST", "Una o mas tiendas no existen.");
  }

  return selected;
}
