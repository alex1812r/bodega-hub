import type { ConfirmActionStatus } from "@/shared/components/ConfirmActionModal";

import type { StoreVault } from "../../types";

type VaultQueryLike = {
  data?: StoreVault;
  error: Error | null;
};

export type VaultBalancesState =
  | { status: "ready"; statusMessage: null; vault: StoreVault }
  | {
      status: Extract<ConfirmActionStatus, "loading" | "error">;
      statusMessage: string;
      vault: null;
    };

/**
 * Sin los saldos del baúl no hay efecto que enseñar: la confirmación espera o
 * muestra el error, pero nunca deja confirmar a ciegas.
 */
export function getVaultBalancesState(query: VaultQueryLike): VaultBalancesState {
  if (query.data) {
    return { status: "ready", statusMessage: null, vault: query.data };
  }

  if (query.error) {
    return {
      status: "error",
      statusMessage: query.error.message || "No se pudieron cargar los saldos del baúl.",
      vault: null,
    };
  }

  return { status: "loading", statusMessage: "Cargando los saldos del baúl…", vault: null };
}
