import { ApiError } from "@/lib/api/apiError";

import { INVOICE_MAX_SIDE } from "../client/invoiceLimits";

/** Por debajo de este lado mayor (px) la factura no se puede leer: 400 sin llamar al modelo. */
export const INVOICE_MIN_SIDE = 400;

/**
 * Por debajo de este lado menor (px) la imagen no tiene proporciones de factura
 * (p. ej. 1×10000): 400 sin llamar al modelo. Una tira térmica de 600×4000,
 * reducida por el cliente a 240×1600, pasa.
 */
export const INVOICE_MIN_SHORT_SIDE = 200;

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

const BAD_PROPORTIONS =
  "La imagen tiene proporciones que no corresponden a una factura. Sube una foto de la factura completa.";

/** Texto ligado a `INVOICE_MAX_SIDE` (1600); el test fija ambos. */
const TOO_LARGE =
  "La imagen supera 1.600 px en su lado mayor. Vuelve a subirla desde la app para que se reduzca.";

/** Auditoría B8: datos tras el EOI/IEND/fin del RIFF; se guardarían y llegarían al proveedor. */
const TRAILING_DATA =
  "La imagen trae datos extra después del final del archivo. Vuelve a subirla desde la app.";

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

/**
 * Recorre los datos de escaneo desde `from` (tras la cabecera del primer SOS):
 * salta los bytes de relleno (FF 00, FF FF) y los RSTn, y los segmentos con
 * longitud que hay entre scans (DHT, SOS, DQT… del progresivo). Devuelve el
 * offset justo tras el primer EOI (FF D9), o null si no lo hay.
 */
function jpegEnd(data: Uint8Array, view: DataView, from: number): number | null {
  let index = from;

  while (index + 1 < data.length) {
    if (data[index] !== 0xff) {
      index += 1;
      continue;
    }

    const marker = data[index + 1]!;

    if (marker === 0xff) {
      index += 1;
    } else if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2;
    } else if (marker === 0xd9) {
      return index + 2;
    } else if (marker === 0xd8 || index + 4 > data.length) {
      return null;
    } else {
      const length = view.getUint16(index + 2);

      if (length < 2) {
        return null;
      }

      index += 2 + length;
    }
  }

  return null;
}

/**
 * Recorre los segmentos desde SOI respetando sus longitudes hasta el primer
 * SOS. Exige exactamente un SOFn coherente (C0–CF salvo DHT C4, JPG C8 y DAC
 * CC) antes del SOS, un SOS coherente con él y un EOI que cierre el archivo
 * (bytes tras el EOI: 400 `TRAILING_DATA`).
 */
function jpegSize(data: Uint8Array, view: DataView): Size | null {
  let offset = 2;
  let size: Size | null = null;
  let components = 0;

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) {
      return null;
    }

    const marker = data[offset + 1]!;

    if (marker === 0xff) {
      offset += 1; // relleno
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // marcadores sin longitud
      continue;
    }

    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) {
      return null; // SOI repetido o fin de imagen antes de los datos
    }

    const length = view.getUint16(offset + 2);

    if (length < 2 || offset + 2 + length > data.length) {
      return null;
    }

    if (marker === 0xda) {
      const scanComponents = data[offset + 4]!;
      const coherent =
        size !== null && scanComponents >= 1 && scanComponents <= components && length === 6 + 2 * scanComponents;

      const end = coherent ? jpegEnd(data, view, offset + 2 + length) : null;

      if (end !== null && end < data.length) {
        throw badRequest(TRAILING_DATA);
      }

      return end === null ? null : size;
    }

    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isSof) {
      if (size !== null || length < 8) {
        return null; // un segundo SOF o uno sin sitio para la cabecera
      }

      const precision = data[offset + 4]!;
      components = data[offset + 9]!;

      if (precision < 2 || precision > 16 || components < 1 || components > 4 || length !== 8 + 3 * components) {
        return null;
      }

      size = { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }

    offset += 2 + length;
  }

  return null;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO 3309, el de PNG), sin dependencias de Node para no atarlo a una versión. */
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);

    for (let n = 0; n < 256; n += 1) {
      let c = n;

      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }

      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Recorre los chunks verificando longitud, tipo y CRC: IHDR primero, al menos
 * un IDAT y un IEND al final (bytes tras el IEND: 400 `TRAILING_DATA`).
 */
function pngSize(data: Uint8Array, view: DataView): Size | null {
  let offset = PNG_SIGNATURE.length;
  let size: Size | null = null;
  let hasData = false;

  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = ascii(data, offset + 4, 4);

    if (length > data.length - offset - 12 || !/^[A-Za-z]{4}$/.test(type)) {
      return null;
    }

    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) {
      return null;
    }

    if (size === null) {
      if (type !== "IHDR" || length !== 13) {
        return null;
      }

      size = { height: view.getUint32(offset + 12), width: view.getUint32(offset + 8) };
    } else if (type === "IHDR") {
      return null;
    }

    if (type === "IDAT") {
      hasData = true;
    }

    if (type === "IEND") {
      if (!hasData || length !== 0) {
        return null;
      }

      if (offset + 12 < data.length) {
        throw badRequest(TRAILING_DATA);
      }

      return size;
    }

    offset += 12 + length;
  }

  return null;
}

/** Tamaño mínimo coherente de cada chunk de imagen WebP (cabecera del frame). */
const WEBP_MIN_CHUNK: Record<string, number> = { ANMF: 16, "VP8 ": 10, VP8L: 5 };

/**
 * Exige que el tamaño RIFF coincida con la longitud (falta, como mucho, el byte
 * de relleno; bytes tras el fin del RIFF: 400 `TRAILING_DATA`) y que el
 * chunk VP8/VP8L/VP8X quepa en él; en VP8X recorre el resto de chunks y exige
 * al menos uno de imagen (VP8, VP8L o ANMF) con tamaño coherente.
 */
function webpStructureOk(data: Uint8Array, view: DataView, chunk: string): boolean {
  if (data.length < 20) {
    return false;
  }

  const riffSize = view.getUint32(4, true);

  if (data.length - 8 > riffSize) {
    throw badRequest(TRAILING_DATA);
  }

  if (data.length - 8 < riffSize - 1) {
    return false;
  }

  const end = Math.min(data.length, 8 + riffSize);
  const chunkSize = view.getUint32(16, true);

  if (20 + chunkSize > end) {
    return false;
  }

  if (chunk === "VP8 " || chunk === "VP8L") {
    return chunkSize >= WEBP_MIN_CHUNK[chunk]! && end - (20 + chunkSize) <= 1;
  }

  if (chunk !== "VP8X") {
    return false;
  }

  if (chunkSize !== 10) {
    return false;
  }

  let offset = 30;
  let hasImage = false;

  while (offset + 8 <= end) {
    const type = ascii(data, offset, 4);
    const size = view.getUint32(offset + 4, true);

    if (size > end - offset - 8) {
      return false;
    }

    const min = WEBP_MIN_CHUNK[type];

    if (min !== undefined) {
      if (size < min) {
        return false;
      }

      hasImage = true;
    }

    offset += 8 + size + (size & 1);
  }

  return hasImage && end - offset <= 1;
}

function webpSize(data: Uint8Array, view: DataView): Size | null {
  const chunk = ascii(data, 12, 4);

  if (!webpStructureOk(data, view, chunk)) {
    return null;
  }

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
    const uint24 = (offset: number) => data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16);
    return { height: uint24(27) + 1, width: uint24(24) + 1 };
  }

  return null;
}

/**
 * Valida una página de factura por sus bytes, sin librerías: tipo real por
 * bytes mágicos (JPEG, PNG, WebP), coincidencia con el tipo declarado y
 * dimensiones leídas de la cabecera. Lanza ApiError 400 en español si el
 * archivo no es una imagen válida, si el tipo no coincide, si la estructura
 * no es coherente (segmentos JPEG hasta SOS + EOI, chunks PNG con CRC hasta
 * IEND, tamaños RIFF/VP8* de WebP), si el lado mayor es menor que
 * `INVOICE_MIN_SIDE`, si el lado menor es menor que `INVOICE_MIN_SHORT_SIDE`
 * o si el lado mayor supera `INVOICE_MAX_SIDE` (sin sharp no se redimensiona
 * en el servidor: el cliente ya reduce a 1600 px y al modelo no llega más).
 *
 * Límite conocido (severidad baja): unas dimensiones reescritas en un archivo
 * estructuralmente válido (SOF, IHDR con CRC recalculado o frame VP8) no se
 * detectan sin decodificar; solo perjudica a la tienda que sube el archivo.
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

  if (Math.min(size.width, size.height) < INVOICE_MIN_SHORT_SIDE) {
    throw badRequest(BAD_PROPORTIONS);
  }

  if (Math.max(size.width, size.height) > INVOICE_MAX_SIDE) {
    throw badRequest(TOO_LARGE);
  }

  return { height: size.height, mediaType, width: size.width };
}
