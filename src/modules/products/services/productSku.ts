import { generateProductSkuFromName } from "@/shared/utils/skuGeneration";

/** Intentos de alta con SKU generado: el derivado del nombre y hasta cuatro con sufijo. */
export const GENERATED_SKU_MAX_ATTEMPTS = 5;

export const GENERATED_SKU_EXHAUSTED_MESSAGE =
  "No se pudo generar un SKU único para este producto. Escribe uno e intenta de nuevo.";

const SKU_MAX_LENGTH = 32;
const SUFFIX_LENGTH = 4;
const FALLBACK_SKU = "producto";

function randomSkuSuffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, SUFFIX_LENGTH);
}

/**
 * SKU que el servidor pone a un producto creado sin SKU. El intento 0 es el
 * derivado del nombre (`generateProductSkuFromName`, sin tildes ni ñ); los
 * siguientes le añaden un sufijo aleatorio para salir de una colisión en la
 * tienda. Un nombre sin letras ni dígitos (solo símbolos o emoji) da `producto`.
 */
export function buildGeneratedSku(name: string, attempt: number) {
  const fromName = generateProductSkuFromName(name, SKU_MAX_LENGTH);
  const base = /[a-z0-9]/.test(fromName) ? fromName : FALLBACK_SKU;

  if (attempt === 0) {
    return base;
  }

  const stem = base.slice(0, SKU_MAX_LENGTH - SUFFIX_LENGTH - 1).replace(/-+$/, "");

  return `${stem}-${randomSkuSuffix()}`;
}
