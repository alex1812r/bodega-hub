/**
 * @jest-environment node
 */
import { sha256OfPages } from "../server/storage";

import { INVOICE_MAX_BYTES, INVOICE_MAX_SIDE } from "./invoiceLimits";
import {
  assertInvoicePageCount,
  classifyInvoiceType,
  concatBytes,
  encodePageWithinLimit,
  fitWithin,
  hashInvoicePages,
  INVOICE_PAGE_TOO_HEAVY_MESSAGE,
  INVOICE_QUALITY_STEPS,
  sha256Hex,
  TOO_MANY_INVOICE_PAGES_MESSAGE,
  UNSUPPORTED_INVOICE_TYPE_MESSAGE,
  type PageEncoder,
} from "./prepareInvoice.core";

const TWELVE_MB = 12 * 1024 * 1024;

/** Encoder falso: el peso escala con el área y la calidad desde 12 MB a 4000×3000. */
function fakeEncoder(baseBytes = TWELVE_MB, qualityMatters = true) {
  const calls: { width: number; height: number; quality: number }[] = [];
  const encode: PageEncoder = async ({ height, width }, quality) => {
    calls.push({ height, quality, width });
    const bytes = Math.round(baseBytes * ((width * height) / (4000 * 3000)) * (qualityMatters ? quality : 1));
    return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
  };
  return { calls, encode };
}

describe("classifyInvoiceType", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("acepta %s como imagen", (type) => {
    expect(classifyInvoiceType(type)).toBe("image");
  });

  it("acepta PDF", () => {
    expect(classifyInvoiceType("application/pdf")).toBe("pdf");
  });

  it.each(["image/gif", "image/heic", "text/plain", ""])("rechaza %s con mensaje en español", (type) => {
    expect(() => classifyInvoiceType(type)).toThrow(UNSUPPORTED_INVOICE_TYPE_MESSAGE);
  });
});

it("assertInvoicePageCount rechaza más de 10 páginas", () => {
  expect(() => assertInvoicePageCount(10)).not.toThrow();
  expect(() => assertInvoicePageCount(11)).toThrow(TOO_MANY_INVOICE_PAGES_MESSAGE);
});

describe("fitWithin", () => {
  it("ajusta el lado mayor a 1600 conservando la proporción", () => {
    expect(fitWithin({ height: 3000, width: 4000 })).toEqual({ height: 1200, width: 1600 });
    expect(fitWithin({ height: 4000, width: 3000 })).toEqual({ height: 1600, width: 1200 });
  });

  it("no amplía imágenes pequeñas", () => {
    expect(fitWithin({ height: 600, width: 800 })).toEqual({ height: 600, width: 800 });
  });
});

describe("encodePageWithinLimit", () => {
  it("una foto de 12 MB y 4000×3000 sale ≤ 1600 px y ≤ 1 MB", async () => {
    const { calls, encode } = fakeEncoder();

    const page = await encodePageWithinLimit({ height: 3000, width: 4000 }, encode, "image/jpeg");

    expect(Math.max(page.width, page.height)).toBeLessThanOrEqual(INVOICE_MAX_SIDE);
    expect(page.bytes).toBeLessThanOrEqual(INVOICE_MAX_BYTES);
    expect(page.bytes).toBe(page.blob.size);
    expect(page.mediaType).toBe("image/jpeg");
    // Bajó la calidad paso a paso antes de aceptar.
    expect(calls.map((call) => call.quality)).toEqual(INVOICE_QUALITY_STEPS.slice(0, calls.length));
    expect(calls.length).toBeGreaterThan(1);
  });

  it("si a calidad mínima sigue pesando más de 1 MB, reduce dimensiones", async () => {
    const { calls, encode } = fakeEncoder(TWELVE_MB * 4, false);

    const page = await encodePageWithinLimit({ height: 3000, width: 4000 }, encode, "image/webp");

    expect(page.bytes).toBeLessThanOrEqual(INVOICE_MAX_BYTES);
    expect(page.width).toBeLessThan(1600);
    expect(page.width / page.height).toBeCloseTo(4 / 3, 1);
    expect(calls.at(-1)?.quality).toBe(INVOICE_QUALITY_STEPS.at(-1));
  });

  it("si ni reduciendo cabe, lanza un error en español", async () => {
    const encode: PageEncoder = async () => new Blob([new Uint8Array(INVOICE_MAX_BYTES + 1)]);

    await expect(encodePageWithinLimit({ height: 3000, width: 4000 }, encode, "image/jpeg")).rejects.toThrow(
      INVOICE_PAGE_TOO_HEAVY_MESSAGE,
    );
  });
});

describe("hash", () => {
  it("concatBytes une en orden", () => {
    expect(concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("sha256Hex coincide con el vector conocido", async () => {
    await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("el hash del escaneo es estable e igual al del servidor para los mismos bytes", async () => {
    const pageA = new Uint8Array([10, 20, 30, 40]);
    const pageB = new Uint8Array([50, 60]);
    const blobs = [new Blob([pageA]), new Blob([pageB])];

    const first = await hashInvoicePages(blobs);
    const second = await hashInvoicePages(blobs);

    expect(first).toBe(second);
    expect(first).toBe(sha256OfPages([pageA, pageB]));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
