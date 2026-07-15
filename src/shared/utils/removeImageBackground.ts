export type RemoveBackgroundProgress = (message: string) => void;

export async function removeImageBackground(
  blob: Blob,
  onProgress?: RemoveBackgroundProgress,
): Promise<Blob> {
  onProgress?.("Cargando modelo de IA (solo la primera vez)...");

  const { removeBackground } = await import("@imgly/background-removal");

  onProgress?.("Quitando fondo...");

  return removeBackground(blob, {
    progress: (_key, current, total) => {
      if (total <= 0) {
        return;
      }

      const percent = Math.round((current / total) * 100);
      onProgress?.(`Quitando fondo... ${percent}%`);
    },
  });
}
