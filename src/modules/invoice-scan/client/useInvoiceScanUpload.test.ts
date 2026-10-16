import { act, renderHook, waitFor } from "@testing-library/react";

import type { InvoiceScanResponse } from "../contracts";
import type { PreparedInvoice } from "./prepareInvoiceFile";
import {
  INVOICE_SCAN_NETWORK_MESSAGE,
  INVOICE_SCAN_PREPARE_FALLBACK,
  useInvoiceScanUpload,
} from "./useInvoiceScanUpload";

const HASH = "b".repeat(64);

function preparedInvoice(pageBytes = [1200], warnings: string[] = []): PreparedInvoice {
  return {
    pages: pageBytes.map((bytes) => ({
      blob: new Blob([new Uint8Array(4)], { type: "image/jpeg" }),
      bytes,
      height: 1600,
      mediaType: "image/jpeg",
      width: 1200,
    })),
    quality: { pages: pageBytes.map(() => ({ brightness: 120, sharpness: 600 })), warnings },
    sha256: HASH,
    sourceName: "factura.jpg",
    sourceType: "image/jpeg",
  };
}

function scanResponse(used = 1): InvoiceScanResponse {
  return {
    cached: false,
    extraction: {
      confidence: 0.9,
      currency: "VES",
      lines: [],
      supplier: { name: "Distribuidora X" },
      warnings: [],
    },
    limits: { limit: 50, remaining: 50 - used, used },
    matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
    scanId: "scan-1",
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return jsonResponse({ error: { code, details, message } }, status);
}

/** Respuesta que nunca llega salvo que se corte: rechaza con AbortError al abortar. */
function pendingUntilAbort(signal?: AbortSignal | null) {
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
}

const file = new File([new Uint8Array(8)], "factura.jpg", { type: "image/jpeg" });

describe("useInvoiceScanUpload", () => {
  const fetchMock = jest.fn();
  let postHandler: (init: RequestInit) => Promise<Response>;

  beforeEach(() => {
    postHandler = async () => jsonResponse({ data: scanResponse() });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const path = String(url).split("?")[0];

      if (path === "/api/purchases/invoice-scan/limits") {
        return jsonResponse({ data: { limit: 50, remaining: 48, used: 2 } });
      }

      if (path === "/api/purchases/invoice-scan" && init.method === "POST") {
        return postHandler(init);
      }

      throw new Error(`Petición inesperada ${url}`);
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function postCalls() {
    return fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === "/api/purchases/invoice-scan" && init?.method === "POST",
    );
  }

  it("pide la cuota del día al montar y no la pide con enabled=false", async () => {
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }));

    await waitFor(() => expect(result.current.limits).toEqual({ limit: 50, remaining: 48, used: 2 }));
    expect(result.current.quotaExhausted).toBe(false);

    fetchMock.mockClear();
    renderHook(() => useInvoiceScanUpload({ enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recorre preparing → idle (preparada) → uploading → reading → done y actualiza la cuota", async () => {
    jest.useFakeTimers();
    let resolvePrepare: (value: PreparedInvoice) => void = () => undefined;
    let resolvePost: (value: Response) => void = () => undefined;
    postHandler = () => new Promise((resolve) => (resolvePost = resolve));
    const { result } = renderHook(() =>
      useInvoiceScanUpload({
        prepareFile: () => new Promise((resolve) => (resolvePrepare = resolve)),
        supplierId: "cont-1",
      }),
    );

    expect(result.current.stage).toBe("idle");

    let preparing: Promise<unknown> = Promise.resolve();
    act(() => {
      preparing = result.current.prepare(file);
    });
    expect(result.current.stage).toBe("preparing");
    expect(result.current.isBusy).toBe(true);

    await act(async () => {
      resolvePrepare(preparedInvoice([1200], ["La foto está muy oscura."]));
      await preparing;
    });
    expect(result.current.stage).toBe("idle");
    expect(result.current.prepared?.quality.warnings).toEqual(["La foto está muy oscura."]);

    let uploading: Promise<unknown> = Promise.resolve();
    act(() => {
      uploading = result.current.upload();
    });
    expect(result.current.stage).toBe("uploading");

    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(result.current.stage).toBe("reading");

    await act(async () => {
      resolvePost(jsonResponse({ data: scanResponse(3) }));
      await uploading;
    });
    expect(result.current.stage).toBe("done");
    expect(result.current.result?.scanId).toBe("scan-1");
    expect(result.current.limits).toEqual({ limit: 50, remaining: 47, used: 3 });
    expect(result.current.isBusy).toBe(false);

    const form = postCalls()[0]?.[1]?.body as FormData;
    expect(form.getAll("page")).toHaveLength(1);
    expect(form.get("sha256")).toBe(HASH);
    expect(form.get("supplierId")).toBe("cont-1");
  });

  it("abort corta la petición en curso y vuelve a idle sin error", async () => {
    let signal: AbortSignal | null | undefined;
    postHandler = (init) => {
      signal = init.signal;
      return pendingUntilAbort(init.signal);
    };
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }));

    await act(async () => {
      await result.current.prepare(file);
    });

    let uploading: Promise<InvoiceScanResponse | null> = Promise.resolve(null);
    act(() => {
      uploading = result.current.upload();
    });
    await waitFor(() => expect(signal).toBeDefined());

    await act(async () => {
      result.current.abort();
      expect(await uploading).toBeNull();
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current.stage).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.prepared).not.toBeNull();
  });

  it("al desmontar aborta la petición en curso", async () => {
    let signal: AbortSignal | null | undefined;
    postHandler = (init) => {
      signal = init.signal;
      return pendingUntilAbort(init.signal);
    };
    const { result, unmount } = renderHook(() =>
      useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }),
    );

    await act(async () => {
      await result.current.prepare(file);
    });
    act(() => {
      void result.current.upload();
    });
    await waitFor(() => expect(signal).toBeDefined());

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it.each([
    [
      409,
      "CONFLICT",
      "Esta factura ya se está leyendo; espera unos segundos y vuelve a intentarlo.",
      "in-progress",
    ],
    [502, "INVOICE_SCAN_PROVIDER_ERROR", "La lectura de la factura tardó demasiado.", "provider"],
  ])("un %s se muestra en español (%s)", async (status, code, message, kind) => {
    postHandler = async () => errorResponse(status, code, message);
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }));

    await act(async () => {
      await result.current.prepare(file);
      await result.current.upload();
    });

    expect(result.current.stage).toBe("error");
    expect(result.current.error).toEqual({ kind, message, status });
  });

  it("un 502 sin cuerpo cae al mensaje propio en español", async () => {
    postHandler = async () =>
      ({ headers: { get: () => "text/html" }, ok: false, status: 502 }) as unknown as Response;
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }));

    await act(async () => {
      await result.current.prepare(file);
      await result.current.upload();
    });

    expect(result.current.error?.kind).toBe("provider");
    expect(result.current.error?.message).toMatch(/servicio de lectura no respondió/);
  });

  it("un 429 pone la cuota al día con sus details y marca la cuota agotada", async () => {
    postHandler = async () =>
      errorResponse(429, "INVOICE_SCAN_LIMIT_REACHED", "Alcanzaste el límite de 50 páginas escaneadas por día.", {
        limit: 50,
        used: 50,
      });
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }));

    await act(async () => {
      await result.current.prepare(file);
      await result.current.upload();
    });

    expect(result.current.error?.kind).toBe("quota");
    expect(result.current.limits).toEqual({ limit: 50, remaining: 0, used: 50 });
    expect(result.current.quotaExhausted).toBe(true);
  });

  it("sin red: mensaje de conexión y Reintentar vuelve a subir", async () => {
    postHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => preparedInvoice() }));

    await act(async () => {
      await result.current.prepare(file);
      await result.current.upload();
    });
    expect(result.current.error).toEqual({ kind: "network", message: INVOICE_SCAN_NETWORK_MESSAGE });

    postHandler = async () => jsonResponse({ data: scanResponse() });
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.stage).toBe("done");
    expect(postCalls()).toHaveLength(2);
  });

  it("si falla la preparación, Reintentar vuelve a preparar el mismo archivo", async () => {
    const prepareFile = jest
      .fn()
      .mockRejectedValueOnce(new Error("Formato no admitido. Sube una foto JPG, PNG o WebP, o un PDF."))
      .mockRejectedValueOnce(new DOMException("canvas exploded", "InvalidStateError"))
      .mockResolvedValueOnce(preparedInvoice());
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile }));

    await act(async () => {
      await result.current.prepare(file);
    });
    expect(result.current.error).toEqual({
      kind: "prepare",
      message: "Formato no admitido. Sube una foto JPG, PNG o WebP, o un PDF.",
    });

    await act(async () => {
      await result.current.retry();
    });
    // Un fallo que no es del preparador no se muestra en inglés.
    expect(result.current.error?.message).toBe(INVOICE_SCAN_PREPARE_FALLBACK);

    await act(async () => {
      await result.current.retry();
    });
    expect(prepareFile).toHaveBeenCalledTimes(3);
    expect(prepareFile).toHaveBeenLastCalledWith(file);
    expect(result.current.stage).toBe("idle");
    expect(result.current.prepared).not.toBeNull();
  });

  it("más de 4 MB: firma upload-url, sube cada página por PUT y envía las rutas por JSON", async () => {
    const big = preparedInvoice([1_000_000, 1_000_000, 1_000_000, 1_000_000, 900_000]);
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const path = String(url).split("?")[0];

      if (path === "/api/purchases/invoice-scan/limits") {
        return jsonResponse({ data: { limit: 50, remaining: 50, used: 0 } });
      }

      if (path === "/api/purchases/invoice-scan/upload-url") {
        return jsonResponse({
          data: {
            uploads: big.pages.map((_page, index) => ({
              page: index + 1,
              path: `store/${HASH}/p${index + 1}.jpg`,
              signedUrl: `https://storage.test/p${index + 1}?token=t`,
              token: "t",
            })),
          },
        });
      }

      if (String(url).startsWith("https://storage.test/")) {
        return { ok: true, status: 200 } as Response;
      }

      if (path === "/api/purchases/invoice-scan" && init.method === "POST") {
        return jsonResponse({ data: scanResponse(5) });
      }

      throw new Error(`Petición inesperada ${url}`);
    });
    const { result } = renderHook(() => useInvoiceScanUpload({ prepareFile: async () => big }));

    await act(async () => {
      await result.current.prepare(file);
      await result.current.upload();
    });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.find((url) => url.startsWith("/api/purchases/invoice-scan/upload-url"))).toContain(
      `pages=5&sha256=${HASH}&types=image%2Fjpeg`,
    );
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith("https://storage.test/") && init?.method === "PUT")).toHaveLength(5);
    expect(JSON.parse(String(postCalls()[0]?.[1]?.body))).toEqual({
      sha256: HASH,
      storagePaths: [1, 2, 3, 4, 5].map((page) => `store/${HASH}/p${page}.jpg`),
    });
    expect(result.current.stage).toBe("done");
  });
});
