import { z } from "zod";

export const NUL_TEXT_MESSAGE = "El texto contiene caracteres no permitidos.";

/**
 * Postgres no admite el carácter nulo (U+0000) en `text` ni en `jsonb`: un texto
 * que lo traiga hace fallar la RPC entera ("unsupported Unicode escape
 * sequence"). Es un dato inválido del cliente, así que se rechaza al validar.
 */
function hasNulCharacter(value: string) {
  return value.includes("\u0000");
}

/** `z.string()` de un texto que acaba en la base: sin carácter nulo. */
export function safeText() {
  return z.string().refine((value) => !hasNulCharacter(value), NUL_TEXT_MESSAGE);
}
