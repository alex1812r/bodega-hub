import { useMemo } from "react";

import { useAuth } from "@/auth/AuthContext";
import { getAccessToken } from "@/auth/session";

import { createApiClient } from "./apiClient";

/**
 * Cliente HTTP ligado a la sesion actual: mete el Bearer, los headers demo y
 * cierra sesion ante un 401.
 */
export function useApi() {
  const { demoAuth, signOutSession } = useAuth();

  return useMemo(
    () =>
      createApiClient({
        getAccessToken,
        getDemoAuth: () => demoAuth,
        onUnauthorized: () => {
          void signOutSession("Tu sesion expiro. Vuelve a entrar.");
        },
      }),
    [demoAuth, signOutSession],
  );
}
