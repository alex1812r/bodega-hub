import * as SecureStore from "expo-secure-store";

/**
 * Adaptador de almacenamiento para la sesion de Supabase.
 *
 * `expo-secure-store` avisa (y en Android puede fallar) por encima de ~2 KB por
 * clave, y una sesion de Supabase con el objeto `user` suele pasarse. En vez de
 * cifrar a mano y guardar el resultado en AsyncStorage, partimos el valor en
 * trozos y los dejamos **todos** en el almacen seguro del sistema: menos codigo
 * criptografico propio y el token nunca sale del keystore.
 */

const CHUNK_SIZE = 1600;
const metaKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, index: number) => `${key}.${index}`;

function isValidKey(key: string) {
  // SecureStore solo admite alfanumericos, ".", "-" y "_".
  return /^[A-Za-z0-9._-]+$/.test(key);
}

async function readChunkCount(key: string) {
  const raw = await SecureStore.getItemAsync(metaKey(key));
  const count = raw ? Number.parseInt(raw, 10) : Number.NaN;

  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function clearChunks(key: string, count: number) {
  const deletions: Promise<void>[] = [];

  for (let index = 0; index < count; index += 1) {
    deletions.push(SecureStore.deleteItemAsync(chunkKey(key, index)));
  }

  deletions.push(SecureStore.deleteItemAsync(metaKey(key)));

  await Promise.all(deletions);
}

export const secureChunkStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isValidKey(key)) {
      return null;
    }

    const count = await readChunkCount(key);

    if (count === 0) {
      // Sesiones escritas antes de este adaptador (o valores cortos).
      return SecureStore.getItemAsync(key);
    }

    const parts = await Promise.all(
      Array.from({ length: count }, (_unused, index) =>
        SecureStore.getItemAsync(chunkKey(key, index)),
      ),
    );

    // Un trozo perdido deja la sesion corrupta: mejor tratarla como ausente.
    if (parts.some((part) => part === null)) {
      await clearChunks(key, count);
      return null;
    }

    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!isValidKey(key)) {
      return;
    }

    await clearChunks(key, await readChunkCount(key));
    await SecureStore.deleteItemAsync(key);

    const chunks: string[] = [];

    for (let start = 0; start < value.length; start += CHUNK_SIZE) {
      chunks.push(value.slice(start, start + CHUNK_SIZE));
    }

    if (chunks.length === 0) {
      chunks.push("");
    }

    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
    );
    await SecureStore.setItemAsync(metaKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    if (!isValidKey(key)) {
      return;
    }

    await clearChunks(key, await readChunkCount(key));
    await SecureStore.deleteItemAsync(key);
  },
};
