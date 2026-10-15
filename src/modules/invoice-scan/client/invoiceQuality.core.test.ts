/**
 * @jest-environment node
 */
import {
  INVOICE_BLUR_THRESHOLD,
  INVOICE_BLURRY_WARNING,
  INVOICE_BRIGHT_THRESHOLD,
  INVOICE_BRIGHT_WARNING,
  INVOICE_DARK_THRESHOLD,
  INVOICE_DARK_WARNING,
  INVOICE_QUALITY_SIDE,
  laplacianVariance,
  measurePageQuality,
  resampleLuminance,
  rgbaToLuminance,
  summarizeInvoiceQuality,
  type LuminanceImage,
} from "./invoiceQuality.core";

/** Tablero de ajedrez: bordes duros, como texto impreso enfocado. */
function checkerboard(width: number, height: number, cell: number, low = 20, high = 235): LuminanceImage {
  const data = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? low : high;
    }
  }

  return { data, height, width };
}

/** Desenfoque de caja (radio r), como una foto movida o fuera de foco. */
function boxBlur({ data, height, width }: LuminanceImage, radius: number): LuminanceImage {
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;

          if (yy >= 0 && yy < height && xx >= 0 && xx < width) {
            sum += data[yy * width + xx];
            count += 1;
          }
        }
      }

      out[y * width + x] = sum / count;
    }
  }

  return { data: out, height, width };
}

function scaleBrightness({ data, height, width }: LuminanceImage, factor: number, offset = 0): LuminanceImage {
  return { data: Uint8ClampedArray.from(data, (value) => value * factor + offset), height, width };
}

describe("measurePageQuality", () => {
  const sharp = checkerboard(1200, 900, 24);

  it("un tablero nítido supera el umbral de nitidez", () => {
    expect(measurePageQuality(sharp).sharpness).toBeGreaterThan(INVOICE_BLUR_THRESHOLD);
  });

  it("el mismo tablero desenfocado con una caja queda por debajo del umbral", () => {
    const quality = measurePageQuality(boxBlur(sharp, 4));

    expect(quality.sharpness).toBeLessThan(INVOICE_BLUR_THRESHOLD);
    expect(summarizeInvoiceQuality([quality]).warnings).toEqual([INVOICE_BLURRY_WARNING]);
  });

  it("una foto pequeña ampliada (200 px) se mide como borrosa aunque sus bordes sean duros", () => {
    const small = checkerboard(200, 150, 4);

    expect(measurePageQuality(small).sharpness).toBeLessThan(INVOICE_BLUR_THRESHOLD);
  });

  it("la nitidez no depende del contraste: un tablero oscuro y enfocado sigue nítido", () => {
    const dark = scaleBrightness(sharp, 0.2);
    const quality = measurePageQuality(dark);

    expect(quality.sharpness).toBeGreaterThan(INVOICE_BLUR_THRESHOLD);
    expect(quality.brightness).toBeLessThan(INVOICE_DARK_THRESHOLD);
    expect(summarizeInvoiceQuality([quality]).warnings).toEqual([INVOICE_DARK_WARNING]);
  });

  it("una foto lavada avisa de sobreexposición, pero un PDF blanco no", () => {
    const washed = measurePageQuality(scaleBrightness(sharp, 0.2, 200));

    expect(washed.brightness).toBeGreaterThan(INVOICE_BRIGHT_THRESHOLD);
    expect(summarizeInvoiceQuality([washed], "image").warnings).toEqual([INVOICE_BRIGHT_WARNING]);
    expect(summarizeInvoiceQuality([washed], "pdf").warnings).toEqual([]);
  });

  it("una foto nítida y con buena luz no lleva avisos", () => {
    const quality = measurePageQuality(sharp);

    expect(quality.brightness).toBeCloseTo(127.5, 0);
    expect(summarizeInvoiceQuality([quality])).toEqual({ pages: [quality], warnings: [] });
  });

  it("una imagen plana tiene nitidez 0", () => {
    const flat = { data: new Uint8ClampedArray(400 * 300).fill(128), height: 300, width: 400 };

    expect(measurePageQuality(flat)).toEqual({ brightness: 128, sharpness: 0 });
  });

  it("un aviso aparece una sola vez aunque fallen varias páginas", () => {
    const blurry = { brightness: 120, sharpness: 10 };
    const good = { brightness: 120, sharpness: 900 };

    expect(summarizeInvoiceQuality([good, blurry, blurry]).warnings).toEqual([INVOICE_BLURRY_WARNING]);
  });
});

describe("resampleLuminance", () => {
  it("lleva el lado mayor a 800 px al reducir y al ampliar, conservando la proporción", () => {
    expect(resampleLuminance(checkerboard(1600, 1200, 4))).toMatchObject({ height: 600, width: INVOICE_QUALITY_SIDE });
    expect(resampleLuminance(checkerboard(150, 200, 4))).toMatchObject({ height: INVOICE_QUALITY_SIDE, width: 600 });
  });

  it("al reducir promedia por área (el brillo medio se conserva)", () => {
    const reduced = resampleLuminance(checkerboard(1600, 1600, 1, 0, 200));

    expect(Array.from(reduced.data).every((value) => value === 100)).toBe(true);
  });
});

describe("laplacianVariance y rgbaToLuminance", () => {
  it("una imagen menor de 3×3 tiene varianza 0", () => {
    expect(laplacianVariance({ data: [0, 255, 0, 255], height: 2, width: 2 })).toBe(0);
  });

  it("convierte RGBA a luminancia Rec. 601", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);

    expect(Array.from(rgbaToLuminance(rgba, 2, 2).data)).toEqual([76, 150, 29, 255]);
  });
});
