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
  /**
   * Bytes tras el final de la imagen (EOI del JPEG, IEND del PNG, fin del RIFF
   * del WebP). El parser los tolera, sin tope (un JPEG MPF de cámara trae su
   * vista previa tras el primer EOI); la entrada del BFF los rechaza con
   * `assertNoTrailingData`.
   */
  trailingBytes: number;
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

type Size = { width: number; height: number; trailingBytes: number };

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
 * CC) antes del SOS, un SOS coherente con él y un EOI tras los datos de
 * escaneo; lo que siga al primer EOI se cuenta en `trailingBytes`.
 */
function jpegSize(data: Uint8Array, view: DataView): Size | null {
  let offset = 2;
  let size: Omit<Size, "trailingBytes"> | null = null;
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

      return end === null || size === null ? null : { ...size, trailingBytes: data.length - end };
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
 * un IDAT y un IEND (lo que siga al IEND se cuenta en `trailingBytes`).
 */
function pngSize(data: Uint8Array, view: DataView): Size | null {
  let offset = PNG_SIGNATURE.length;
  let size: Omit<Size, "trailingBytes"> | null = null;
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
      return hasData && length === 0 ? { ...size, trailingBytes: data.length - (offset + 12) } : null;
    }

    offset += 12 + length;
  }

  return null;
}

/** Tamaño mínimo coherente de cada chunk de imagen WebP (cabecera del frame). */
const WEBP_MIN_CHUNK: Record<string, number> = { ANMF: 16, "VP8 ": 10, VP8L: 5 };

/**
 * Exige que el tamaño RIFF quepa en la longitud (falta, como mucho, el byte de
 * relleno; lo que siga al fin del RIFF lo cuenta `webpSize`) y que el
 * chunk VP8/VP8L/VP8X quepa en él; en VP8X recorre el resto de chunks y exige
 * al menos uno de imagen (VP8, VP8L o ANMF) con tamaño coherente.
 */
function webpStructureOk(data: Uint8Array, view: DataView, chunk: string): boolean {
  if (data.length < 20) {
    return false;
  }

  const riffSize = view.getUint32(4, true);

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
  const trailingBytes = Math.max(0, data.length - 8 - view.getUint32(4, true));

  if (!webpStructureOk(data, view, chunk)) {
    return null;
  }

  if (chunk === "VP8 ") {
    if (data.length < 30 || !startsWith(data, [0x9d, 0x01, 0x2a], 23)) {
      return null;
    }

    return { height: view.getUint16(28, true) & 0x3fff, trailingBytes, width: view.getUint16(26, true) & 0x3fff };
  }

  if (chunk === "VP8L") {
    if (data.length < 25 || data[20] !== 0x2f) {
      return null;
    }

    const bits = view.getUint32(21, true);
    return { height: ((bits >>> 14) & 0x3fff) + 1, trailingBytes, width: (bits & 0x3fff) + 1 };
  }

  if (chunk === "VP8X") {
    const uint24 = (offset: number) => data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16);
    return { height: uint24(27) + 1, trailingBytes, width: uint24(24) + 1 };
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

  return { height: size.height, mediaType, trailingBytes: size.trailingBytes, width: size.width };
}

/**
 * Auditoría B8: la entrada del BFF no admite bytes tras el final de la imagen
 * (se guardarían en el bucket y llegarían al proveedor). Solo para la subida;
 * `extractInvoice` y `invoice-eval` los toleran (JPEG MPF de cámara).
 */
export function assertNoTrailingData(info: InvoiceImageInfo): void {
  if (info.trailingBytes > 0) {
    throw badRequest(TRAILING_DATA);
  }
}

function concatParts(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/**
 * Segmentos JPEG que no hacen falta para decodificar: COM y todo APPn salvo
 * APP0 JFIF y APP14 Adobe (transformación de color). Se quitan APP1 EXIF/XMP,
 * APP2 ICC/MPF, APP13 Photoshop, etc.
 */
function isJpegMetadata(marker: number, segment: Uint8Array): boolean {
  if (marker === 0xfe) {
    return true;
  }

  if (marker < 0xe0 || marker > 0xef) {
    return false;
  }

  return !(
    (marker === 0xe0 && ascii(segment, 4, 5) === "JFIF\0") ||
    (marker === 0xee && ascii(segment, 4, 5) === "Adobe")
  );
}

/**
 * Copia el JPEG sin los segmentos de `isJpegMetadata`, tanto en la cabecera
 * como entre scans (progresivo, o tras los datos de escaneo antes del EOI), y
 * sin lo que siga al primer EOI. Los datos de escaneo se copian intactos. Si
 * la estructura no se puede recorrer devuelve `data` sin tocar.
 */
function stripJpeg(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parts: Uint8Array[] = [data.subarray(0, 2)];
  let offset = 2;
  let scanStart: number | null = null;

  while (offset + 1 < data.length) {
    const marker = data[offset + 1]!;

    if (scanStart !== null) {
      // Datos de escaneo: se avanza sobre bytes, relleno (FF FF), FF 00 y RSTn.
      if (data[offset] !== 0xff || marker === 0xff) {
        offset += 1;
        continue;
      }

      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }

      parts.push(data.subarray(scanStart, offset));
      scanStart = null;
    }

    if (data[offset] !== 0xff) {
      return data;
    }

    if (marker === 0xff) {
      offset += 1; // relleno entre segmentos
      continue;
    }

    if (marker === 0xd9) {
      parts.push(data.subarray(offset, offset + 2));
      return concatParts(parts);
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (marker === 0x00 || marker === 0xd8 || offset + 4 > data.length) {
      return data;
    }

    const length = view.getUint16(offset + 2);
    const end = offset + 2 + length;

    if (length < 2 || end > data.length) {
      return data;
    }

    const segment = data.subarray(offset, end);

    if (!isJpegMetadata(marker, segment)) {
      parts.push(segment);
    }

    offset = end;

    if (marker === 0xda) {
      scanStart = offset;
    }
  }

  return data;
}

/** Chunks PNG de texto libre (auxiliares: el decodificador no los necesita). */
const PNG_TEXT_CHUNKS: ReadonlySet<string> = new Set(["tEXt", "iTXt", "zTXt"]);

/**
 * Copia el PNG sin chunks de texto ni lo que siga al IEND; los demás chunks
 * van íntegros (cada uno lleva su CRC). Si la estructura no se puede recorrer
 * devuelve `data` sin tocar.
 */
function stripPng(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parts: Uint8Array[] = [data.subarray(0, PNG_SIGNATURE.length)];
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = ascii(data, offset + 4, 4);

    if (length > data.length - offset - 12) {
      return data;
    }

    const end = offset + 12 + length;

    if (!PNG_TEXT_CHUNKS.has(type)) {
      parts.push(data.subarray(offset, end));
    }

    if (type === "IEND") {
      return concatParts(parts);
    }

    offset = end;
  }

  return data;
}

/**
 * Auditoría B13: copia en memoria de la página para el modelo, sin los
 * metadatos donde cabe texto arbitrario (instrucciones escondidas que el
 * proveedor podría leer). Los bytes guardados y su hash no cambian: solo se
 * aplica a lo que se envía.
 * - JPEG: sin COM ni APPn salvo APP0 JFIF y APP14 Adobe, y sin cola tras el
 *   primer EOI. Sin EXIF no hay orientación: el cliente ya la aplica al
 *   redibujar (`createImageBitmap` con `imageOrientation: "from-image"`).
 * - PNG: sin tEXt/iTXt/zTXt y sin cola tras el IEND.
 * - WebP: tal cual; quitar EXIF/XMP de un VP8X exige reescribir el tamaño
 *   RIFF y los flags, y el cliente sube JPEG.
 * Espera bytes ya validados por `inspectInvoiceImage`; ante una estructura que
 * no puede recorrer devuelve la entrada sin tocar.
 */
export function stripImageMetadata(data: Uint8Array, mediaType: InvoiceImageMediaType): Uint8Array {
  if (mediaType === "image/jpeg" && startsWith(data, [0xff, 0xd8])) {
    return stripJpeg(data);
  }

  if (mediaType === "image/png" && startsWith(data, PNG_SIGNATURE)) {
    return stripPng(data);
  }

  return data;
}
