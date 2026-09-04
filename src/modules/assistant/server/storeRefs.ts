import { resolveDataSource } from "@/lib/api/dataSource";
import * as storesMock from "@/modules/platform/services/stores.mock-server";
import * as storesServer from "@/modules/platform/services/stores.server";

export type AssistantStore = {
  id: string;
  isActive: boolean;
  name: string;
  slug: string;
};

export class StoreRefError extends Error {
  constructor(
    message: string,
    public readonly options: string[],
  ) {
    super(message);
    this.name = "StoreRefError";
  }
}

function normalize(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

export async function listAssistantStores(): Promise<AssistantStore[]> {
  const params = new URLSearchParams("limit=100&skip=0");
  const result =
    resolveDataSource() === "mock"
      ? storesMock.listStores(params)
      : await storesServer.listStores(params);

  return result.items.map((store) => ({
    id: store.id,
    isActive: store.status === "active",
    name: store.name,
    slug: store.slug,
  }));
}

/**
 * Traduce referencias del usuario (id, slug o nombre, sin acentos y sin
 * distinguir mayusculas) a ids reales. Nunca acepta un id que no exista.
 * Ambiguo o no encontrado -> `StoreRefError` con los candidatos.
 */
export function resolveStoreRefs(refs: string[], stores: AssistantStore[]): AssistantStore[] {
  const names = stores.map((store) => store.name);
  const resolved: AssistantStore[] = [];

  for (const ref of refs) {
    const needle = normalize(ref);

    if (!needle) {
      continue;
    }

    const exact = stores.filter(
      (store) =>
        store.id === ref || normalize(store.slug) === needle || normalize(store.name) === needle,
    );

    if (exact.length === 1) {
      resolved.push(exact[0]!);
      continue;
    }

    const partial = stores.filter(
      (store) => normalize(store.name).includes(needle) || normalize(store.slug).includes(needle),
    );

    if (partial.length === 1) {
      resolved.push(partial[0]!);
      continue;
    }

    if (partial.length === 0) {
      throw new StoreRefError(`No existe ninguna tienda que coincida con "${ref}".`, names);
    }

    throw new StoreRefError(
      `"${ref}" coincide con varias tiendas; se necesita el nombre exacto.`,
      partial.map((store) => store.name),
    );
  }

  return [...new Map(resolved.map((store) => [store.id, store])).values()];
}
