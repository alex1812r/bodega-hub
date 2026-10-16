/**
 * Carga perezosa de pdfjs-dist: el import dinámico deja la librería en su propio
 * chunk y solo se descarga cuando el usuario sube un PDF.
 *
 * El worker se declara con `new URL(..., import.meta.url)`, que webpack 5
 * (`next dev --webpack` y el build) y Turbopack emiten como asset propio; pdfjs
 * lo arranca como module worker a partir de `workerSrc`.
 */
export type Pdfjs = typeof import("pdfjs-dist");

export async function loadPdfjs(): Promise<Pdfjs> {
  const pdfjs = await import("pdfjs-dist");

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  return pdfjs;
}
