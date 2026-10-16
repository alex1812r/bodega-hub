/**
 * jsdom no trae canvas real ni `createImageBitmap`: se sustituyen por dobles que
 * devuelven blobs de tamaño conocido, y pdfjs se mockea entero.
 */
import { webcrypto } from "node:crypto";

import { loadPdfjs, type Pdfjs } from "./loadPdfjs";
import { INVOICE_BLURRY_WARNING } from "./invoiceQuality.core";
import { TOO_MANY_INVOICE_PAGES_MESSAGE, UNSUPPORTED_INVOICE_TYPE_MESSAGE } from "./prepareInvoice.core";
import { prepareInvoiceFile } from "./prepareInvoiceFile";

jest.mock("./loadPdfjs", () => ({ loadPdfjs: jest.fn() }));

const drawImage = jest.fn();
/** Gris uniforme: sin bordes, como una foto totalmente desenfocada. */
const getImageData = jest.fn((_x: number, _y: number, width: number, height: number) => ({
  data: new Uint8ClampedArray(width * height * 4).fill(128),
  height,
  width,
}));

function fakePdfjs(numPages: number) {
  const render = jest.fn(() => ({ promise: Promise.resolve() }));
  const destroy = jest.fn(async () => undefined);
  const page = {
    cleanup: jest.fn(),
    getViewport: ({ scale }: { scale: number }) => ({ height: 842 * scale, width: 595 * scale }),
    render,
  };
  const pdf = { getPage: jest.fn(async () => page), numPages };
  (loadPdfjs as jest.Mock).mockResolvedValue({
    getDocument: jest.fn(() => ({ destroy, promise: Promise.resolve(pdf) })),
  } as unknown as Pdfjs);
  return { destroy, pdf, render };
}

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  }

  // El Blob de jsdom no implementa arrayBuffer(); los navegadores sí.
  if (!Blob.prototype.arrayBuffer) {
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
});

beforeEach(() => {
  drawImage.mockClear();
  getImageData.mockClear();
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage, fillRect: jest.fn(), fillStyle: "", getImageData }) as unknown as CanvasRenderingContext2D,
  );
  jest
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function toBlob(this: HTMLCanvasElement, callback, type) {
      // 0,2 bytes por píxel: una página de 1600 px pesa ~0,4 MB.
      callback(new Blob([new Uint8Array(Math.round(this.width * this.height * 0.2))], { type }));
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("prepareInvoiceFile", () => {
  it("rechaza tipos no soportados con mensaje en español", async () => {
    const file = new File(["x"], "factura.gif", { type: "image/gif" });

    await expect(prepareInvoiceFile(file)).rejects.toThrow(UNSUPPORTED_INVOICE_TYPE_MESSAGE);
  });

  it("convierte un PDF de 3 páginas en 3 imágenes ≤ 1600 px", async () => {
    const { destroy, pdf, render } = fakePdfjs(3);
    const file = new File([new Uint8Array([37, 80, 68, 70])], "factura.pdf", { type: "application/pdf" });

    const prepared = await prepareInvoiceFile(file);

    expect(prepared.pages).toHaveLength(3);
    expect(pdf.getPage).toHaveBeenNthCalledWith(1, 1);
    expect(pdf.getPage).toHaveBeenNthCalledWith(3, 3);
    expect(render).toHaveBeenCalledTimes(3);
    expect(destroy).toHaveBeenCalled();
    for (const page of prepared.pages) {
      expect(page.mediaType).toBe("image/jpeg");
      expect(Math.max(page.width, page.height)).toBe(1600);
      expect(page.bytes).toBeLessThanOrEqual(1_048_576);
    }
    expect(prepared).toMatchObject({ sourceName: "factura.pdf", sourceType: "application/pdf" });
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.quality.pages).toHaveLength(3);
  });

  it("rechaza un PDF de más de 10 páginas", async () => {
    const { destroy } = fakePdfjs(11);
    const file = new File([new Uint8Array([1])], "larga.pdf", { type: "application/pdf" });

    await expect(prepareInvoiceFile(file)).rejects.toThrow(TOO_MANY_INVOICE_PAGES_MESSAGE);
    expect(destroy).toHaveBeenCalled();
  });

  it("una foto se decodifica con la orientación EXIF y se ajusta a 1600 px", async () => {
    const close = jest.fn();
    const createImageBitmap = jest.fn(async () => ({ close, height: 3000, width: 4000 }));
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: createImageBitmap });
    const file = new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" });

    const prepared = await prepareInvoiceFile(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(prepared.pages).toHaveLength(1);
    expect(prepared.pages[0]).toMatchObject({ height: 1200, width: 1600 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(close).toHaveBeenCalled();
  });

  it("mide la calidad de la página procesada y avisa si la foto se ve borrosa, sin bloquear", async () => {
    const close = jest.fn();
    const createImageBitmap = jest.fn(async () => ({ close, height: 3000, width: 4000 }));
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: createImageBitmap });
    const file = new File([new Uint8Array([1, 2, 3])], "borrosa.jpg", { type: "image/jpeg" });

    const prepared = await prepareInvoiceFile(file);

    expect(getImageData).toHaveBeenCalledWith(0, 0, 1600, 1200);
    expect(prepared.pages).toHaveLength(1);
    expect(prepared.quality).toEqual({
      pages: [{ brightness: 128, sharpness: 0 }],
      warnings: [INVOICE_BLURRY_WARNING],
    });
    expect(close).toHaveBeenCalled();
  });
});
