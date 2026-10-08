import { MAX_PAGE_LIMIT, type PaginatedList } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import {
  type EntityFetcher,
  type ProductEntityOption,
  toProductEntityOption,
} from "@/shared/components/EntityAutocomplete";
import type { ProductMock } from "@/shared/mocks/erp-data";

/**
 * Filtro `packLink` de `GET /api/products`:
 * - `none`: sin ningún vínculo activo (ni empaque ni componente).
 * - `not-pack`: fuera solo los empaques de una receta activa; un producto que
 *   ya sale de otro empaque sigue siendo elegible.
 */
export type PackLinkFilter = "none" | "not-pack";

type UnitCandidateOption = ProductEntityOption & { blockedByPackLink: boolean };

type ProductSearchCriteria = { barcode: string } | { search: string } | { sku: string };

/**
 * Candidatos a producto unidad / componente desde `GET /api/products`. Cada
 * búsqueda se pide dos veces, con y sin `packLink`: los que solo vienen sin el
 * filtro no son elegibles y van al final, marcados para mostrarse
 * deshabilitados con su motivo.
 */
export function createUnitCandidatesFetcher(packLink: PackLinkFilter): EntityFetcher<"product"> {
  return async ({ exact, filters, limit, query, signal }): Promise<UnitCandidateOption[]> => {
    // Lector de barras: `barcode` y `sku` son igualdad exacta en servidor.
    const criteria: ProductSearchCriteria[] = exact
      ? [{ barcode: query }, { sku: query }, { search: query }]
      : [{ search: query }];

    async function requestProducts(packLinkFilter?: PackLinkFilter) {
      const pages = await Promise.all(
        criteria.map((criterion) =>
          apiFetch<PaginatedList<ProductMock>>("/api/products", {
            query: {
              ...criterion,
              isActive: filters.active,
              limit: Math.min(MAX_PAGE_LIMIT, limit + (filters.excludeIds?.length ?? 0)),
              packLink: packLinkFilter,
              skip: 0,
            },
            signal,
          }),
        ),
      );

      return pages.flatMap((page) => page.items);
    }

    const [eligible, all] = await Promise.all([requestProducts(packLink), requestProducts()]);
    const eligibleIds = new Set(eligible.map((product) => product.id));
    const seen = new Set<string>();

    return [...eligible, ...all]
      .filter((product) => {
        if (seen.has(product.id)) {
          return false;
        }

        seen.add(product.id);
        return true;
      })
      .map((product) => ({
        ...toProductEntityOption(product),
        blockedByPackLink: !eligibleIds.has(product.id),
      }));
  };
}

/** El candidato solo vino sin el filtro `packLink`: no se puede elegir. */
export function isBlockedByPackLink(option: ProductEntityOption) {
  return "blockedByPackLink" in option && option.blockedByPackLink === true;
}
