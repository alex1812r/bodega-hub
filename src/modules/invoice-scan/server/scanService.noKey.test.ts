/**
 * @jest-environment node
 *
 * CIE-08 B4: con datos en Supabase y sin ninguna key de IA, el escaneo no puede
 * caer al modelo mock (devolvería la factura de fixture como leída y quedaría en
 * caché por hash). Responde 503 antes de reservar: sin fila ni cupo cobrado.
 */
import { ApiError } from "@/lib/api/apiError";
import { resetModelProviderWarning } from "@/modules/assistant/server/provider";

import { jpegHeader } from "./__fixtures__/images";
import { INVOICE_SCAN_NOT_CONFIGURED_MESSAGE } from "./provider";
import { createInvoiceScanDeps, scanInvoice, type InvoiceScanRepo } from "./scanService";

const ENV_KEYS = [
  "INVOICE_SCAN_PROVIDER",
  "INVOICE_SCAN_MODEL",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

describe("escaneo sin key de IA (CIE-08 B4)", () => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    resetModelProviderWarning("invoice-scan");
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    ENV_KEYS.forEach((key) => {
      const value = original[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  function supabaseDepsWithSpyRepo() {
    const real = createInvoiceScanDeps("supabase");
    const reserveScan = jest.fn<ReturnType<InvoiceScanRepo["reserveScan"]>, Parameters<InvoiceScanRepo["reserveScan"]>>();
    const extract = jest.fn();

    return {
      deps: { ...real, extract, repo: { ...real.repo, reserveScan } },
      extract,
      reserveScan,
    };
  }

  const ctx = { storeId: "store-no-key", userId: "user-1" };
  const pages = [{ data: jpegHeader(1600, 1200, "p1"), mediaType: "image/jpeg" as const }];

  it("supabase sin keys: 503 en español sin reservar (sin fila, sin cupo) ni llamar al modelo", async () => {
    const { deps, extract, reserveScan } = supabaseDepsWithSpyRepo();

    const error = await scanInvoice(deps, ctx, { pages, source: "upload" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: INVOICE_SCAN_NOT_CONFIGURED_MESSAGE, status: 503 });
    expect(INVOICE_SCAN_NOT_CONFIGURED_MESSAGE).toBe(
      "El escaneo de facturas no está configurado: falta la key del proveedor de IA.",
    );
    expect(reserveScan).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it("supabase con INVOICE_SCAN_PROVIDER=mock explícito sigue usando el mock", () => {
    process.env.INVOICE_SCAN_PROVIDER = "mock";

    expect(createInvoiceScanDeps("supabase").model()).toMatchObject({ provider: "mock" });
  });

  it("supabase con la key de la alternativa usa el proveedor real", () => {
    process.env.INVOICE_SCAN_PROVIDER = "google";
    process.env.ANTHROPIC_API_KEY = "a-key";

    expect(createInvoiceScanDeps("supabase").model()).toMatchObject({ provider: "anthropic" });
  });

  it("datasource mock sin keys sigue cayendo al mock", () => {
    expect(createInvoiceScanDeps("mock").model()).toMatchObject({ provider: "mock" });
  });
});
