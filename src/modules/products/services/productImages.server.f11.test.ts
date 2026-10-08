/**
 * @jest-environment node
 *
 * PRO-F11 · `POST /api/products/[id]/image-upload-url` respondía 500 cuando el
 * almacenamiento no estaba disponible: ahora es un 503 con mensaje.
 */

jest.mock("../../../lib/supabase/admin-client");
jest.mock("./products.server", () => ({
  getProductById: jest.fn().mockResolvedValue({ id: "p-1" }),
  updateProduct: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { createProductImageUploadUrl } from "./productImages.server";

const SUPABASE_URL = "https://proyecto.supabase.co";
const PUBLIC_URL = `${SUPABASE_URL}/storage/v1/object/public/product-images/p-1/cover.webp`;
const UNAVAILABLE = {
  message: "El almacenamiento de imágenes no está disponible.",
  status: 503,
};

type SignResult = { data: { signedUrl: string } | null; error: { message: string } | null };

function installStorage(sign: () => Promise<SignResult>, publicUrl = PUBLIC_URL) {
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    storage: {
      from: () => ({
        createSignedUploadUrl: jest.fn(sign),
        getPublicUrl: () => ({ data: { publicUrl } }),
      }),
    },
  });
}

describe("productImages.server createProductImageUploadUrl (PRO-F11)", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    jest.restoreAllMocks();
  });

  it("devuelve la URL firmada y la pública cuando el almacenamiento responde", async () => {
    installStorage(async () => ({ data: { signedUrl: "https://firma" }, error: null }));

    await expect(createProductImageUploadUrl("p-1", "webp", DEFAULT_STORE_ID)).resolves.toEqual({
      path: "p-1/cover.webp",
      publicUrl: PUBLIC_URL,
      uploadUrl: "https://firma",
    });
  });

  it("si el bucket no existe responde 503 con mensaje y sin el texto de Storage", async () => {
    installStorage(async () => ({ data: null, error: { message: "Bucket not found" } }));

    await expect(
      createProductImageUploadUrl("p-1", "webp", DEFAULT_STORE_ID),
    ).rejects.toMatchObject(UNAVAILABLE);
  });

  it("si Storage no responde (la llamada lanza) responde 503, no un 500 genérico", async () => {
    installStorage(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      createProductImageUploadUrl("p-1", "webp", DEFAULT_STORE_ID),
    ).rejects.toMatchObject(UNAVAILABLE);
  });

  it("si la URL pública no es la del proyecto responde 503, no un 500 genérico", async () => {
    installStorage(
      async () => ({ data: { signedUrl: "https://firma" }, error: null }),
      "http://kong:8000/storage/v1/object/public/product-images/p-1/cover.webp",
    );

    await expect(
      createProductImageUploadUrl("p-1", "webp", DEFAULT_STORE_ID),
    ).rejects.toMatchObject(UNAVAILABLE);
  });
});
