/**
 * Clave de idempotencia del cobro del POS, DERIVADA del carrito (POS-H6).
 *
 * Dos pestañas con una copia del mismo carrito (mismo `cartId`, ver `posCartDraft.ts`)
 * calculan la misma clave sin leer ni escribir nada compartido: aunque pulsen «Cobrar» a
 * la vez, el servidor ve UNA clave y registra una sola venta (`create_sale_with_payments`
 * serializa por tienda y clave). La marca «cobrando» de `localStorage` sigue siendo la
 * primera barrera; esta clave es la garantía.
 *
 * Entra en la clave: la identidad del carrito, el cliente y las líneas (producto y
 * cantidad, sin importar el orden). Es lo que el POS envía y lo que define «el mismo
 * carrito»; cambiar cualquiera de ellos estrena clave.
 * NO entra el cobro (método, montos, vuelto): con el mismo carrito y otro método las dos
 * pestañas deben chocar en la misma clave, y el servidor responde 409 a la segunda
 * (misma clave, otro contenido) en vez de registrar otra venta. Tampoco el precio: lo
 * pone el servidor y dos pestañas pueden ver catálogos de momentos distintos.
 *
 * Una venta nueva estrena `cartId`, así que dos ventas seguidas con los mismos productos
 * tienen claves distintas y no se fusionan.
 *
 * Sin dependencias y síncrono: no es criptográfico ni lo necesita (la entrada lleva un
 * `cartId` aleatorio y nadie gana nada provocando una colisión consigo mismo).
 */
export type SaleRequestContent = {
  customerId: string;
  items: ReadonlyArray<{ productId: string; quantity: number }>;
};

/** Huella canónica de lo que identifica al cobro: no depende del orden de las líneas. */
export function canonicalSaleRequestContent(cartId: string, content: SaleRequestContent) {
  const items = content.items
    .map((item) => [item.productId, item.quantity] as const)
    .sort(
      ([leftId, leftQuantity], [rightId, rightQuantity]) =>
        (leftId < rightId ? -1 : leftId > rightId ? 1 : 0) || leftQuantity - rightQuantity,
    );

  return JSON.stringify([cartId, content.customerId, items]);
}

/** Cuatro palabras de 32 bits bien mezcladas a partir de un texto (cyrb128). */
function hash128(text: string) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  return [h1, h2, h3, h4].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * UUID determinista (versión 8 de RFC 9562, variante estándar: lo que acepta
 * `z.string().uuid()` del BFF y el tipo `uuid` de la base) para ese carrito y contenido.
 */
export function deriveSaleRequestId(cartId: string, content: SaleRequestContent) {
  const hex = hash128(canonicalSaleRequestContent(cartId, content));
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
