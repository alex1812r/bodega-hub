import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PurchaseInvoiceScan } from "../hooks/usePurchaseInvoiceScan";
import {
  formatInvoiceLinePack,
  PURCHASE_INVOICE_SCAN_EXPIRED_MESSAGE,
  PurchaseInvoiceScanSection,
} from "./PurchaseInvoiceScanSection";

const PURCHASE_ID = "purchase-9a";
const SUMMARY_URL = `/api/purchases/${PURCHASE_ID}/invoice-scan?images=0`;
const IMAGES_URL = `/api/purchases/${PURCHASE_ID}/invoice-scan`;
const SIGNED = "https://storage.local/sign/p1.jpg?token=t";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function scan(overrides: Partial<PurchaseInvoiceScan> = {}): PurchaseInvoiceScan {
  return {
    confirmedAt: "2026-10-10T12:00:00.000Z",
    createdAt: "2026-10-10T11:58:00.000Z",
    imageExpired: false,
    imageUrls: [],
    learned: 2,
    lines: [
      {
        lineIndex: 0,
        packLabel: "Bulto",
        productId: "p1",
        productName: "Harina PAN 1 kg",
        rawText: "HARINA PAN 1KG BULTO X20",
        unitsPerPack: 20,
      },
      { lineIndex: 1, productId: "p2", productName: null, rawText: "ACEITE DIANA 1L" },
    ],
    pages: 1,
    scanId: "scan-1",
    ...overrides,
  };
}

type Handler = (url: string) => Response | Promise<Response>;

function installFetch(handler: Handler) {
  const fetchMock = jest.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={client}>
        <PurchaseInvoiceScanSection purchaseId={PURCHASE_ID} />
      </QueryClientProvider>,
    ),
  };
}

function calledUrls(fetchMock: jest.Mock) {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

function withImages(url: string) {
  return url === SUMMARY_URL ? jsonResponse({ data: scan() }) : jsonResponse({ data: scan({ imageUrls: [SIGNED] }) });
}

describe("PurchaseInvoiceScanSection", () => {
  it("no aparece si la compra no tiene escaneo", async () => {
    const fetchMock = installFetch(() => jsonResponse({ data: null }));
    const { container } = renderSection();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("Factura escaneada")).not.toBeInTheDocument();
  });

  it("no aparece si la consulta falla", async () => {
    const fetchMock = installFetch(() =>
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500),
    );
    const { container } = renderSection();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("aparece cerrada con resumen, sin pedir URLs firmadas hasta abrirla", async () => {
    const fetchMock = installFetch(withImages);
    const { user } = renderSection();

    const toggle = await screen.findByRole("button", { name: /Factura escaneada/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("2 líneas aprendidas · 1 página")).toBeInTheDocument();
    expect(calledUrls(fetchMock)).toEqual([SUMMARY_URL]);

    await user.click(toggle);

    expect(await screen.findByRole("img", { name: "Factura escaneada de la compra" })).toHaveAttribute(
      "src",
      SIGNED,
    );
    expect(calledUrls(fetchMock)).toEqual([SUMMARY_URL, IMAGES_URL]);
  });

  it("lista las líneas aprendidas: texto de la factura → producto (empaque)", async () => {
    installFetch(withImages);
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Factura escaneada/ }));

    const list = screen.getByRole("list", { name: "Líneas aprendidas" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("HARINA PAN 1KG BULTO X20 → se aprendió como Harina PAN 1 kg (Bulto de 20)");
    expect(items[1]).toHaveTextContent("ACEITE DIANA 1L → se aprendió como Producto no disponible");
    expect(screen.getByRole("heading", { name: "Líneas aprendidas (2)" })).toBeInTheDocument();
  });

  it("muestra el estado de carga mientras llegan las imágenes", async () => {
    let release: (response: Response) => void = () => undefined;
    installFetch((url) =>
      url === SUMMARY_URL
        ? jsonResponse({ data: scan() })
        : new Promise<Response>((resolve) => {
            release = resolve;
          }),
    );
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Factura escaneada/ }));

    expect(await screen.findByText("Cargando la factura...")).toBeInTheDocument();
    release(jsonResponse({ data: scan({ imageUrls: [SIGNED] }) }));
    expect(await screen.findByRole("img", { name: "Factura escaneada de la compra" })).toBeInTheDocument();
  });

  it("si fallan las imágenes muestra el error, mantiene las líneas y reintenta", async () => {
    let attempts = 0;
    installFetch((url) => {
      if (url === SUMMARY_URL) {
        return jsonResponse({ data: scan() });
      }

      attempts += 1;
      return attempts === 1
        ? jsonResponse({ error: { code: "SERVICE_UNAVAILABLE", message: "Storage no responde." } }, 503)
        : jsonResponse({ data: scan({ imageUrls: [SIGNED] }) });
    });
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Factura escaneada/ }));

    expect(await screen.findByText("No pudimos cargar la imagen de la factura")).toBeInTheDocument();
    expect(screen.getByText("Storage no responde.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Líneas aprendidas" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("img", { name: "Factura escaneada de la compra" })).toBeInTheDocument();
  });

  it("con la imagen expirada avisa y no pide URLs firmadas", async () => {
    const fetchMock = installFetch(() => jsonResponse({ data: scan({ imageExpired: true }) }));
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Factura escaneada/ }));

    expect(screen.getByText(PURCHASE_INVOICE_SCAN_EXPIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(calledUrls(fetchMock)).toEqual([SUMMARY_URL]);
  });

  it("si al firmar la imagen ya no está, avisa que expiró", async () => {
    installFetch((url) =>
      url === SUMMARY_URL ? jsonResponse({ data: scan() }) : jsonResponse({ data: scan({ imageExpired: true }) }),
    );
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Factura escaneada/ }));

    expect(await screen.findByText(PURCHASE_INVOICE_SCAN_EXPIRED_MESSAGE)).toBeInTheDocument();
  });

  it("sin líneas aprendidas lo dice", async () => {
    installFetch(() => jsonResponse({ data: scan({ imageExpired: true, learned: 0, lines: [] }) }));
    const { user } = renderSection();

    await user.click(await screen.findByRole("button", { name: /Factura escaneada/ }));

    expect(screen.getByText("No se aprendió ninguna línea de esta factura.")).toBeInTheDocument();
  });
});

describe("formatInvoiceLinePack", () => {
  it("combina etiqueta y unidades, o usa la que haya", () => {
    expect(formatInvoiceLinePack({ packLabel: "Caja", unitsPerPack: 12 })).toBe("Caja de 12");
    expect(formatInvoiceLinePack({ packLabel: "Caja" })).toBe("Caja");
    expect(formatInvoiceLinePack({ unitsPerPack: 6 })).toBe("empaque de 6");
    expect(formatInvoiceLinePack({})).toBeNull();
  });
});
