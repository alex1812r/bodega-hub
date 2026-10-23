/**
 * REP7-05 · QA pasada 7.
 * B-p7-1: un botón que desaparece al pulsarse («Cargar como N unidades», «Sí, la factura está
 * en dólares», proveedor sugerido) dejaba el foco en BODY. D36: va a un contenedor neutro (la
 * fila si sigue pendiente, la siguiente pendiente o el pie), nunca a un control que decide.
 * B-p7-3: en la línea con aviso de precio o de empaque, cada opción dice antes de elegir qué
 * entra al stock y a qué costo por unidad, y marca (con texto, no solo color) la que deja el
 * costo desviado más de un 40 % del último.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { InvoiceScanResponse } from "@/modules/invoice-scan/contracts";
import { priceCoherenceIssue } from "@/modules/invoice-scan/server/match/money";

import f04 from "../__fixtures__/scan-f04.json";
import type { InvoiceReviewContext } from "../reviewModel";
import {
  doubtfulLine,
  makeReviewResponse,
  productUuid,
  REVIEW_TAX_RATES,
} from "../reviewFixtures";
import {
  InvoiceReviewPanel,
  type InvoiceReviewPanelProps,
} from "./InvoiceReviewPanel";

jest.mock("../../../hooks/usePurchaseSuppliers", () => ({
  fetchPurchaseSupplierOptions: jest.fn(async () => []),
  usePurchaseSupplier: (id?: string) => ({
    data: id ? { id, name: "Chevere Depot C.A." } : undefined,
    error: null,
    isPending: false,
  }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanImages", () => ({
  useInvoiceScanImages: () => ({
    error: null,
    isLoading: false,
    refetch: jest.fn(),
    urls: ["https://s/1.jpg"],
  }),
}));

jest.mock("../../../../invoice-scan/client/useInvoiceScanPurchase", () => ({
  useInvoiceScanPurchase: () => ({ purchaseId: null }),
}));

jest.mock("../../components/PurchaseNewProductModal", () => ({
  PurchaseNewProductModal: () => null,
}));

const F04_CONTEXT: InvoiceReviewContext = {
  systemRateVes: 880.1159,
  taxRates: REVIEW_TAX_RATES,
};

/** Controles que deciden o destruyen (D36): el foco solo llega a ellos por el usuario. */
const DECIDING_SELECTOR = [
  "[data-choice]",
  "[data-load-button]",
  'input[type="checkbox"]',
  '[data-testid="invoice-review-discard-scan"]',
].join(", ");

let now = 1_000_000;
let dateNow: jest.SpyInstance;

beforeEach(() => {
  now = 1_000_000;
  dateNow = jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  dateNow.mockRestore();
});

function renderPanel(
  response: InvoiceScanResponse,
  overrides: Partial<InvoiceReviewPanelProps> = {},
) {
  const props: InvoiceReviewPanelProps = {
    context: { systemRateVes: 880, taxRates: REVIEW_TAX_RATES },
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
  const element = document.querySelector<HTMLElement>(
    `[data-line-index="${index}"]`,
  );
  if (!element) {
    throw new Error(`Sin fila para la línea ${index}`);
  }
  return element;
}

/** El foco quedó en un contenedor neutro: ni BODY ni un control que decide. */
function expectNeutralFocus() {
  const focused = document.activeElement;
  expect(focused).not.toBe(document.body);
  expect(focused?.matches(DECIDING_SELECTOR)).toBe(false);
}

type User = ReturnType<typeof userEvent.setup>;

/** Media caja de f04: «Por bulto» + 12 y Enter sobre «Cargar como 6 unidades» (como la QA). */
async function convertWithEnter(user: User, line: HTMLElement) {
  now += 1000;
  await user.click(within(line).getByRole("button", { name: "Por bulto" }));
  await user.type(within(line).getByLabelText("Unidades por bulto"), "12");
  const convert = within(line).getByRole("button", {
    name: "Cargar como 6 unidades",
  });
  convert.focus();
  now += 1000;
  await user.keyboard("{Enter}");
}

describe("REP7-05 · B-p7-1: el foco no cae en BODY cuando desaparece el control pulsado", () => {
  it("f04 (L1, sin producto): Enter en «Cargar como 6 unidades» deja el foco en su fila, que sigue pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(f04 as unknown as InvoiceScanResponse, {
      context: F04_CONTEXT,
    });

    await convertWithEnter(user, row(1));

    expect(within(row(1)).getByLabelText("Cantidad")).toHaveValue("6");
    expect(row(1)).toHaveAttribute("data-status", "pending_unmatched");
    await waitFor(() => expect(row(1)).toHaveFocus());
    expectNeutralFocus();
  });

  // D41-c (B-p9-1): la conversión que resuelve sigue D39-6; el foco queda en su fila.
  it("f04 (L0 aceptada): la conversión la resuelve y el foco queda en su fila", async () => {
    const user = userEvent.setup();
    renderPanel(f04 as unknown as InvoiceScanResponse, {
      context: F04_CONTEXT,
    });
    now += 1000;
    row(0).focus();
    await user.keyboard("{Enter}");

    await convertWithEnter(user, row(0));

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expectNeutralFocus();
  });

  it("última pendiente convertida: el foco queda en su fila (contenedor), no en Cargar", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [
          doubtfulLine(1, 1, {
            read: { quantity: 0.5, unitPrice: 41474.74, lineTotal: 20737.37 },
          }),
        ],
      }),
    );
    await waitFor(() => expect(row(0)).toHaveFocus());
    now += 1000;
    await user.keyboard("{Enter}");

    await convertWithEnter(user, row(0));

    expect(row(0)).toHaveAttribute("data-status", "resolved");
    await waitFor(() => expect(row(0)).toHaveFocus());
    expectNeutralFocus();
  });

  it("«Sí, la factura está en dólares»: el aviso se sustituye y el foco va a la primera pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [doubtfulLine(1)],
        extraction: { currency: "USD" },
      }),
    );
    const accept = screen.getByRole("button", {
      name: "Sí, la factura está en dólares",
    });
    accept.focus();
    now += 1000;
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("button", { name: "Sí, la factura está en dólares" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(row(0)).toHaveFocus());
    expectNeutralFocus();
  });

  it("proveedor sugerido elegido con teclado: los chips desaparecen y el foco va a la primera pendiente", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeReviewResponse({
        lines: [doubtfulLine(1)],
        matched: {
          supplier: {
            candidates: [
              {
                contactId: productUuid(77),
                name: "Mercaseu C.A.",
                score: 0.8,
                reason: "nombre parecido",
              },
            ],
          },
        },
      }),
    );
    const suggested = screen.getByRole("button", { name: /Mercaseu C\.A\./ });
    suggested.focus();
    now += 1000;
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("group", { name: "Proveedores sugeridos" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(row(0)).toHaveFocus());
    expectNeutralFocus();
  });
});

/** f05 Mercaseu, 1.ª lectura: 6 a 523,36 por unidad con `[CAJA X 6.0]`; último costo 0,59 REF. */
const F05_READ = {
  rawText: "REFRESCO GLUP SABOR 2LT [CAJA X 6.0]",
  description: "REFRESCO GLUP SABOR 2LT",
  unit: "caja" as const,
  unitsPerPack: 6,
  quantity: 6,
  unitPrice: 523.36,
  lineTotal: 3140.16,
  confidence: 0.95,
};
const F05_ISSUE = priceCoherenceIssue({
  line: F05_READ,
  unitsPerPack: 6,
  entryMode: "pack",
  rate: 880,
  lastUnitCostRef: 0.59,
});

const f05Line = () =>
  doubtfulLine(2, 1, {
    read: F05_READ,
    match: {
      entryMode: "pack",
      unitsPerPack: 6,
      candidates: [
        {
          productId: productUuid(2),
          name: "Glup Sabores 2 Lt",
          score: 1,
          reason: "alias visto 1 vez",
        },
      ],
      issues: [F05_ISSUE as string],
    },
  });

function option(line: HTMLElement, name: string) {
  return within(line).getByRole("button", { name });
}

describe("REP7-05 · B-p7-3: cada opción dice qué da antes de elegir", () => {
  it("f05: el aviso del servidor es el de la QA (0,10 frente a 0,59)", () => {
    expect(F05_ISSUE).toBe(
      "¿Precio por caja o por unidad? Sale a 0,10 REF por unidad y el último costo fue 0,59 REF.",
    );
  });

  it("f05: «Por caja» da 36 u a 0,10 REF/u y se marca desviada; «Por unidad» da 6 u a 0,59 REF/u", () => {
    renderPanel(makeReviewResponse({ lines: [f05Line()] }));
    const perPack = option(row(0), "Por caja");
    const perUnit = option(row(0), "Por unidad");

    expect(perPack).toHaveAccessibleDescription(
      "6 cajas = 36 u · 0,10 REF/u (último 0,59) Se aparta más del 40 % del último costo",
    );
    expect(perPack).toHaveTextContent(
      "6 cajas = 36 u · 0,10 REF/u (último 0,59)",
    );
    expect(perPack).toHaveTextContent(
      "Se aparta más del 40 % del último costo",
    );
    expect(perPack).toHaveAttribute("data-deviates", "true");

    expect(perUnit).toHaveAccessibleDescription("6 u · 0,59 REF/u");
    expect(perUnit).not.toHaveAttribute("data-deviates");
    expect(perUnit).not.toHaveTextContent(/Se aparta/);
    // Nada viene elegido (D33-a): mostrar el resultado no es elegir.
    expect(
      [perUnit, perPack].map((option) => option.getAttribute("aria-pressed")),
    ).toEqual(["false", "false"]);
  });

  it("f04 (Cheese Tris, empaque leído «otro» = bulto): «Por bulto» da 12 u a 0,61 REF/u y «Por unidad» 1 u a 7,28 REF/u; sin último costo no se marca ninguna", () => {
    renderPanel(f04 as unknown as InvoiceScanResponse, {
      context: F04_CONTEXT,
    });
    const perPack = option(row(4), "Por bulto");
    const perUnit = option(row(4), "Por unidad");

    expect(perPack).toHaveAccessibleDescription("1 bulto = 12 u · 0,61 REF/u");
    expect(perUnit).toHaveAccessibleDescription("1 u · 7,28 REF/u");
    expect(perPack).not.toHaveAttribute("data-deviates");
    expect(perUnit).not.toHaveAttribute("data-deviates");
  });

  it("f04: las líneas sin aviso de elección (media caja) no cambian sus opciones", () => {
    renderPanel(f04 as unknown as InvoiceScanResponse, {
      context: F04_CONTEXT,
    });

    expect(option(row(0), "Por bulto")).not.toHaveAccessibleDescription();
  });

  it("el resultado sigue al empaque escrito: sin unidades por caja lo pide", async () => {
    const user = userEvent.setup();
    renderPanel(makeReviewResponse({ lines: [f05Line()] }));
    const units = within(row(0)).getByLabelText("Unidades por caja");

    await user.clear(units);
    expect(option(row(0), "Por caja")).toHaveAccessibleDescription(
      "6 cajas · indica las unidades por caja",
    );
    await user.type(units, "12");
    expect(option(row(0), "Por caja")).toHaveAccessibleDescription(
      "6 cajas = 72 u · 0,05 REF/u (último 0,59) Se aparta más del 40 % del último costo",
    );
  });
});
