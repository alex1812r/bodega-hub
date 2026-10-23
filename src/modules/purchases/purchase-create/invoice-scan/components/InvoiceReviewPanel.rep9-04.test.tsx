/**
 * REP9-04 · B-r9-1 (QA p9, D43). Repro f04 real (390 táctil): tras «Cargar como 6 unidades» la
 * opción «Por bulto» (6 bultos = 72 u a 0,31 REF/u, último 3,83) quedaba bajo el dedo y un 2.º
 * toque a 600 ms la elegía Y reconocía su costo: entraban 12× las unidades.
 * Elegir la opción desviada nunca reconoce el costo; el reconocimiento es un botón aparte
 * («Sí, el costo es…») con la misma guarda y filtros de activación.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";

import type { InvoiceReviewContext } from "../reviewModel";
import { makeReviewResponse, productUuid, REVIEW_TAX_RATES, type ReviewFixtureLine } from "../reviewFixtures";
import { InvoiceReviewPanel } from "./InvoiceReviewPanel";

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
const MAYONESA = productUuid(46);
const HARINA = productUuid(1);
const ACK_PACK = "Sí, el costo es 0,31 REF/u (último 3,83)";

/** f04 L0 real: 0,50 a 40.675,41 Bs (exento), último 3,83 REF. */
const mayonesaLine = (): ReviewFixtureLine => ({
  read: {
    rawText: "001 MAYONESA MAVESA 445GR 0,50 x40,675.41 (E) #46.50 20337.71",
    description: "MAYONESA MAVESA 445GR",
    unit: "unidad",
    quantity: 0.5,
    unitPrice: 40675.41,
    lineTotal: 20337.71,
  },
  match: {
    status: "doubtful",
    productId: MAYONESA,
    entryMode: "unit",
    taxRateCode: "exento",
    candidates: [
      { productId: MAYONESA, name: "Mayonesa Mavesa 445g", score: 0.8, reason: "nombre parecido", lastUnitCostRef: 3.83 },
    ],
    lastUnitCostRef: 3.83,
    // El servidor avisa del precio (f04 real): la opción se elige (D31).
    issues: ["¿Precio por caja o por unidad? Sale a 45,19 REF por unidad y el último costo fue 3,83 REF."],
  },
});

/** C9-M1 A: por nombre, sin aviso del servidor; 4.500 Bs ÷ 900 = 5,00 REF/u frente a 0,50. */
const harinaLine = (): ReviewFixtureLine => ({
  read: {
    rawText: "CAOSG Harina Maiz 1kg P3 1 4.500,00 4.500,00",
    description: "CAOSG Harina Maiz 1kg",
    unit: "unidad",
    quantity: 1,
    unitPrice: 4500,
    lineTotal: 4500,
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
  },
});

let now = 1_000_000;
let dateNow: jest.SpyInstance;

beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  dateNow.mockRestore();
});

function renderPanel(response: InvoiceScanResponse) {
  render(
    <InvoiceReviewPanel context={CONTEXT} onDiscard={jest.fn()} onLoad={jest.fn()} onRescan={jest.fn()} response={response} />,
  );
}

function row(index: number) {
  const element = document.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

const option = (name: string) => within(row(0)).getByRole("button", { name });
const ackButton = () => within(row(0)).queryByRole("button", { name: /^Sí, el costo es/ });

/** Pulsación nueva pasada la guarda de activación (400 ms): el 2.º toque del repro, a 600 ms. */
function after(ms: number) {
  now += ms;
}

/** Paso 1 del repro: chip, «Por bulto», 12 por bulto y «Cargar como 6 unidades». */
async function convertToUnits(user: ReturnType<typeof userEvent.setup>) {
  renderPanel(makeReviewResponse({ lines: [mayonesaLine()] }));
  after(1000);
  await user.click(within(row(0)).getByRole("button", { name: /^Mayonesa Mavesa 445g/ }));
  after(1000);
  await user.click(option("Por bulto"));
  await user.type(within(row(0)).getByLabelText(/^Unidades por/), "12");
  after(1000);
  await user.click(within(row(0)).getByRole("button", { name: "Cargar como 6 unidades" }));
  expect(row(0)).toHaveAttribute("data-status", "resolved");
}

describe("REP9-04 · B-r9-1: elegir la opción desviada no reconoce su costo", () => {
  it("repro f04: 2.º toque a 600 ms sobre «Por bulto» la elige pero la línea queda sin reconocer", async () => {
    const user = userEvent.setup();
    await convertToUnits(user);

    after(600);
    await user.click(option("Por bulto"));

    expect(option("Por bulto")).toHaveAttribute("aria-pressed", "true");
    expect(row(0)).not.toHaveAttribute("data-status", "resolved");
    expect(ackButton()).toHaveTextContent(ACK_PACK);
  });

  it("resuelta con «Cargar como», la fila conserva sus candidatos: la opción no sube al sitio del botón pulsado", async () => {
    const user = userEvent.setup();
    await convertToUnits(user);

    const chip = within(row(0)).getByRole("button", { name: /^Mayonesa Mavesa 445g/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("el botón «Sí, el costo es…» reconoce el costo y la línea queda resuelta; lo sustituye la confirmación", async () => {
    const user = userEvent.setup();
    await convertToUnits(user);
    after(600);
    await user.click(option("Por bulto"));

    after(1000);
    await user.click(ackButton() as HTMLElement);

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    expect(ackButton()).toBeNull();
    expect(within(row(0)).getByTestId("invoice-review-cost-acknowledged")).toHaveTextContent(
      "Costo confirmado: 0,31 REF/u (último 3,83)",
    );
    await waitFor(() => expect(row(0)).toHaveFocus());
  });

  it("el botón respeta la guarda: pulsado a 300 ms de elegir la opción no reconoce", async () => {
    const user = userEvent.setup();
    await convertToUnits(user);
    after(600);
    await user.click(option("Por bulto"));

    after(300);
    await user.click(ackButton() as HTMLElement);

    expect(row(0)).not.toHaveAttribute("data-status", "resolved");
    expect(ackButton()).toBeInTheDocument();
  });

  it("el 2.º clic de un doble clic (detail > 1) sobre el botón no reconoce", async () => {
    const user = userEvent.setup();
    await convertToUnits(user);
    after(600);
    await user.click(option("Por bulto"));

    after(1000);
    fireEvent.click(ackButton() as HTMLElement, { detail: 2 });

    expect(row(0)).not.toHaveAttribute("data-status", "resolved");
  });

  it("6.17 solo teclado: Enter acepta, Tab a la opción, Enter la elige, Tab al botón y Enter reconoce", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [harinaLine()] }));
    await waitFor(() => expect(row(0)).toHaveFocus());

    after(1000);
    await user.keyboard("{Enter}");
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    expect(ackButton()).toBeNull();

    await user.keyboard("{Tab}");
    expect(option("Por unidad")).toHaveFocus();
    after(1000);
    await user.keyboard("{Enter}");
    expect(option("Por unidad")).toHaveAttribute("aria-pressed", "true");
    expect(row(0)).toHaveAttribute("data-status", "pending_doubtful");
    await waitFor(() => expect(row(0)).toHaveFocus());

    await user.keyboard("{Tab}");
    expect(ackButton()).toHaveFocus();
    expect(ackButton()).toHaveTextContent("Sí, el costo es 5,00 REF/u (último 0,50)");
    after(1000);
    await user.keyboard("{Enter}");

    expect(row(0)).toHaveAttribute("data-status", "resolved");
  });
});
