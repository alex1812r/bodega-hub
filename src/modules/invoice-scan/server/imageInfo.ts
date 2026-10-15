import { ApiError } from "@/lib/api/apiError";

/** Por debajo de este lado mayor (px) la factura no se puede leer: 400 sin llamar al modelo. */
export const INVOICE_MIN_SIDE = 400;

/** Por debajo de este lado mayor (px) se lee, pero con aviso y confianza ≤ 0,5. */
export const INVOICE_LOW_RES_SIDE = 1000;

export type InvoiceImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export type InvoiceImageInfo = {
  mediaType: InvoiceImageMediaType;
  width: number;
  height: number;
};

const NOT_AN_IMAGE = "El archivo no es una imagen válida. Sube una foto JPG, PNG o WebP de la factura.";
const TYPE_MISMATCH = "El contenido del archivo no coincide con su tipo. Sube la foto original de la factura.";
const UNREADABLE = "No pudimos leer el tamaño de la imagen. Sube otra foto de la factura.";
const TOO_SMALL =
  "La imagen es demasiado pequeña para leer la factura. Toma la foto más cerca y con buena luz.";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function badRequest(message: string): ApiError {
  return new ApiError(400, "BAD_REQUEST", message);
}

function startsWith(data: Uint8Array, bytes: readonly number[], offset = 0) {
  return data.length >= offset + bytes.length && bytes.every((byte, index) => data[offset + index] === byte);
}

function ascii(data: Uint8Array, offset: number, length: number) {
  return data.length >= offset + length
    ? String.fromCharCode(...data.subarray(offset, offset + length))
    : "";
}

function detectType(data: Uint8Array): InvoiceImageMediaType | null {
  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }

  if (startsWith(data, PNG_SIGNATURE)) {
    return "image/png";
  }

  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") {
    return "image/webp";
  }

  return null;
}

type Size = { width: number; height: number };

/** Recorre los segmentos hasta el primer SOFn (C0–CF salvo DHT C4, JPG C8 y DAC CC). */
function jpegSize(data: Uint8Array, view: DataView): Size | null {
  let offset = 2;

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      return null;
    }

    const marker = data[offset + 1]!;

    if (marker === 0xff) {
      offset += 1; // relleno
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // marcadores sin longitud
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) {
      return null; // fin de imagen o inicio de datos sin haber visto SOF
    }

    const length = view.getUint16(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isSof) {
      if (offset + 9 > data.length) {
        return null;
      }

      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }

    if (length < 2) {
      return null;
    }

    offset += 2 + length;
  }

  return null;
}

function pngSize(data: Uint8Array, view: DataView): Size | null {
  if (data.length < 24 || ascii(data, 12, 4) !== "IHDR") {
    return null;
  }

  return { height: view.getUint32(20), width: view.getUint32(16) };
}

function webpSize(data: Uint8Array, view: DataView): Size | null {
  const chunk = ascii(data, 12, 4);

  if (chunk === "VP8 ") {
    if (data.length < 30 || !startsWith(data, [0x9d, 0x01, 0x2a], 23)) {
      return null;
    }

    return { height: view.getUint16(28, true) & 0x3fff, width: view.getUint16(26, true) & 0x3fff };
  }

  if (chunk === "VP8L") {
    if (data.length < 25 || data[20] !== 0x2f) {
      return null;
    }

    const bits = view.getUint32(21, true);
    return { height: ((bits >>> 14) & 0x3fff) + 1, width: (bits & 0x3fff) + 1 };
  }

  if (chunk === "VP8X") {
    if (data.length < 30) {
      return null;
    }

    const uint24 = (offset: number) => data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16);
    return { height: uint24(27) + 1, width: uint24(24) + 1 };
  }

  return null;
}

/**
 * Valida una página de factura por sus bytes, sin librerías: tipo real por
 * bytes mágicos (JPEG, PNG, WebP), coincidencia con el tipo declarado y
 * dimensiones leídas de la cabecera. Lanza ApiError 400 en español si el
 * archivo no es una imagen válida, si el tipo no coincide, si no se pueden
 * leer las dimensiones o si el lado mayor es menor que `INVOICE_MIN_SIDE`.
 */
export function inspectInvoiceImage(data: Uint8Array, declaredType: string): InvoiceImageInfo {
  const mediaType = detectType(data);

  if (!mediaType) {
    throw badRequest(NOT_AN_IMAGE);
  }

  if (mediaType !== declaredType.trim().toLowerCase()) {
    throw badRequest(TYPE_MISMATCH);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size =
    mediaType === "image/jpeg"
      ? jpegSize(data, view)
      : mediaType === "image/png"
        ? pngSize(data, view)
        : webpSize(data, view);

  if (!size || size.width <= 0 || size.height <= 0) {
    throw badRequest(UNREADABLE);
  }

  if (Math.max(size.width, size.height) < INVOICE_MIN_SIDE) {
    throw badRequest(TOO_SMALL);
  }

  return { height: size.height, mediaType, width: size.width };
}
