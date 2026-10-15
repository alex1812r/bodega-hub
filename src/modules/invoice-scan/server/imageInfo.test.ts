/**
 * @jest-environment node
 */

import sharp from "sharp";

import { ApiError } from "@/lib/api/apiError";

import { jpegHeader } from "./__fixtures__/images";
import { INVOICE_LOW_RES_SIDE, INVOICE_MIN_SIDE, inspectInvoiceImage } from "./imageInfo";

function canvas(width: number, height: number, alpha = false) {
  return sharp({
    create: {
      background: alpha ? { alpha: 0.5, b: 3, g: 2, r: 1 } : "#ffffff",
      channels: alpha ? 4 : 3,
      height,
      width,
    },
  });
}

async function bytes(image: sharp.Sharp) {
  return new Uint8Array(await image.toBuffer());
}

function caught(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  throw new Error("se esperaba un ApiError");
}

describe("inspectInvoiceImage", () => {
  it("exposes the thresholds of the plan", () => {
    expect(INVOICE_MIN_SIDE).toBe(400);
    expect(INVOICE_LOW_RES_SIDE).toBe(1000);
  });

  it("reads a real JPEG (SOF0 and progressive SOF2)", async () => {
    const baseline = await bytes(canvas(1200, 900).jpeg());
    const progressive = await bytes(canvas(640, 1600).jpeg({ progressive: true }));

    expect(inspectInvoiceImage(baseline, "image/jpeg")).toEqual({
      height: 900,
      mediaType: "image/jpeg",
      width: 1200,
    });
    expect(inspectInvoiceImage(progressive, "image/jpeg")).toMatchObject({ height: 1600, width: 640 });
  });

  it("reads a minimal fixed-byte JPEG header", () => {
    expect(inspectInvoiceImage(jpegHeader(1131, 1600, "p1"), "image/jpeg")).toMatchObject({
      height: 1600,
      width: 1131,
    });
  });

  it("reads a real PNG (IHDR)", async () => {
    const png = await bytes(canvas(800, 450).png());

    expect(inspectInvoiceImage(png, "image/png")).toEqual({ height: 450, mediaType: "image/png", width: 800 });
  });

  it.each([
    ["VP8", 1000, 700, () => canvas(1000, 700).webp()],
    ["VP8L", 1001, 701, () => canvas(1001, 701).webp({ lossless: true })],
    ["VP8X", 1002, 702, () => canvas(1002, 702, true).webp()],
  ])("reads a real WebP (%s)", async (chunk, width, height, image) => {
    const webp = await bytes(image());

    expect(new TextDecoder().decode(webp.subarray(12, 16)).trim()).toBe(chunk);
    expect(inspectInvoiceImage(webp, "image/webp")).toEqual({ height, mediaType: "image/webp", width });
  });

  it("rejects a renamed .exe (MZ) with a 400 in Spanish", () => {
    const exe = new Uint8Array(4096);
    exe.set([0x4d, 0x5a, 0x90, 0x00]);
    exe.set(new TextEncoder().encode("PE\0\0"), 0x80);

    const error = caught(() => inspectInvoiceImage(exe, "image/jpeg"));

    expect(error.status).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toMatch(/no es una imagen válida/);
  });

  it("rejects an image whose content does not match the declared type", async () => {
    const png = await bytes(canvas(800, 600).png());

    const error = caught(() => inspectInvoiceImage(png, "image/jpeg"));

    expect(error.status).toBe(400);
    expect(error.message).toMatch(/no coincide con su tipo/);
  });

  it("rejects a truncated header whose dimensions cannot be read", async () => {
    const png = await bytes(canvas(800, 600).png());

    const error = caught(() => inspectInvoiceImage(png.subarray(0, 16), "image/png"));

    expect(error.status).toBe(400);
    expect(error.message).toMatch(/tamaño de la imagen/);
    expect(caught(() => inspectInvoiceImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")).status).toBe(400);
  });

  it("rejects a 300 px photo as too small to read", async () => {
    const small = await bytes(canvas(300, 225).jpeg());

    const error = caught(() => inspectInvoiceImage(small, "image/jpeg"));

    expect(error.status).toBe(400);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe(
      "La imagen es demasiado pequeña para leer la factura. Toma la foto más cerca y con buena luz.",
    );
  });

  it("accepts a page whose longer side is exactly the minimum", () => {
    expect(inspectInvoiceImage(jpegHeader(INVOICE_MIN_SIDE, 300), "image/jpeg").width).toBe(400);
    expect(() => inspectInvoiceImage(jpegHeader(399, 300), "image/jpeg")).toThrow(ApiError);
  });
});

/** Inserta `insert` en `data` en la posición `at`. */
function splice(data: Uint8Array, at: number, insert: readonly number[]): Uint8Array {
  const out = new Uint8Array(data.length + insert.length);
  out.set(data.subarray(0, at));
  out.set(insert, at);
  out.set(data.subarray(at), at + insert.length);
  return out;
}

/** Offset del primer chunk `type` de un PNG o WebP (cabecera de 4 B ASCII). */
function indexOfAscii(data: Uint8Array, type: string, from = 0) {
  return Buffer.from(data).indexOf(type, from, "latin1");
}

describe("inspectInvoiceImage: estructura (N3)", () => {
  const STRUCTURE = /tamaño de la imagen|no es una imagen válida/;

  it("rejects a JPEG truncated to 25 % (no EOI)", async () => {
    const full = await bytes(canvas(1200, 1600).jpeg());

    expect(caught(() => inspectInvoiceImage(full.subarray(0, Math.floor(full.length * 0.25)), "image/jpeg")).message).toMatch(
      STRUCTURE,
    );
  });

  it("rejects the first 700 B of a JPEG (header only)", async () => {
    const full = await bytes(canvas(1200, 1600).jpeg());

    expect(caught(() => inspectInvoiceImage(full.subarray(0, 700), "image/jpeg")).message).toMatch(STRUCTURE);
  });

  it("rejects a JPEG with a fake SOF0 inserted before the real one", async () => {
    const real = await bytes(canvas(1200, 1600).jpeg());
    const fakeSof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0xd0, 0x07, 0xd0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];

    expect(caught(() => inspectInvoiceImage(splice(real, 2, fakeSof), "image/jpeg")).message).toMatch(STRUCTURE);
  });

  it("rejects a JPEG whose SOF length does not match its component count", () => {
    const data = jpegHeader(1600, 1200, "x");
    const sof = Buffer.from(data).indexOf(Buffer.from([0xff, 0xc0]));
    data[sof + 9] = 0x04; // dice 4 componentes con longitud de 3

    expect(caught(() => inspectInvoiceImage(data, "image/jpeg")).message).toMatch(STRUCTURE);
  });

  it("accepts trailing padding after EOI up to 64 KB, but not more", async () => {
    const real = await bytes(canvas(1200, 1600).jpeg());
    const padded = (extra: number) => {
      const out = new Uint8Array(real.length + extra);
      out.set(real);
      return out;
    };

    expect(inspectInvoiceImage(padded(1024), "image/jpeg").width).toBe(1200);
    expect(caught(() => inspectInvoiceImage(padded(200 * 1024), "image/jpeg")).message).toMatch(STRUCTURE);
  });

  it("rejects a PNG whose IHDR was rewritten without fixing the CRC", async () => {
    const png = await bytes(canvas(800, 600).png());
    png.set([0, 0, 0x0b, 0xb8, 0, 0, 0x0b, 0xb8], 16); // 3000×3000

    expect(caught(() => inspectInvoiceImage(png, "image/png")).message).toMatch(STRUCTURE);
  });

  it("rejects a PNG with only signature + IHDR + text (no IDAT/IEND)", async () => {
    const png = await bytes(canvas(800, 600).png());
    const headerOnly = new Uint8Array([...png.subarray(0, 33), ...new TextEncoder().encode("caos2-basura")]);

    expect(caught(() => inspectInvoiceImage(headerOnly, "image/png")).message).toMatch(STRUCTURE);
  });

  it("rejects a PNG truncated before IEND", async () => {
    const png = await bytes(canvas(800, 600).png());

    expect(caught(() => inspectInvoiceImage(png.subarray(0, indexOfAscii(png, "IEND") - 4), "image/png")).message).toMatch(
      STRUCTURE,
    );
  });

  it("rejects a fake VP8X header followed by garbage", () => {
    const head = Buffer.alloc(30);
    head.write("RIFF", 0, "latin1");
    head.writeUInt32LE(22 + 1000, 4);
    head.write("WEBP", 8, "latin1");
    head.write("VP8X", 12, "latin1");
    head.writeUInt32LE(10, 16);
    head.writeUIntLE(3999, 24, 3);
    head.writeUIntLE(3999, 27, 3);
    const fake = new Uint8Array(Buffer.concat([head, Buffer.alloc(1000, 0x41)]));

    expect(caught(() => inspectInvoiceImage(fake, "image/webp")).message).toMatch(STRUCTURE);
  });

  it("rejects a truncated WebP (RIFF size does not match the length)", async () => {
    const webp = await bytes(canvas(1000, 700).webp());

    expect(caught(() => inspectInvoiceImage(webp.subarray(0, webp.length - 40), "image/webp")).message).toMatch(STRUCTURE);
  });

  it("rejects a WebP whose VP8 chunk size overflows the file", async () => {
    const webp = await bytes(canvas(1000, 700).webp());
    new DataView(webp.buffer, webp.byteOffset).setUint32(16, webp.length, true);

    expect(caught(() => inspectInvoiceImage(webp, "image/webp")).message).toMatch(STRUCTURE);
  });

  it("known limit: structurally valid files with rewritten dimensions still pass", async () => {
    // Sin decodificar no se puede saber; solo perjudica a la propia tienda (severidad baja).
    const real = await bytes(canvas(1200, 1600).jpeg());
    const sof = Buffer.from(real).indexOf(Buffer.from([0xff, 0xc0]));
    real.set([0x0a, 0x64, 0x07, 0xd0], sof + 5); // 2000×2660

    expect(inspectInvoiceImage(real, "image/jpeg")).toMatchObject({ height: 2660, width: 2000 });
  });
});

describe("inspectInvoiceImage: proporciones degeneradas (N4)", () => {
  const RATIO = /^La imagen tiene proporciones que no corresponden a una factura/;

  it("rejects 1×10000 PNG and 10000×1 JPEG with a 400 in Spanish", async () => {
    const tall = await bytes(canvas(1, 10000).png());
    const wide = await bytes(canvas(10000, 1).jpeg());

    for (const [data, type] of [
      [tall, "image/png"],
      [wide, "image/jpeg"],
    ] as const) {
      const error = caught(() => inspectInvoiceImage(data, type));
      expect(error.status).toBe(400);
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toMatch(RATIO);
    }
  });

  it("rejects a shorter side of 199 px and accepts 200 px", () => {
    expect(caught(() => inspectInvoiceImage(jpegHeader(199, 1600), "image/jpeg")).message).toMatch(RATIO);
    expect(inspectInvoiceImage(jpegHeader(200, 1600), "image/jpeg").width).toBe(200);
  });

  it("accepts a 600×4000 thermal receipt strip", async () => {
    const strip = await bytes(canvas(600, 4000).jpeg());

    expect(inspectInvoiceImage(strip, "image/jpeg")).toMatchObject({ height: 4000, width: 600 });
  });
});
