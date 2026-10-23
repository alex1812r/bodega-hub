/**
 * REP9-02 · D42 en el panel: el costo desviado de ESE producto se ve en la opción (ámbar y
 * «(último X)») sin aviso del servidor, se reconoce eligiendo la opción (clic o teclado, D39: las
 * flechas nunca eligen), sin último costo se dice «sin costo previo», el buscador no avanza el
 * foco (D39-6) y el pie cuenta la línea como pendiente.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceLineMatch, InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import type { ProductEntityOption } from "@/shared/components/EntityAutocomplete";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { InvoiceReviewPanel, type InvoiceReviewPanelProps } from "./InvoiceReviewPanel";

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({
    data: id ? { id, name: "Chevere Depot C.A." } : undefined,
    error: null,
    isPending: false,
  }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({ error: null, isLoading: false, refetch: jest.fn(), urls: ["https://s/1.jpg"] }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

jest.mock("../../components/PurchaseNewProductModal", () => ({
  PurchaseNewProductModal: () => null,
}));

const CONTEXT: InvoiceReviewContext = { systemRateVes: 900, taxRates: REVIEW_TAX_RATES };
const HARINA = productUuid(1);

/** C9-M1 A: «CAOSG Harina Maiz 1kg» por nombre, sin aviso; 4.500 Bs ÷ 900 = 5,00 frente a 0,50. */
function harinaByName(match: Partial<InvoiceLineMatch> = {}, unitPrice = 4500): ReviewFixtureLine {
  return {
    read: {
      rawText: "CAOSG Harina Maiz 1kg P3 1 4.500,00 4.500,00",
      description: "CAOSG Harina Maiz 1kg",
      unit: "unidad",
      quantity: 1,
      unitPrice,
      lineTotal: unitPrice,
    },
    match: {
      status: "doubtful",
      productId: undefined,
      taxRateCode: "exento",
      candidates: [
        { productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00", lastUnitCostRef: 0.5 },
      ],
      lastUnitCostRef: 0.5,
      issues: [],
      ...match,
    },
  };
}

/** Caja x6 sin último costo en el candidato. */
function cajaSinCosto(): ReviewFixtureLine {
  return {
    read: { rawText: "GALLETA CAJA X6", description: "Galleta caja x6", unit: "caja", unitsPerPack: 6, quantity: 1, unitPrice: 2700, lineTotal: 2700 },
    match: {
      status: "doubtful",
      productId: undefined,
      entryMode: "pack",
      unitsPerPack: 6,
      taxRateCode: "exento",
      candidates: [{ productId: productUuid(2), name: "Galleta María", score: 0.9, reason: "nombre parecido 0,90" }],
      issues: [],
    },
  };
}

let now = 1_000_000;
let dateNow: jest.SpyInstance;

beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  dateNow.mockRestore();
});

/** Pasa la guarda de activación (400 ms) del último cambio de foco: pulsación deliberada. */
function later() {
  now += 1000;
}

function renderPanel(response: InvoiceScanResponse, overrides: Partial<InvoiceReviewPanelProps> = {}) {
  const props: InvoiceReviewPanelProps = {
    context: CONTEXT,
    onDiscard: jest.fn(),
    onLoad: jest.fn(),
    onRescan: jest.fn(),
    response,
    ...overrides,
  };
  render(<InvoiceReviewPanel {...props} />);
  return props;
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

const option = (index: number, name: string) => within(row(index)).getByRole("button", { name });
const loadButton = () => screen.getByRole("button", { name: "Cargar en la compra" });
const blockers = () => screen.getByTestId("invoice-review-blockers");

function productOption(id: string, label: string): ProductEntityOption {
  return { barcode: null, categoryId: "cat-1", currentCostRef: 1, currentStock: 3, id, isActive: true, label, salePriceRef: 2, sku: "SKU-1" };
}

describe("REP9-02 · el costo desviado se ve en la opción sin aviso del servidor", () => {
  it("línea por nombre sin avisos: «Por unidad» sale en ámbar con «(último 0,50)» antes de pulsar nada", () => {
    renderPanel(makeReviewResponse({ lines: [harinaByName()] }));

    const unit = option(0, "Por unidad");
    expect(unit).toHaveAttribute("data-deviates", "true");
    expect(unit).toHaveTextContent("5,00 REF/u (último 0,50)");
    expect(unit).toHaveAttribute("aria-pressed", "false");
  });

  it("sin último costo conocido: la opción dice «sin costo previo» y no se marca en ámbar", () => {
    renderPanel(makeReviewResponse({ lines: [cajaSinCosto()] }));

    expect(option(0, "Por caja")).toHaveTextContent("sin costo previo");
    expect(option(0, "Por caja")).not.toHaveAttribute("data-deviates");
  });

  it("sin último costo y sin opción de empaque: la fila dice «sin costo previo»", () => {
    renderPanel(
      makeReviewResponse({
        lines: [
          harinaByName({
            lastUnitCostRef: undefined,
            candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "nombre parecido 1,00" }],
          }),
        ],
      }),
    );

    expect(row(0)).toHaveTextContent(/sin costo previo/i);
  });
});

describe("REP9-02 · reconocer el costo desviado", () => {
  it("Enter no la resuelve; el pie la cuenta como pendiente con su motivo; el clic en la opción la reconoce", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [harinaByName()] }));
    await waitFor(() => expect(row(0)).toHaveFocus());

    later();
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(screen.getByText("1 línea pendiente")).toBeInTheDocument();
    expect(blockers()).toHaveTextContent("Falta confirmar el costo en 1 línea.");
    expect(loadButton()).toBeDisabled();

    later();
    await user.click(option(0, "Por unidad"));

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(option(0, "Por unidad")).toHaveAttribute("aria-pressed", "true");
    expect(option(0, "Por unidad")).toHaveAttribute("data-deviates", "true");
    expect(screen.queryByText("Falta confirmar el costo en 1 línea.")).not.toBeInTheDocument();
    expect(loadButton()).toBeEnabled();
  });

  it("6.17 solo con teclado: Enter, Tab a la opción, las flechas no eligen, Enter reconoce y el foco queda en la fila", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [harinaByName(), harinaByName({}, 450)] }));
    await waitFor(() => expect(row(0)).toHaveFocus());

    later();
    await user.keyboard("{Enter}");
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    await waitFor(() => expect(row(0)).toHaveFocus());

    later();
    await user.tab();
    expect(option(0, "Por unidad")).toHaveFocus();

    await user.keyboard("{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}");
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

    later();
    option(0, "Por unidad").focus();
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(row(1)).not.toHaveFocus();
  });
});

describe("REP9-02 · C9-M1 C: confirmada por SKU cambiada a «Por unidad» desviada", () => {
  it("sale del grupo de confirmadas y el foco va a su fila, nunca a BODY", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          {
            read: { rawText: "CG-GALLETA GALLETA MARIA CAJA X6", description: "GALLETA MARIA CAJA X6", unit: "caja", unitsPerPack: 6, quantity: 1, unitPrice: 270, lineTotal: 270 },
            match: {
              status: "confirmed",
              productId: productUuid(2),
              entryMode: "pack",
              unitsPerPack: 6,
              taxRateCode: "exento",
              candidates: [{ productId: productUuid(2), name: "Galleta María", score: 1, reason: "SKU del proveedor", lastUnitCostRef: 0.05 }],
              lastUnitCostRef: 0.05,
            },
          },
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: /1 línea confirmada · ver/ }));
    expect(option(0, "Por unidad")).toHaveAttribute("data-deviates", "true");

    later();
    await user.click(option(0, "Por unidad"));

    expect(row(0)).not.toHaveAttribute("data-status", "confirmed_by_match");
    expect(within(screen.getByRole("list", { name: "Líneas por revisar" })).getByText("Galleta María")).toBeInTheDocument();
    await waitFor(() => expect(row(0)).toHaveFocus());
  });
});

describe("REP9-02 · buscador: último costo de ESE producto y foco en la fila (D39-6)", () => {
  async function pickFromSearch(fetchLastCost: jest.Mock) {
    const user = userEvent.setup();
    const fetcher = jest.fn(async () => [productOption(productUuid(500), "Harina buscada")]);
    renderPanel(makeReviewResponse({ lines: [harinaByName(), harinaByName({}, 450)] }), {
      productFetcher: fetcher,
      lastUnitCostFetcher: fetchLastCost,
    });
    await waitFor(() => expect(row(0)).toHaveFocus());
    later();
    await user.tab();
    const options = await screen.findAllByRole("option");
    const searched = options.find((item) => item.textContent?.includes("Harina buscada"));
    if (!searched) {
      throw new Error("Sin opción buscada");
    }
    later();
    await user.click(searched);
    return user;
  }

  it("con costo coherente: se consulta una vez solo con ids, queda resuelta y el foco sigue en su fila", async () => {
    const fetchLastCost = jest.fn(async () => 5);
    await pickFromSearch(fetchLastCost);

    await waitFor(() => expect(row(0)).toHaveAttribute("data-status", "resolved"));
    expect(fetchLastCost).toHaveBeenCalledTimes(1);
    expect(fetchLastCost).toHaveBeenCalledWith(productUuid(500), expect.any(String));
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(row(1)).not.toHaveFocus();
  });

  it("mientras se consulta la línea sigue pendiente y lo dice", async () => {
    let settle: (value: number | null) => void = () => undefined;
    const fetchLastCost = jest.fn(() => new Promise<number | null>((resolve) => (settle = resolve)));
    await pickFromSearch(fetchLastCost);

    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(row(0)).toHaveTextContent("Consultando el costo previo");
    settle(null);
    await waitFor(() => expect(row(0)).toHaveAttribute("data-status", "resolved"));
    expect(row(0)).toHaveTextContent(/sin costo previo/i);
  });

  it("con costo desviado (0,50): pide reconocerlo con la opción en ámbar", async () => {
    const user = await pickFromSearch(jest.fn(async () => 0.5));

    await waitFor(() => expect(option(0, "Por unidad")).toHaveAttribute("data-deviates", "true"));
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(option(0, "Por unidad")).toHaveTextContent("(último 0,50)");

    later();
    await user.click(option(0, "Por unidad"));
    expect(row(0)).toHaveAttribute("data-status", "resolved");
  });

  it("si la consulta falla lo dice y exige reconocer el costo", async () => {
    const user = await pickFromSearch(jest.fn(async () => Promise.reject(new Error("red"))));

    await waitFor(() => expect(row(0)).toHaveTextContent("No se pudo consultar el costo previo"));
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

    later();
    await user.click(option(0, "Por unidad"));
    expect(row(0)).toHaveAttribute("data-status", "resolved");
  });
});

describe("REP9-02 · editar una confirmada no la cambia de lista bajo el teclado", () => {
  /** Confirmada por alias: 450 Bs ÷ 900 = 0,50 REF/u, igual al último costo. */
  function harinaConfirmada(entry: Partial<ReviewFixtureLine["read"]> = {}): ReviewFixtureLine {
    const pack = entry.unitsPerPack !== undefined;
    return {
      read: {
        rawText: "CAOSG Harina Maiz 1kg 1 450,00 450,00",
        description: "CAOSG Harina Maiz 1kg",
        unit: pack ? "caja" : "unidad",
        quantity: 1,
        unitPrice: 450,
        lineTotal: 450,
        ...entry,
      },
      match: {
        status: "confirmed",
        productId: HARINA,
        taxRateCode: "exento",
        ...(pack ? { entryMode: "pack" as const, unitsPerPack: entry.unitsPerPack } : {}),
        candidates: [{ productId: HARINA, name: "CAOSG Harina Maiz 1kg", score: 1, reason: "alias", lastUnitCostRef: pack ? 0.5 / (entry.unitsPerPack ?? 1) : 0.5 }],
        lastUnitCostRef: pack ? 0.5 / (entry.unitsPerPack ?? 1) : 0.5,
      },
    };
  }

  const confirmedList = () => screen.getByRole("list", { name: "Líneas confirmadas" });
  const reviewList = () => screen.queryByRole("list", { name: "Líneas por revisar" });
  const field = (label: RegExp) => within(row(0)).getByLabelText(label);

  async function openConfirmed(lines: ReviewFixtureLine[]) {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines }));
    await user.click(screen.getByRole("button", { name: /1 línea confirmada · ver/ }));
    expect(confirmedList()).toContainElement(row(0));
    return user;
  }

  it("costo tecleado carácter a carácter: el foco y el valor siguen en el campo; al salir pasa a «por revisar» en ámbar y el pie la cuenta", async () => {
    const user = await openConfirmed([harinaConfirmada()]);
    const cost = field(/^Costo/);

    await user.clear(cost);
    expect(cost).toHaveFocus();
    // D42 no se relaja: desde la primera tecla que la desvía, pendiente aunque la fila no se mueva.
    await user.type(cost, "4");
    expect(cost).toHaveFocus();
    expect(screen.getByText(/^1 línea pendiente/)).toBeInTheDocument();
    expect(blockers()).toHaveTextContent("Falta confirmar el costo en 1 línea.");
    expect(loadButton()).toBeDisabled();
    await user.type(cost, "500");

    expect(document.activeElement).toBe(cost);
    expect(cost).toHaveValue("4500");
    expect(confirmedList()).toContainElement(row(0));
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

    later();
    await user.click(screen.getByRole("heading", { name: "Revisión de la factura" }));

    expect(reviewList()).toContainElement(row(0));
    expect(option(0, "Por unidad")).toHaveAttribute("data-deviates", "true");
    expect(blockers()).toHaveTextContent("Falta confirmar el costo en 1 línea.");
    expect(screen.getByText(/^1 línea pendiente/)).toBeInTheDocument();
    await waitFor(() => expect(row(0)).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("cantidad tecleada carácter a carácter: el foco y el valor siguen en el campo; vacía cuenta como pendiente; coherente no salta de lista", async () => {
    const user = await openConfirmed([harinaConfirmada()]);
    const quantity = field(/^Cantidad/);

    await user.clear(quantity);
    expect(quantity).toHaveFocus();
    expect(screen.getByText(/^1 línea pendiente/)).toBeInTheDocument();
    await user.type(quantity, "12");

    expect(document.activeElement).toBe(quantity);
    expect(quantity).toHaveValue("12");
    expect(confirmedList()).toContainElement(row(0));

    later();
    await user.click(screen.getByRole("heading", { name: "Revisión de la factura" }));

    expect(confirmedList()).toContainElement(row(0));
    expect(row(0)).toHaveAttribute("data-status", "confirmed_by_match");
  });

  it("unidades por empaque hasta desviarse: el foco sigue en el campo; al salir pasa a «por revisar» en ámbar y el pie la cuenta", async () => {
    const user = await openConfirmed([harinaConfirmada({ unitsPerPack: 6 })]);
    const units = field(/^Unidades por/);

    await user.clear(units);
    await user.type(units, "60");

    expect(document.activeElement).toBe(units);
    expect(units).toHaveValue("60");
    expect(confirmedList()).toContainElement(row(0));
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");

    later();
    await user.click(screen.getByRole("heading", { name: "Revisión de la factura" }));

    expect(reviewList()).toContainElement(row(0));
    expect(option(0, "Por caja")).toHaveAttribute("data-deviates", "true");
    expect(blockers()).toHaveTextContent("Falta confirmar el costo en 1 línea.");
    await waitFor(() => expect(row(0)).toHaveFocus());
  });
});
