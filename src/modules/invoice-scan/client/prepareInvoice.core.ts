/**
 * Lógica pura de la preparación de facturas: tipos aceptados, dimensiones
 * objetivo, bucle de compresión con un encoder inyectable y hash del escaneo.
 * No toca canvas ni pdfjs, así que se prueba en jest sin navegador.
 */
import { INVOICE_MAX_PAGES, INVOICE_MAX_SIDE, INVOICE_TARGET_BYTES } from "./invoiceLimits";
import type { InvoiceQuality } from "./invoiceQuality.core";

export type InvoicePageMediaType = "image/jpeg" | "image/webp";

export type PreparedInvoicePage = {
  blob: Blob;
  mediaType: InvoicePageMediaType;
  width: number;
  height: number;
  bytes: number;
};

export type PreparedInvoice = {
  pages: PreparedInvoicePage[];
  /** sha256 (hex) de la concatenación de los bytes de todas las páginas, en orden. */
  sha256: string;
  sourceName: string;
  sourceType: string;
  /**
   * Nitidez y brillo de cada página (en orden) y avisos en español para que la
   * UI proponga repetir la foto. Solo informa: no bloquea la subida.
   */
  quality: InvoiceQuality;
};

export const INVOICE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const INVOICE_PDF_TYPE = "application/pdf";

export const UNSUPPORTED_INVOICE_TYPE_MESSAGE =
  "Formato no admitido. Sube una foto JPG, PNG o WebP, o un PDF.";
export const TOO_MANY_INVOICE_PAGES_MESSAGE = `La factura tiene demasiadas páginas: el máximo es ${INVOICE_MAX_PAGES}.`;
export const INVOICE_PAGE_TOO_HEAVY_MESSAGE =
  "No se pudo reducir la página a menos de 1 MB. Prueba con una foto más nítida o recortada.";

/** Calidades que prueba el bucle, de mayor a menor; la última es la mínima. */
export const INVOICE_QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35] as const;

/** Lado mayor por debajo del cual ya no se reduce más la página. */
const MIN_REDUCED_SIDE = 320;

export type InvoiceSourceKind = "image" | "pdf";

/** Clasifica el archivo por su MIME o lanza un error en español si no se admite. */
export function classifyInvoiceType(type: string): InvoiceSourceKind {
  if ((INVOICE_IMAGE_TYPES as readonly string[]).includes(type)) {
    return "image";
  }

  if (type === INVOICE_PDF_TYPE) {
    return "pdf";
  }

  throw new Error(UNSUPPORTED_INVOICE_TYPE_MESSAGE);
}

export function assertInvoicePageCount(count: number) {
  if (count > INVOICE_MAX_PAGES) {
    throw new Error(TOO_MANY_INVOICE_PAGES_MESSAGE);
  }
}

export type Dimensions = { width: number; height: number };

/** Escala proporcionalmente para que el lado mayor no pase de `maxSide` (nunca amplía). */
export function fitWithin({ width, height }: Dimensions, maxSide = INVOICE_MAX_SIDE): Dimensions {
  const longest = Math.max(width, height);

  if (longest <= maxSide) {
    return { height: Math.round(height), width: Math.round(width) };
  }

  const scale = maxSide / longest;
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

/** Dibuja la fuente a `width`×`height` y la codifica con la calidad dada. */
export type PageEncoder = (size: Dimensions, quality: number) => Promise<Blob>;

/**
 * Codifica una página dentro de los límites: primero ajusta el lado mayor a
 * `INVOICE_MAX_SIDE`, luego baja la calidad hasta pesar ≤ `INVOICE_TARGET_BYTES` y,
 * si a la calidad mínima sigue pesando más, reduce las dimensiones.
 */
export async function encodePageWithinLimit(
  source: Dimensions,
  encode: PageEncoder,
  mediaType: InvoicePageMediaType,
): Promise<PreparedInvoicePage> {
  let size = fitWithin(source);
  const minQuality = INVOICE_QUALITY_STEPS[INVOICE_QUALITY_STEPS.length - 1];

  for (const quality of INVOICE_QUALITY_STEPS) {
    const blob = await encode(size, quality);

    if (blob.size <= INVOICE_TARGET_BYTES) {
      return toPage(blob, size, mediaType);
    }
  }

  while (Math.max(size.width, size.height) > MIN_REDUCED_SIDE) {
    size = fitWithin(size, Math.floor(Math.max(size.width, size.height) * 0.8));
    const blob = await encode(size, minQuality);

    if (blob.size <= INVOICE_TARGET_BYTES) {
      return toPage(blob, size, mediaType);
    }
  }

  throw new Error(INVOICE_PAGE_TOO_HEAVY_MESSAGE);
}

function toPage(blob: Blob, size: Dimensions, mediaType: InvoicePageMediaType): PreparedInvoicePage {
  return { blob, bytes: blob.size, height: size.height, mediaType, width: size.width };
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return out;
}

/** sha256 en hexadecimal (minúsculas) con `crypto.subtle`. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash del escaneo: sha256 de la concatenación de los bytes de todas las páginas
 * procesadas, en orden. El servidor lo recalcula igual (`sha256OfPages` en
 * `server/storage.ts`) con los objetos subidos, así que cualquier cambio aquí
 * debe replicarse allí.
 */
export async function hashInvoicePages(pages: readonly Blob[]): Promise<string> {
  const chunks = await Promise.all(pages.map(async (page) => new Uint8Array(await page.arrayBuffer())));
  return sha256Hex(concatBytes(chunks));
}
