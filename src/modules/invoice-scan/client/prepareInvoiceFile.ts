/**
 * Prepara una factura (foto o PDF) para subirla: cada página sale como imagen
 * JPEG con lado mayor ≤ 1600 px y ≤ 1 MB, y el escaneo lleva el sha256 de sus
 * páginas. Usa APIs del navegador (canvas, `createImageBitmap`, pdfjs); la
 * lógica pura vive en `prepareInvoice.core.ts`.
 */
import { INVOICE_MAX_SIDE } from "./invoiceLimits";
import {
  measurePageQuality,
  rgbaToLuminance,
  summarizeInvoiceQuality,
  type InvoicePageQuality,
} from "./invoiceQuality.core";
import { loadPdfjs } from "./loadPdfjs";
import {
  assertInvoicePageCount,
  classifyInvoiceType,
  encodePageWithinLimit,
  hashInvoicePages,
  type Dimensions,
  type InvoicePageMediaType,
  type PageEncoder,
  type PreparedInvoice,
  type PreparedInvoicePage,
} from "./prepareInvoice.core";

export type { PreparedInvoice, PreparedInvoicePage } from "./prepareInvoice.core";

const OUTPUT_MEDIA_TYPE: InvoicePageMediaType = "image/jpeg";

const UNREADABLE_IMAGE_MESSAGE = "No se pudo leer la imagen de la factura.";
const UNREADABLE_PDF_MESSAGE = "No se pudo leer el PDF de la factura.";

function createCanvas({ width, height }: Dimensions) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_IMAGE_MESSAGE))),
      OUTPUT_MEDIA_TYPE,
      quality,
    );
  });
}

/** Nitidez y brillo de la página tal como se codificó (fuente dibujada a su tamaño final). */
function measureSource(source: CanvasImageSource, page: PreparedInvoicePage): InvoicePageQuality {
  const canvas = createCanvas(page);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error(UNREADABLE_IMAGE_MESSAGE);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, page.width, page.height);
  context.drawImage(source, 0, 0, page.width, page.height);
  const { data } = context.getImageData(0, 0, page.width, page.height);
  return measurePageQuality(rgbaToLuminance(data, page.width, page.height));
}

type MeasuredPage = { page: PreparedInvoicePage; quality: InvoicePageQuality };

/** Encoder de canvas: redibuja la fuente al tamaño pedido y la codifica en JPEG. */
function canvasEncoder(source: CanvasImageSource): PageEncoder {
  return async (size, quality) => {
    const canvas = createCanvas(size);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error(UNREADABLE_IMAGE_MESSAGE);
    }

    // Fondo blanco: el PNG transparente no debe salir negro en JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);
    return canvasToBlob(canvas, quality);
  };
}

async function prepareImage(file: File): Promise<MeasuredPage[]> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(UNREADABLE_IMAGE_MESSAGE);
  }

  try {
    const page = await encodePageWithinLimit(
      { height: bitmap.height, width: bitmap.width },
      canvasEncoder(bitmap),
      OUTPUT_MEDIA_TYPE,
    );
    return [{ page, quality: measureSource(bitmap, page) }];
  } finally {
    bitmap.close();
  }
}

async function preparePdf(file: File): Promise<MeasuredPage[]> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });

  try {
    let pdf: Awaited<typeof loadingTask.promise>;

    try {
      pdf = await loadingTask.promise;
    } catch {
      throw new Error(UNREADABLE_PDF_MESSAGE);
    }

    assertInvoicePageCount(pdf.numPages);
    const pages: MeasuredPage[] = [];

    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      // Se renderiza con el lado mayor a 1600 px (también amplía páginas
      // pequeñas, que en PDF suelen medirse en puntos, para que el texto se lea).
      const viewport = page.getViewport({
        scale: INVOICE_MAX_SIDE / Math.max(natural.width, natural.height),
      });
      const canvas = createCanvas({ height: Math.round(viewport.height), width: Math.round(viewport.width) });

      await page.render({ canvas, viewport }).promise;
      const encoded = await encodePageWithinLimit(
        { height: canvas.height, width: canvas.width },
        canvasEncoder(canvas),
        OUTPUT_MEDIA_TYPE,
      );
      pages.push({ page: encoded, quality: measureSource(canvas, encoded) });
      page.cleanup();
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Convierte la factura en páginas JPEG listas para subir y calcula su hash.
 *
 * - Imagen (JPEG, PNG, WebP): corrige la orientación EXIF, ajusta a 1600 px y
 *   comprime a ≤ 1 MB.
 * - PDF: cada página (máximo 10) pasa por las mismas reglas.
 * - `sha256`: sha256 de la concatenación de los bytes de todas las páginas
 *   procesadas, en orden. El servidor lo recalcula igual (`sha256OfPages`).
 *
 * - `quality`: nitidez y brillo de cada página y avisos en español para que la
 *   UI proponga repetir la foto. Solo informa, no bloquea.
 *
 * Lanza `Error` con mensaje en español para formatos no admitidos, PDF con más
 * de 10 páginas o archivos ilegibles.
 */
export async function prepareInvoiceFile(file: File): Promise<PreparedInvoice> {
  const kind = classifyInvoiceType(file.type);
  const measured = kind === "pdf" ? await preparePdf(file) : await prepareImage(file);
  const pages = measured.map(({ page }) => page);

  return {
    pages,
    quality: summarizeInvoiceQuality(
      measured.map(({ quality }) => quality),
      kind,
    ),
    sha256: await hashInvoicePages(pages.map((page) => page.blob)),
    sourceName: file.name,
    sourceType: file.type,
  };
}
