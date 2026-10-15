/**
 * Límites del escaneo de facturas compartidos por el cliente (preparación de
 * páginas) y el servidor (Storage y validación). Sin dependencias del navegador
 * ni de Node para que ambos lados lo importen.
 */

/** Peso máximo de cada página ya comprimida: 1 MB. */
export const INVOICE_MAX_BYTES = 1_048_576;

/** Lado mayor máximo de cada página, en píxeles. */
export const INVOICE_MAX_SIDE = 1600;

/** Páginas máximas por factura (imágenes o páginas de PDF). */
export const INVOICE_MAX_PAGES = 10;
