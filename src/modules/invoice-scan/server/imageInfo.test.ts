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
