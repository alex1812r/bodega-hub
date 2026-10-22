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

/** Caos N7 / auditoría B15: el saneo para el modelo no puede recorrer la imagen con certeza. */
const UNSANITIZABLE =
  "La imagen trae datos que no podemos limpiar con seguridad. Vuelve a subirla desde la app para que se procese.";

function unsanitizable(): never {
  throw badRequest(UNSANITIZABLE);
}

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
 * Lista blanca de segmentos JPEG con longitud que se copian tal cual: los que
 * hacen falta para decodificar (SOFn, DHT C4 y DAC CC dentro de C0–CF salvo
 * JPG C8; DQT DB, DRI DD y SOS DA).
 */
function isJpegCodingSegment(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) || marker === 0xdb || marker === 0xdd || marker === 0xda;
}

/**
 * Qué se envía de un segmento JPEG: el propio segmento si es de la lista
 * blanca; APP0 JFIF y APP14 Adobe reconstruidos en su forma canónica (sin
 * miniatura ni bytes extra, donde cabe texto); null para el resto de APPn y
 * COM. Cualquier otro marcador (TEM, RSTn, JPGn, DNL, reservados…) lanza 400.
 */
function keptJpegSegment(marker: number, segment: Uint8Array): Uint8Array | null {
  if (isJpegCodingSegment(marker)) {
    return segment;
  }

  if (marker === 0xe0) {
    // FF E0 00 10 "JFIF\0" versión 1.01, unidades, densidad X/Y, miniatura 0×0.
    return segment.length >= 18 && ascii(segment, 4, 5) === "JFIF\0" && segment[11]! <= 2
      ? Uint8Array.from([0xff, 0xe0, 0x00, 0x10, ...segment.subarray(4, 9), 0x01, 0x01, ...segment.subarray(11, 16), 0x00, 0x00])
      : null;
  }

  if (marker === 0xee) {
    // FF EE 00 0E "Adobe" versión 100, flags 0, transformación de color (0–2).
    const transform = segment[15];
    return segment.length >= 16 && ascii(segment, 4, 5) === "Adobe" && transform !== undefined && transform <= 2
      ? Uint8Array.from([0xff, 0xee, 0x00, 0x0e, ...segment.subarray(4, 9), 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, transform])
      : null;
  }

  if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
    return null;
  }

  return unsanitizable();
}

/**
 * Fin de los datos de escaneo que empiezan en `from`: el offset del FF del
 * primer marcador que no sea FF 00 ni RSTn. Sin marcador (truncado): 400.
 */
function jpegScanEnd(data: Uint8Array, from: number): number {
  let index = from;

  while (index + 1 < data.length) {
    if (data[index] !== 0xff) {
      index += 1;
      continue;
    }

    const marker = data[index + 1]!;

    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2;
      continue;
    }

    return index;
  }

  return unsanitizable();
}

/**
 * Copia el JPEG con solo los segmentos de `keptJpegSegment`, en la cabecera y
 * entre scans, los datos de escaneo intactos y sin lo que siga al primer EOI.
 * Falla cerrado: un byte que no sea marcador donde debe haberlo, una longitud
 * que no cuadra, un marcador fuera de la lista o la falta de EOI dan 400.
 */
function stripJpeg(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parts: Uint8Array[] = [data.subarray(0, 2)];
  let offset = 2;
  let sawScan = false;

  while (offset + 1 < data.length) {
    if (data[offset] !== 0xff) {
      return unsanitizable();
    }

    const marker = data[offset + 1]!;

    if (marker === 0xff) {
      offset += 1; // relleno entre segmentos
      continue;
    }

    if (marker === 0xd9) {
      return sawScan ? concatParts([...parts, data.subarray(offset, offset + 2)]) : unsanitizable();
    }

    if (offset + 4 > data.length) {
      return unsanitizable();
    }

    const length = view.getUint16(offset + 2);
    const end = offset + 2 + length;

    if (length < 2 || end > data.length) {
      return unsanitizable();
    }

    const kept = keptJpegSegment(marker, data.subarray(offset, end));

    if (kept) {
      parts.push(kept);
    }

    offset = end;

    if (marker === 0xda) {
      sawScan = true;
      const scanEnd = jpegScanEnd(data, offset);
      parts.push(data.subarray(offset, scanEnd));
      offset = scanEnd;
    }
  }

  return unsanitizable();
}

/** Tamaño exacto de tRNS por tipo de color (el 3 se mide contra el PLTE; 4 y 6 no lo admiten). */
const PNG_TRNS_LENGTH: Readonly<Record<number, number>> = { 0: 2, 2: 6 };

/**
 * Lista blanca estricta de chunks PNG (D29): solo lo imprescindible para
 * decodificar, medido contra el IHDR para que no quepa texto.
 * - IHDR (13 B), IDAT, IEND (0 B).
 * - PLTE solo en paleta (tipo 3), múltiplo de 3, ≤ 256 y ≤ 2^bitdepth entradas,
 *   antes del IDAT; en otros tipos es opcional y se descarta.
 * - tRNS solo con el tamaño del tipo: 2 B (gris), 6 B (RGB), ≤ entradas de PLTE
 *   (paleta, tras el PLTE); en gris+alfa y RGBA no se admite.
 * Fuera todo lo demás, también gAMA/cHRM/sRGB/iCCP/bKGD/pHYs/sBIT: sharp
 * decodifica igual sin ellos (los píxeles no cambian).
 */
function pngChunkKept(
  type: string,
  length: number,
  state: { bitDepth: number; colorType: number; paletteEntries: number; sawData: boolean },
): boolean {
  switch (type) {
    case "IHDR":
      return length === 13;
    case "IDAT":
      return true;
    case "IEND":
      return length === 0;
    case "PLTE":
      return (
        state.colorType === 3 &&
        !state.sawData &&
        state.paletteEntries === 0 &&
        length > 0 &&
        length % 3 === 0 &&
        length / 3 <= Math.min(256, 2 ** state.bitDepth)
      );
    case "tRNS":
      return state.colorType === 3
        ? !state.sawData && length > 0 && length <= state.paletteEntries
        : !state.sawData && length === PNG_TRNS_LENGTH[state.colorType];
    default:
      return false;
  }
}

/**
 * Copia el PNG con solo los chunks de `pngChunkKept` (íntegros, con su CRC) y
 * sin lo que siga al IEND. Falla cerrado: un tipo no ASCII, un CRC roto, un
 * chunk crítico desconocido o mal medido (PLTE inválido en paleta incluido),
 * una imagen de paleta sin PLTE o la falta de IEND dan 400.
 */
function stripPng(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const parts: Uint8Array[] = [data.subarray(0, PNG_SIGNATURE.length)];
  const state = { bitDepth: 0, colorType: -1, paletteEntries: 0, sawData: false };
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const type = ascii(data, offset + 4, 4);

    if (length > data.length - offset - 12 || !/^[A-Za-z]{4}$/.test(type)) {
      return unsanitizable();
    }

    const end = offset + 12 + length;

    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) {
      return unsanitizable();
    }

    if ((state.colorType === -1) !== (type === "IHDR")) {
      return unsanitizable();
    }

    const fits = pngChunkKept(type, length, state);
    // PLTE es crítico pero opcional fuera de la paleta: allí se descarta.
    const critical = (data[offset + 4]! & 0x20) === 0 && !(type === "PLTE" && state.colorType !== 3);

    if (fits) {
      parts.push(data.subarray(offset, end));
    } else if (critical) {
      return unsanitizable();
    }

    if (type === "IHDR") {
      state.bitDepth = data[offset + 16]!;
      state.colorType = data[offset + 17]!;
    } else if (type === "PLTE" && fits) {
      state.paletteEntries = length / 3;
    } else if (type === "IDAT") {
      if (state.colorType === 3 && state.paletteEntries === 0) {
        return unsanitizable();
      }

      state.sawData = true;
    }

    if (type === "IEND") {
      return state.sawData ? concatParts(parts) : unsanitizable();
    }

    offset = end;
  }

  return unsanitizable();
}

function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  header.set(Array.from(type, (char) => char.charCodeAt(0)));
  view.setUint32(4, payload.length, true);
  return concatParts(payload.length % 2 === 1 ? [header, payload, new Uint8Array(1)] : [header, payload]);
}

/**
 * Reconstruye el WebP con solo los chunks de imagen: VP8 o VP8L simple, o en
 * VP8X el propio VP8X (sin flags de ICC/EXIF/XMP ni bytes reservados), ALPH y
 * un VP8/VP8L. Fuera ICCP, EXIF, XMP y los desconocidos. Falla cerrado: un
 * tamaño que no cabe, animación (flag o ANIM/ANMF) o no tener exactamente un
 * chunk de imagen dan 400.
 */
function stripWebp(data: Uint8Array): Uint8Array {
  if (data.length < 20 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 4) !== "WEBP") {
    return unsanitizable();
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = Math.min(data.length, 8 + view.getUint32(4, true));
  const chunks: { type: string; payload: Uint8Array }[] = [];
  let offset = 12;

  while (offset + 8 <= end) {
    const type = ascii(data, offset, 4);
    const size = view.getUint32(offset + 4, true);

    if (size > end - offset - 8) {
      return unsanitizable();
    }

    chunks.push({ payload: data.subarray(offset + 8, offset + 8 + size), type });
    offset += 8 + size + (size & 1);
  }

  if (end - offset > 1 || chunks.length === 0) {
    return unsanitizable();
  }

  const [first] = chunks;
  const images = chunks.filter((chunk) => chunk.type === "VP8 " || chunk.type === "VP8L");
  const kept: Uint8Array[] = [];

  if (first!.type === "VP8 " || first!.type === "VP8L") {
    kept.push(riffChunk(first!.type, first!.payload));
  } else if (first!.type === "VP8X" && first!.payload.length === 10) {
    const flags = first!.payload[0]!;

    if (flags & 0x02 || images.length !== 1 || chunks.some((chunk) => chunk.type === "ANIM" || chunk.type === "ANMF")) {
      return unsanitizable();
    }

    kept.push(riffChunk("VP8X", Uint8Array.from([flags & 0x10, 0, 0, 0, ...first!.payload.subarray(4, 10)])));

    for (const chunk of chunks) {
      if (chunk.type === "ALPH" || chunk === images[0]) {
        kept.push(riffChunk(chunk.type, chunk.payload));
      }
    }
  } else {
    return unsanitizable();
  }

  const body = concatParts(kept);
  const header = new Uint8Array(12);
  const headerView = new DataView(header.buffer);
  header.set([0x52, 0x49, 0x46, 0x46]);
  headerView.setUint32(4, 4 + body.length, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  return concatParts([header, body]);
}

/**
 * Auditoría B13, caos N7 y auditoría B15: copia en memoria de la página para
 * el modelo, solo con lo que hace falta para decodificar (lista blanca, no
 * lista negra), sin los metadatos donde cabe texto arbitrario (instrucciones
 * escondidas que el proveedor podría leer). Los bytes guardados y su hash no
 * cambian: solo se aplica a lo que se envía.
 * - JPEG: SOFn, DHT, DAC, DQT, DRI y SOS con sus datos de escaneo; APP0 JFIF y
 *   APP14 Adobe reconstruidos en forma canónica; fuera COM, el resto de APPn y
 *   la cola tras el primer EOI. Sin EXIF no hay orientación: el cliente ya la
 *   aplica al redibujar (`createImageBitmap` con `imageOrientation: "from-image"`).
 * - PNG: IHDR, PLTE y tRNS coherentes con el IHDR, IDAT e IEND (`pngChunkKept`);
 *   fuera el resto y la cola tras el IEND.
 * - WebP: solo VP8/VP8L (y en VP8X, ALPH); fuera ICCP/EXIF/XMP y desconocidos.
 * Falla cerrado: si no puede recorrer la estructura con certeza lanza ApiError
 * 400 (la entrada del BFF lo comprueba antes de subir y de cobrar).
 */
export function stripImageMetadata(data: Uint8Array, mediaType: InvoiceImageMediaType): Uint8Array {
  if (mediaType === "image/jpeg") {
    return startsWith(data, [0xff, 0xd8]) ? stripJpeg(data) : unsanitizable();
  }

  if (mediaType === "image/png") {
    return startsWith(data, PNG_SIGNATURE) ? stripPng(data) : unsanitizable();
  }

  return stripWebp(data);
}
