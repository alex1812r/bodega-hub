/**
 * Calidad de la foto de una factura, medida en el cliente antes de subirla:
 * nitidez (varianza del laplaciano) y brillo medio. Solo informa: la UI puede
 * proponer repetir la foto, pero nunca bloquea la subida (plan §6.1).
 *
 * Lógica pura sobre luminancia en escala de grises; no toca canvas, así que se
 * prueba en jest sin navegador. Calibración en
 * `.notes/factura-escaneo/extraccion/SCN-03j.md`.
 */

/** Lado mayor al que se normaliza la página antes de medir. */
export const INVOICE_QUALITY_SIDE = 800;

/** Desviación típica de luminancia a la que se normaliza el contraste antes de medir la nitidez. */
export const INVOICE_QUALITY_CONTRAST = 50;

/**
 * Nitidez (ver `measurePageQuality`) por debajo de la cual la página se
 * considera borrosa. Con las 22 muestras reales el mínimo es 276 (f20, reflejo
 * de vitrina) y el siguiente 435 (f18, 540×960); sus versiones a 200 px, a
 * 200 px ampliadas a 600 o desenfocadas (σ 2 y 3) dan como mucho 227, y la foto
 * de 200 px de caos-1 (6.1) da 7.
 */
export const INVOICE_BLUR_THRESHOLD = 250;

/**
 * Brillo medio (0..255) por debajo del cual la foto está muy oscura. Las fotos
 * reales más oscuras (f21, f22, que el modelo aún lee) dan 67–69; las mismas
 * muestras con la luz a un 30 % dan ≤ 45.
 */
export const INVOICE_DARK_THRESHOLD = 55;

/**
 * Brillo medio (0..255) por encima del cual una foto está sobreexpuesta. La
 * cámara expone un papel blanco hacia gris medio: las muestras reales dan
 * ≤ 152 y las lavadas (×0,3 + 190) ≥ 209. No se aplica a PDF, cuyo fondo
 * blanco digital ronda 240–250 sin estar sobreexpuesto.
 */
export const INVOICE_BRIGHT_THRESHOLD = 200;

export const INVOICE_BLURRY_WARNING = "La foto se ve borrosa; tómala de nuevo con el teléfono quieto y buena luz.";
export const INVOICE_DARK_WARNING = "La foto está muy oscura.";
export const INVOICE_BRIGHT_WARNING = "La foto está sobreexpuesta.";

export type LuminanceImage = {
  /** Luminancia 0..255, fila a fila, `width * height` valores. */
  data: ArrayLike<number>;
  width: number;
  height: number;
};

export type InvoicePageQuality = { sharpness: number; brightness: number };

export type InvoiceQuality = { pages: InvoicePageQuality[]; warnings: string[] };

/** Convierte RGBA (p. ej. `ImageData.data`) a luminancia Rec. 601. */
export function rgbaToLuminance(rgba: ArrayLike<number>, width: number, height: number): LuminanceImage {
  const data = new Uint8ClampedArray(width * height);

  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) {
    data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }

  return { data, height, width };
}

/**
 * Reescala la luminancia para que el lado mayor mida `side`: promedio por área
 * al reducir y bilineal al ampliar. Ampliar a propósito una foto pequeña la
 * suaviza, así que una foto de 200 px no pasa por nítida.
 */
export function resampleLuminance(image: LuminanceImage, side = INVOICE_QUALITY_SIDE): LuminanceImage {
  const { data, height, width } = image;
  const scale = side / Math.max(width, height);
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const out = new Float32Array(outWidth * outHeight);

  if (scale < 1) {
    const step = 1 / scale;

    for (let oy = 0; oy < outHeight; oy += 1) {
      const y0 = Math.floor(oy * step);
      const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((oy + 1) * step)));

      for (let ox = 0; ox < outWidth; ox += 1) {
        const x0 = Math.floor(ox * step);
        const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((ox + 1) * step)));
        let sum = 0;

        for (let y = y0; y < y1; y += 1) {
          const row = y * width;

          for (let x = x0; x < x1; x += 1) {
            sum += data[row + x];
          }
        }

        out[oy * outWidth + ox] = sum / ((y1 - y0) * (x1 - x0));
      }
    }
  } else {
    const sx = width / outWidth;
    const sy = height / outHeight;

    for (let oy = 0; oy < outHeight; oy += 1) {
      const fy = Math.min(height - 1, Math.max(0, (oy + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy);
      const y1 = Math.min(height - 1, y0 + 1);
      const ty = fy - y0;

      for (let ox = 0; ox < outWidth; ox += 1) {
        const fx = Math.min(width - 1, Math.max(0, (ox + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(width - 1, x0 + 1);
        const tx = fx - x0;
        const top = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
        const bottom = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
        out[oy * outWidth + ox] = top * (1 - ty) + bottom * ty;
      }
    }
  }

  return { data: out, height: outHeight, width: outWidth };
}

/** Varianza del laplaciano 3×3 (0 1 0 / 1 -4 1 / 0 1 0) sobre los píxeles interiores. */
export function laplacianVariance({ data, height, width }: LuminanceImage): number {
  if (width < 3 || height < 3) {
    return 0;
  }

  let sum = 0;
  let sumSquares = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value = data[i - width] + data[i + width] + data[i - 1] + data[i + 1] - 4 * data[i];
      sum += value;
      sumSquares += value * value;
    }
  }

  const count = (width - 2) * (height - 2);
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Media y varianza de la luminancia. */
export function luminanceStats({ data }: LuminanceImage): { mean: number; variance: number } {
  if (data.length === 0) {
    return { mean: 0, variance: 0 };
  }

  let sum = 0;
  let sumSquares = 0;

  for (let i = 0; i < data.length; i += 1) {
    sum += data[i];
    sumSquares += data[i] * data[i];
  }

  const mean = sum / data.length;
  return { mean, variance: sumSquares / data.length - mean * mean };
}

/**
 * Nitidez y brillo de una página. La nitidez es la varianza del laplaciano a
 * `INVOICE_QUALITY_SIDE` px de lado mayor, con el contraste normalizado a una
 * desviación típica de `INVOICE_QUALITY_CONTRAST` (la varianza del laplaciano
 * escala con la del contraste): así una foto oscura o con reflejo, pero
 * enfocada, no pasa por borrosa, y un sello muy contrastado no salva una foto
 * desenfocada.
 */
export function measurePageQuality(image: LuminanceImage): InvoicePageQuality {
  const normalized = resampleLuminance(image);
  const { mean, variance } = luminanceStats(normalized);
  const sharpness =
    variance > 0 ? (laplacianVariance(normalized) * INVOICE_QUALITY_CONTRAST ** 2) / variance : 0;
  return {
    brightness: Math.round(mean * 10) / 10,
    sharpness: Math.round(sharpness * 10) / 10,
  };
}

/** Origen de las páginas: una foto o un PDF renderizado. */
export type InvoiceQualitySource = "image" | "pdf";

/** Avisos en español (sin repetir) a partir de las medidas de cada página. */
export function invoiceQualityWarnings(
  pages: readonly InvoicePageQuality[],
  source: InvoiceQualitySource = "image",
): string[] {
  const warnings: string[] = [];

  if (pages.some((page) => page.sharpness < INVOICE_BLUR_THRESHOLD)) {
    warnings.push(INVOICE_BLURRY_WARNING);
  }

  if (pages.some((page) => page.brightness < INVOICE_DARK_THRESHOLD)) {
    warnings.push(INVOICE_DARK_WARNING);
  }

  if (source === "image" && pages.some((page) => page.brightness > INVOICE_BRIGHT_THRESHOLD)) {
    warnings.push(INVOICE_BRIGHT_WARNING);
  }

  return warnings;
}

export function summarizeInvoiceQuality(
  pages: InvoicePageQuality[],
  source: InvoiceQualitySource = "image",
): InvoiceQuality {
  return { pages, warnings: invoiceQualityWarnings(pages, source) };
}
