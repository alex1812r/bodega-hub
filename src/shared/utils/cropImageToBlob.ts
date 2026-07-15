export const PRODUCT_IMAGE_ASPECT = 4 / 3;
export const PRODUCT_IMAGE_WIDTH = 800;
export const PRODUCT_IMAGE_HEIGHT = 600;
export const PRODUCT_IMAGE_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export type PixelCrop = {
  height: number;
  width: number;
  x: number;
  y: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("No se pudo cargar la imagen.")));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo exportar la imagen."));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

export async function cropImageToBlob(
  imageSrc: string,
  pixelCrop: PixelCrop,
  outputWidth = PRODUCT_IMAGE_WIDTH,
  outputHeight = PRODUCT_IMAGE_HEIGHT,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("No se pudo preparar el lienzo de recorte.");
  }

  context.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  if (canvas.toDataURL("image/webp").startsWith("data:image/webp")) {
    return canvasToBlob(canvas, "image/webp", 0.9);
  }

  return canvasToBlob(canvas, "image/jpeg", 0.9);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("No se pudo leer el archivo.")));
    reader.readAsDataURL(file);
  });
}

export function validateProductImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    return "Selecciona un archivo de imagen valido.";
  }

  if (file.size > PRODUCT_IMAGE_MAX_INPUT_BYTES) {
    return "La imagen supera el limite de 5 MB.";
  }

  return null;
}
