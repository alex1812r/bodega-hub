type RpcResult = { data: unknown; error: unknown };

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** `PGRST202`: PostgREST no encontro una funcion con esos parametros (no ejecuto nada). */
export function isMissingRpcSignatureError(error: unknown) {
  return (error as { code?: unknown } | null)?.code === "PGRST202";
}

/**
 * Llama a una RPC de stock con su clave de idempotencia (`p_client_request_id`):
 * con la misma clave en la misma tienda la base devuelve el resultado original
 * sin mover nada (C6: doble envio de compra, ajuste o conversion).
 *
 * - Sin clave la llamada es identica a la de siempre (clientes que aun no la envian).
 * - Degradacion: si la base no tiene la firma nueva, PostgREST responde `PGRST202`
 *   SIN haber ejecutado nada; se reintenta UNA vez sin la clave (sin idempotencia)
 *   y queda constancia en el log. Nunca un 500 por "falta el parche".
 * - `requiredArgs` (R4: `p_sale_id` / `p_purchase_id`): parametros de la firma nueva
 *   que NO se pueden quitar. Si van y la base responde `PGRST202` no se reintenta
 *   (ni sin ellos ni sin la clave): se devuelve ese error y decide quien llama.
 */
export async function rpcWithClientRequestId(
  supabase: RpcClient,
  rpcName: string,
  args: Record<string, unknown>,
  clientRequestId: string | null | undefined,
  requiredArgs: Record<string, unknown> = {},
): Promise<RpcResult> {
  const hasRequiredArgs = Object.keys(requiredArgs).length > 0;

  if (!clientRequestId) {
    return supabase.rpc(rpcName, hasRequiredArgs ? { ...args, ...requiredArgs } : args);
  }

  const result = await supabase.rpc(rpcName, {
    ...args,
    ...requiredArgs,
    p_client_request_id: clientRequestId,
  });

  if (!isMissingRpcSignatureError(result.error) || hasRequiredArgs) {
    return result;
  }

  console.warn(
    `[stock] ${rpcName} no acepta p_client_request_id: la operacion se ejecuta sin idempotencia (faltan los parches 20261006).`,
  );

  return supabase.rpc(rpcName, args);
}
