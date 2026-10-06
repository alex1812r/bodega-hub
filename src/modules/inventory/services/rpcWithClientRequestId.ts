type RpcResult = { data: unknown; error: unknown };

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/**
 * Llama a una RPC de stock con su clave de idempotencia (`p_client_request_id`):
 * con la misma clave en la misma tienda la base devuelve el resultado original
 * sin mover nada (C6: doble envio de compra, ajuste o conversion).
 *
 * - Sin clave la llamada es identica a la de siempre (clientes que aun no la envian).
 * - Degradacion: si la base no tiene la firma nueva, PostgREST responde `PGRST202`
 *   SIN haber ejecutado nada; se reintenta UNA vez sin la clave (sin idempotencia)
 *   y queda constancia en el log. Nunca un 500 por "falta el parche".
 */
export async function rpcWithClientRequestId(
  supabase: RpcClient,
  rpcName: string,
  args: Record<string, unknown>,
  clientRequestId: string | null | undefined,
): Promise<RpcResult> {
  if (!clientRequestId) {
    return supabase.rpc(rpcName, args);
  }

  const result = await supabase.rpc(rpcName, {
    ...args,
    p_client_request_id: clientRequestId,
  });

  if ((result.error as { code?: unknown } | null)?.code !== "PGRST202") {
    return result;
  }

  console.warn(
    `[stock] ${rpcName} no acepta p_client_request_id: la operacion se ejecuta sin idempotencia (faltan los parches 20261006).`,
  );

  return supabase.rpc(rpcName, args);
}
