import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "../../contracts";
import type { PreparedInvoice } from "../prepareInvoiceFile";
import {
  INVOICE_SCAN_ACCEPT,
  INVOICE_SCAN_QUOTA_EXHAUSTED_MESSAGE,
  InvoiceScanModal,
  type InvoiceScanModalProps,
} from "./InvoiceScanModal";

const HASH = "c".repeat(64);
const DARK_WARNING = "La foto está muy oscura.";

function preparedInvoice(pages = 1, warnings: string[] = []): PreparedInvoice {
  return {
    pages: Array.from({ length: pages }, () => ({
      blob: new Blob([new Uint8Array(4)], { type: "image/jpeg" }),
      bytes: 1000,
      height: 1600,
      mediaType: "image/jpeg" as const,
      width: 1200,
    })),
    quality: { pages: [], warnings },
    sha256: HASH,
    sourceName: "factura.jpg",
    sourceType: "image/jpeg",
  };
}

function scanResponse(used: number): InvoiceScanResponse {
  return {
    cached: false,
    extraction: { confidence: 0.9, currency: "VES", lines: [], supplier: { name: "Proveedor" }, warnings: [] },
    limits: { limit: 50, remaining: 50 - used, used },
    matched: { lines: [], supplier: {}, totals: { computed: 0, mismatch: false } },
    scanId: "scan-9",
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

const file = new File([new Uint8Array(8)], "factura.jpg", { type: "image/jpeg" });

describe("InvoiceScanModal", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let limitsPayload: { limit: number; remaining: number; used: number };
  let postResponses: (() => Promise<Response>)[];
  let coarsePointer: boolean;

  beforeEach(() => {
    limitsPayload = { limit: 50, remaining: 48, used: 2 };
    postResponses = [];
    coarsePointer = false;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (String(url) === "/api/purchases/invoice-scan/limits") {
        return jsonResponse({ data: limitsPayload });
      }

      if (String(url) === "/api/purchases/invoice-scan" && init.method === "POST") {
        const next = postResponses.shift();
        return next ? next() : jsonResponse({ data: scanResponse(3) });
      }

      throw new Error(`Petición inesperada ${url}`);
    });
    global.fetch = fetchMock;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: query === "(pointer: coarse)" && coarsePointer,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => `blob:preview-${Math.random()}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  function renderModal(props: Partial<InvoiceScanModalProps> = {}) {
    const handlers = {
      onBusyChange: jest.fn(),
      onOpenChange: jest.fn(),
      onScanned: jest.fn(),
    };

    render(
      <InvoiceScanModal
        open
        prepareFile={async () => preparedInvoice()}
        {...handlers}
        {...props}
      />,
    );

    return handlers;
  }

  function postCount() {
    return fetchMock.mock.calls.filter(([url, init]) => url === "/api/purchases/invoice-scan" && init?.method === "POST")
      .length;
  }

  async function selectFile() {
    await act(async () => {
      fireEvent.change(screen.getByTestId("invoice-scan-file-input"), { target: { files: [file] } });
    });
  }

  it("muestra la cuota del día y el input acepta fotos y PDF, sin cámara en escritorio", async () => {
    renderModal();

    expect(await screen.findByText("Escaneos hoy: 2 de 50")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-scan-file-input")).toHaveAttribute("accept", INVOICE_SCAN_ACCEPT);
    expect(screen.queryByTestId("invoice-scan-camera-input")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar archivo" })).toBeEnabled();
  });

  it("en móvil ofrece «Tomar foto» con capture=environment", async () => {
    coarsePointer = true;
    renderModal();

    const camera = screen.getByTestId("invoice-scan-camera-input");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", INVOICE_SCAN_ACCEPT);

    const click = jest.spyOn(camera, "click");
    await userEvent.click(screen.getByRole("button", { name: "Tomar foto" }));
    expect(click).toHaveBeenCalled();
    await screen.findByText("Escaneos hoy: 2 de 50");
  });

  it("al seleccionar un archivo sin avisos: vista previa, escanea y entrega la respuesta", async () => {
    const handlers = renderModal({ prepareFile: async () => preparedInvoice(2) });
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    await waitFor(() => expect(handlers.onScanned).toHaveBeenCalledWith(scanResponse(3)));
    expect(screen.getByRole("img", { name: "Página 1 de la factura" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Página 2 de la factura" })).toBeInTheDocument();
    expect(screen.getByText("Escaneos hoy: 3 de 50")).toBeInTheDocument();
    expect(screen.getByText("Factura leída.")).toBeInTheDocument();
  });

  it("arrastrar y soltar un archivo lo escanea igual que seleccionarlo", async () => {
    const prepareFile = jest.fn(async () => preparedInvoice());
    const handlers = renderModal({ prepareFile });
    await screen.findByText("Escaneos hoy: 2 de 50");

    await act(async () => {
      fireEvent.dragOver(screen.getByTestId("invoice-scan-dropzone"), { dataTransfer: { files: [file] } });
      fireEvent.drop(screen.getByTestId("invoice-scan-dropzone"), { dataTransfer: { files: [file] } });
    });

    await waitFor(() => expect(handlers.onScanned).toHaveBeenCalled());
    expect(prepareFile).toHaveBeenCalledWith(file);
  });

  it("con avisos de calidad espera: «Repetir foto» vuelve a elegir y «Escanear igual» sube", async () => {
    const handlers = renderModal({ prepareFile: async () => preparedInvoice(1, [DARK_WARNING]) });
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    expect(await screen.findByText(DARK_WARNING)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Página 1 de la factura" })).toBeInTheDocument();
    expect(postCount()).toBe(0);

    const click = jest.spyOn(screen.getByTestId("invoice-scan-file-input"), "click");
    await userEvent.click(screen.getByRole("button", { name: "Repetir foto" }));

    expect(click).toHaveBeenCalled();
    expect(screen.queryByText(DARK_WARNING)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Página 1 de la factura" })).not.toBeInTheDocument();
    expect(screen.getByTestId("invoice-scan-dropzone")).toBeInTheDocument();

    await selectFile();
    await userEvent.click(await screen.findByRole("button", { name: "Escanear igual" }));

    await waitFor(() => expect(handlers.onScanned).toHaveBeenCalledTimes(1));
    expect(postCount()).toBe(1);
  });

  it("un 409 dice que la factura está en curso y «Reintentar» vuelve a escanear", async () => {
    postResponses = [
      async () =>
        jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "Esta factura ya se está leyendo; espera unos segundos y vuelve a intentarlo.",
            },
          },
          409,
        ),
    ];
    const handlers = renderModal();
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta factura ya se está leyendo");
    expect(handlers.onScanned).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(handlers.onScanned).toHaveBeenCalledWith(scanResponse(3)));
    expect(postCount()).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un 429 muestra la cuota agotada, actualiza el contador y deshabilita escanear", async () => {
    postResponses = [
      async () =>
        jsonResponse(
          {
            error: {
              code: "INVOICE_SCAN_LIMIT_REACHED",
              details: { limit: 50, used: 50 },
              message: "Alcanzaste el límite de 50 páginas escaneadas por día.",
            },
          },
          429,
        ),
    ];
    renderModal();
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    expect(await screen.findByRole("alert")).toHaveTextContent("Alcanzaste el límite de 50 páginas");
    expect(screen.getByText("Escaneos hoy: 50 de 50")).toBeInTheDocument();
    expect(screen.getByText(INVOICE_SCAN_QUOTA_EXHAUSTED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Elegir otro archivo" })).toBeDisabled();
  });

  it("tras un 502 vuelve a pedir la cuota: el servidor ya contó el intento (SCN-07-F1)", async () => {
    postResponses = [
      async () => {
        limitsPayload = { limit: 50, remaining: 47, used: 3 };
        return jsonResponse(
          { error: { code: "INVOICE_SCAN_PROVIDER_ERROR", message: "El servicio de IA no está disponible." } },
          502,
        );
      },
    ];
    renderModal();
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    expect(await screen.findByRole("alert")).toHaveTextContent("El servicio de IA no está disponible.");
    expect(await screen.findByText("Escaneos hoy: 3 de 50")).toBeInTheDocument();
  });

  it("con el uso por encima del límite no muestra números incoherentes (SCN-07-F1)", async () => {
    limitsPayload = { limit: 5, remaining: 0, used: 32 };
    renderModal();

    expect(await screen.findByText(INVOICE_SCAN_QUOTA_EXHAUSTED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByTestId("invoice-scan-limits")).toHaveTextContent("Escaneos hoy: 5 de 5");
    expect(screen.queryByText(/32 de 5/)).not.toBeInTheDocument();
  });

  it("con la cuota del día agotada el botón de seleccionar está deshabilitado con su mensaje", async () => {
    limitsPayload = { limit: 50, remaining: 0, used: 50 };
    const prepareFile = jest.fn(async () => preparedInvoice());
    renderModal({ prepareFile });

    expect(await screen.findByText(INVOICE_SCAN_QUOTA_EXHAUSTED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar archivo" })).toBeDisabled();

    await act(async () => {
      fireEvent.drop(screen.getByTestId("invoice-scan-dropzone"), { dataTransfer: { files: [file] } });
    });
    expect(prepareFile).not.toHaveBeenCalled();
  });

  it("en curso avisa onBusyChange, no se cierra con Esc y «Cancelar escaneo» lo corta", async () => {
    postResponses = [
      () =>
        new Promise<Response>((_resolve, reject) => {
          const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    ];
    const handlers = renderModal();
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    await waitFor(() => expect(handlers.onBusyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByText("Subiendo la factura…")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(handlers.onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar escaneo" }));

    await waitFor(() => expect(handlers.onBusyChange).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(handlers.onScanned).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("un error de preparación se muestra en español con «Reintentar»", async () => {
    const prepareFile = jest
      .fn()
      .mockRejectedValueOnce(new Error("No se pudo leer el PDF de la factura."))
      .mockResolvedValueOnce(preparedInvoice());
    const handlers = renderModal({ prepareFile });
    await screen.findByText("Escaneos hoy: 2 de 50");

    await selectFile();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo leer el PDF de la factura.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(handlers.onScanned).toHaveBeenCalled());
    expect(prepareFile).toHaveBeenCalledTimes(2);
  });
});
