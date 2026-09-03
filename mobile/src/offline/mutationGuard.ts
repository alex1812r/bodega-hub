import NetInfo from "@react-native-community/netinfo";

export class OfflineError extends Error {
  constructor(action?: string) {
    super(
      action
        ? `No hay conexion. No se puede ${action} sin internet.`
        : "No hay conexion. Esta operacion necesita internet.",
    );
    this.name = "OfflineError";
  }
}

/**
 * Toda mutacion pasa por aqui. La cola de ventas offline es post-GTM: mientras
 * tanto se bloquea con un mensaje claro en vez de fingir que se guardo.
 */
export async function assertOnline(action?: string) {
  const state = await NetInfo.fetch();
  const reachable = state.isInternetReachable;

  if (!state.isConnected || reachable === false) {
    throw new OfflineError(action);
  }
}
