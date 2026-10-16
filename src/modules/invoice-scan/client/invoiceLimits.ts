/**
 * Límites del escaneo de facturas compartidos por el cliente (preparación de
 * páginas) y el servidor (Storage y validación). Sin dependencias del navegador
 * ni de Node para que ambos lados lo importen.
 */

/** Peso máximo de cada página que aceptan el bucket y el servidor: 1 MiB. */
export const INVOICE_MAX_BYTES = 1_048_576;

/**
 * Peso objetivo de la compresión en el cliente: 1 MB decimal, como pide el
 * plan. Queda por debajo de `INVOICE_MAX_BYTES` para no rozar el límite.
 */
export const INVOICE_TARGET_BYTES = 1_000_000;

/** Lado mayor máximo de cada página, en píxeles. */
export const INVOICE_MAX_SIDE = 1600;

/** Páginas máximas por factura (imágenes o páginas de PDF). */
export const INVOICE_MAX_PAGES = 10;
