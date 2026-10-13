import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  createQueryWrapper,
  jsonResponse,
} from "@/modules/inventory/utils/requestAttempt.testUtils";
import { DEFAULT_MARGIN_THRESHOLDS } from "@/shared/utils/pricing";

import { createPackDraftItem, createUnitDraftItem, type PurchaseDraftItem, type PurchaseWebLine } from "../types";
import {
  buildPurchaseConfirmEffect,
  type PurchaseConfirmFacts,
  type PurchaseConfirmInput,
} from "../utils/purchaseConfirmEffect";
import {
  fetchPurchaseConfirmFacts,
  PurchaseConfirmModal,
  PurchaseConfirmModalView,
  type PurchaseConfirmModalViewProps,
} from "./PurchaseConfirmModal";

const RATE = 510;

function webLine(item: PurchaseDraftItem, disassemble?: boolean): PurchaseWebLine {
  return {
    changes: [],
    ...(disassemble === undefined ? {} : { disassemble }),
    edited: false,
    editedMark: false,
    item,
    locked: false,
    tax: { categoryCode: null, code: "x", label: "X", manual: false, rate: item.taxRate },
  };
}

function unitLine(productId: string, quantity: number, unitCostRef: number, taxRate = 0) {
  return webLine(
    createUnitDraftItem({
      costCurrency: "ref",
      id: `line-${productId}`,
      productId,
      quantity,
      rateVes: RATE,
      taxRate,
      unitCostRef,
    }),
  );
}

const packLine = webLine(
  createPackDraftItem({
    costCurrency: "ref",
    id: "line-refresco",
    packCostRef: 12,
    packCount: 2,
    packLabel: "Caja",
    productId: "prod-refresco",
    rateVes: RATE,
    taxRate: 16,
    unitsPerPack: 12,
  }),
);

const NAMES: Record<string, string> = {
  "prod-cable": "Cable HDMI",
  "prod-harina": "Harina PAN",
  "prod-refresco": "Refresco Cola",
  "prod-surtido": "Caja surtida",
};

const facts: PurchaseConfirmFacts = {
  products: new Map([
    // Precio 2,00: con el costo nuevo (1,70) la ganancia baja de 100 % a 17,65 %.
    ["prod-cable", { currentCostRef: 1, link: "none", salePriceRef: 2 }],
    ["prod-harina", { currentCostRef: 1.16, link: "active", salePriceRef: 3 }],
    ["prod-refresco", { currentCostRef: 1, link: "active", salePriceRef: 3 }],
  ]),
  thresholds: DEFAULT_MARGIN_THRESHOLDS,
};

const baseInput: PurchaseConfirmInput = {
  discountRef: 0,
  facts,
  getProductName: (productId) => NAMES[productId] ?? productId,
  lines: [
    unitLine("prod-cable", 3, 1.7),
    unitLine("prod-harina", 10, 1, 16),
    packLine,
  ],
  payment: null,
  rateVes: RATE,
  status: "recibido",
  supplierName: "Distribuidora Demo",
};

function renderView(
  input: Partial<PurchaseConfirmInput> = {},
  props: Partial<PurchaseConfirmModalViewProps> = {},
) {
  const onConfirm = props.onConfirm ?? jest.fn();
  const onOpenChange = props.onOpenChange ?? jest.fn();

  render(
    <PurchaseConfirmModalView
      effect={buildPurchaseConfirmEffect({ ...baseInput, ...input })}
      factsStatus="ready"
      open
      {...props}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  );

  return { dialog: screen.getByRole("dialog"), onConfirm, onOpenChange };
}

function lineOf(name: string) {
  return screen.getByText(name).closest("li") as HTMLElement;
}

async function flushDeferredClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("PurchaseConfirmModalView (CNF-01)", () => {
  it("resume la compra: proveedor, líneas, total en REF y Bs, tasa y que queda sin pago", () => {
    const { dialog } = renderView();

    expect(within(dialog).getByRole("heading", { name: "Confirmar compra" })).toBeInTheDocument();
    expect(within(dialog).getByText("Distribuidora Demo")).toBeInTheDocument();
    expect(within(dialog).getByText("3 líneas")).toBeInTheDocument();
    // 5,10 + 10,00 + 24,00 de base; IVA 1,60 + 3,84.
    expect(within(dialog).getByText("ref 44.54 · Bs. 22.715,40")).toBeInTheDocument();
    expect(within(dialog).getByText("Bs. 510,00 por REF")).toBeInTheDocument();
    expect(within(dialog).getByText("Sin pago: queda por pagar")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Registrar compra" })).toBeEnabled();
  });

  it("por producto: unidades que entran (empaques × unidades) y costo anterior → nuevo con IVA", () => {
    renderView();

    const cable = lineOf("Cable HDMI");

    expect(within(cable).getByText("3 und")).toBeInTheDocument();
    expect(within(cable).getByText("ref 1.00")).toBeInTheDocument();
    expect(within(cable).getByText("ref 1.70")).toBeInTheDocument();

    const refresco = lineOf("Refresco Cola");

    expect(within(refresco).getByText("2 × Caja de 12 = 24 und")).toBeInTheDocument();
    expect(within(refresco).getByText("ref 1.00")).toBeInTheDocument();
    // 12,00 / 12 = 1,00 neto + 16 %.
    expect(within(refresco).getByText("ref 1.16")).toBeInTheDocument();

    // Mismo costo que el actual: se dice, sin flecha.
    const harina = lineOf("Harina PAN");

    expect(within(harina).getByText("ref 1.16")).toBeInTheDocument();
    expect(within(harina).getByText("(sin cambio)")).toBeInTheDocument();
  });

  it("la ganancia se muestra solo en el producto que baja de banda", () => {
    renderView();

    const cable = lineOf("Cable HDMI");

    expect(within(cable).getByText("Ganancia")).toBeInTheDocument();
    expect(within(cable).getByText("100 %").closest("[data-band]")).toHaveAttribute(
      "data-band",
      "high",
    );
    expect(within(cable).getByText("17,65 %").closest("[data-band]")).toHaveAttribute(
      "data-band",
      "mid",
    );
    expect(within(lineOf("Harina PAN")).queryByText("Ganancia")).not.toBeInTheDocument();
    expect(within(lineOf("Refresco Cola")).queryByText("Ganancia")).not.toBeInTheDocument();
  });

  it("dice qué productos quedan vinculados por primera vez al proveedor", () => {
    const { dialog } = renderView();

    expect(within(dialog).getByText("Vínculos nuevos")).toBeInTheDocument();
    expect(within(dialog).getByText(/^1 producto/)).toHaveTextContent(
      "Quedan vinculados al proveedor por primera vez",
    );
    expect(within(lineOf("Cable HDMI")).getByText("Vínculo nuevo con el proveedor")).toBeInTheDocument();
    expect(
      within(lineOf("Harina PAN")).queryByText("Vínculo nuevo con el proveedor"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["efectivo_ves", "VES", 1020, "Efectivo VES · Bs. 1.020,00 (ref 2.00)", /Sale del efectivo en Bs del baúl/],
    ["efectivo_usd", "USD", 2, "Efectivo USD · ref 2.00 (Bs. 1.020,00)", /Sale del efectivo en USD del baúl/],
    ["pago_movil", "VES", 1020, "Pago móvil · Bs. 1.020,00 (ref 2.00)", /Sale de la cuenta bancaria del baúl/],
  ] as const)("pagar ahora con %s: método, monto y de dónde sale", (method, currency, amount, text, source) => {
    const { dialog } = renderView({
      payment: {
        amount,
        bankName: undefined,
        currency,
        method,
        notes: undefined,
        phone: undefined,
        referenceCode: undefined,
      },
    });

    expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(within(dialog).getByText(source)).toBeInTheDocument();
    expect(within(dialog).queryByText("Sin pago: queda por pagar")).not.toBeInTheDocument();
  });

  it("pedido: avisa que el inventario NO cambia y no pinta costos ni ganancia como si se aplicaran", () => {
    const { dialog } = renderView({ status: "pedido" });

    expect(within(dialog).getByRole("heading", { name: "Confirmar pedido" })).toBeInTheDocument();
    expect(
      within(dialog).getByText(/El inventario NO cambia hasta recibir: no entra stock ni cambian los costos/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("list", { name: "Mercancía pedida" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Entra")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("Pedido")).toHaveLength(3);
    expect(within(dialog).queryByText("Costo (con IVA)")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Ganancia")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("ref 1.70")).not.toBeInTheDocument();
    // El vínculo sí se crea ya con el pedido.
    expect(within(dialog).getByText("Vínculos nuevos")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Registrar pedido" })).toBeEnabled();
  });

  it("recibido no muestra el aviso de pedido", () => {
    const { dialog } = renderView();

    expect(within(dialog).queryByText(/El inventario NO cambia/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("list", { name: "Mercancía que entra" })).toBeInTheDocument();
  });

  it("línea que se desarma al recibir: los empaques salen y entran las unidades de cada componente", () => {
    const recipes = [
      {
        components: [
          { name: "Refresco cola 355 ml", unitsPerPack: 8 },
          { name: "Refresco naranja 355 ml", unitsPerPack: 4 },
        ],
        packProduct: { id: "prod-surtido" },
      },
    ];
    const marked = { ...unitLine("prod-surtido", 3, 10), disassemble: true };

    renderView({ lines: [marked], recipes });

    const line = lineOf("Caja surtida");
    const components = within(line).getByRole("list", {
      name: "Componentes que entran al desarmar Caja surtida",
    });

    expect(within(line).getByText("−3 und")).toBeInTheDocument();
    expect(within(components).getByText("+24 und")).toBeInTheDocument();
    expect(within(components).getByText("+12 und")).toBeInTheDocument();
  });

  it("en un pedido la línea marcada solo dice que se desarmará al recibir", () => {
    const recipes = [
      { components: [{ name: "Refresco cola 355 ml", unitsPerPack: 12 }], packProduct: { id: "prod-surtido" } },
    ];

    renderView({
      lines: [{ ...unitLine("prod-surtido", 3, 10), disassemble: true }],
      recipes,
      status: "pedido",
    });

    expect(screen.getByText("Marcada para desarmar al recibir")).toBeInTheDocument();
    expect(screen.queryByText("+36 und")).not.toBeInTheDocument();
  });

  it("mientras se consulta lo dice, y muestra el costo nuevo sin inventar el anterior", () => {
    const { dialog } = renderView({ facts: null }, { factsStatus: "loading" });

    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Consultando el costo actual y los vínculos de los productos…",
    );
    expect(within(lineOf("Cable HDMI")).getByText("ref 1.70")).toBeInTheDocument();
    expect(within(lineOf("Cable HDMI")).queryByText("ref 1.00")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Vínculos nuevos")).not.toBeInTheDocument();
  });

  it("si la consulta falla lo dice con claridad y sigue mostrando lo que sí es de esta compra", () => {
    const { dialog } = renderView({ facts: null }, { factsStatus: "error" });

    expect(
      within(dialog).getByText(/No pudimos consultar el costo actual ni los vínculos de los productos/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("ref 44.54 · Bs. 22.715,40")).toBeInTheDocument();
    expect(within(lineOf("Cable HDMI")).getByText("3 und")).toBeInTheDocument();
  });

  it("con 50 líneas las lista todas en una sola zona con scroll, debajo del resumen", () => {
    const lines = Array.from({ length: 50 }, (_, index) =>
      unitLine(`prod-${index}`, index + 1, 1),
    );
    const { dialog } = renderView({ facts: null, lines });
    const list = within(dialog).getByRole("list", { name: "Mercancía que entra" });

    expect(within(dialog).getByText("50 líneas")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(list.parentElement).toHaveClass("overflow-y-auto");
    // El resumen va antes que la lista: se lee sin desplazarse.
    expect(
      within(dialog).getByText("50 líneas").compareDocumentPosition(list) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Cancelar no confirma", async () => {
    const { dialog, onConfirm, onOpenChange } = renderView();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await flushDeferredClose();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("doble clic en el botón confirma UNA vez", async () => {
    let resolve!: () => void;
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((res) => {
          resolve = res;
        }),
    );
    const { dialog } = renderView({}, { onConfirm });
    const button = within(dialog).getByRole("button", { name: "Registrar compra" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
    });
  });

  it("el error del servidor se muestra tal cual y el envío en vuelo bloquea el botón", () => {
    const view = render(
      <PurchaseConfirmModalView
        effect={buildPurchaseConfirmEffect(baseInput)}
        factsStatus="ready"
        isPending
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        open
      />,
    );

    expect(screen.getByRole("button", { name: /Procesando/ })).toBeDisabled();

    view.rerender(
      <PurchaseConfirmModalView
        effect={buildPurchaseConfirmEffect(baseInput)}
        error="El producto Cable HDMI está inactivo."
        factsStatus="ready"
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        open
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("El producto Cable HDMI está inactivo.");
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeEnabled();
  });

  it("cerrado no pinta nada", () => {
    render(
      <PurchaseConfirmModalView
        effect={null}
        factsStatus="loading"
        onConfirm={jest.fn()}
        onOpenChange={jest.fn()}
        open={false}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function page<T>(items: T[]) {
  return { items, limit: 100, skip: 0, total: items.length };
}

const linkRows = [
  {
    id: "sp-harina",
    isActive: true,
    product: { currentCostRef: 1.16, salePriceRef: 3 },
    productId: "prod-harina",
  },
  {
    id: "sp-refresco",
    isActive: false,
    product: { currentCostRef: 1, salePriceRef: 3 },
    productId: "prod-refresco",
  },
  // De otra compra: no se pidió.
  { id: "sp-otro", isActive: true, product: { currentCostRef: 9, salePriceRef: 9 }, productId: "prod-otro" },
];

/** GET de prueba: vínculos del proveedor, ajustes de precio y fichas de producto. */
function installGets(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const urls: string[] = [];

  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);

    urls.push(url);

    const override = Object.entries(overrides).find(([prefix]) => url.startsWith(prefix));

    if (override) {
      return Promise.resolve(override[1]());
    }

    if (url.startsWith("/api/suppliers/cont-supplier/products")) {
      return Promise.resolve(jsonResponse({ data: page(linkRows) }));
    }

    if (url.startsWith("/api/settings/pricing")) {
      return Promise.resolve(
        jsonResponse({ data: { chipsPct: [12, 20, 30], greenFromPct: 30, yellowFromPct: 10 } }),
      );
    }

    if (url === "/api/products/prod-cable") {
      return Promise.resolve(
        jsonResponse({ data: { currentCostRef: 1, id: "prod-cable", salePriceRef: 2 } }),
      );
    }

    return Promise.resolve(
      jsonResponse({ error: { code: "NOT_FOUND", message: "Producto no encontrado." } }, 404),
    );
  }) as unknown as typeof fetch;

  return urls;
}

describe("fetchPurchaseConfirmFacts (CNF-01)", () => {
  it("costo, precio y vínculo de cada producto pedido, con los cortes de la tienda; solo lecturas", async () => {
    const urls = installGets();
    const result = await fetchPurchaseConfirmFacts("cont-supplier", [
      "prod-cable",
      "prod-harina",
      "prod-refresco",
      "prod-borrado",
    ]);

    expect(Object.fromEntries(result.products)).toEqual({
      // Sin vínculo: sale de la ficha del producto.
      "prod-cable": { currentCostRef: 1, link: "none", salePriceRef: 2 },
      "prod-harina": { currentCostRef: 1.16, link: "active", salePriceRef: 3 },
      // Vínculo desactivado: la compra lo reactiva, no es la primera vez.
      "prod-refresco": { currentCostRef: 1, link: "inactive", salePriceRef: 3 },
    });
    // Un producto que ya no existe (404) queda sin dato; no rompe la consulta.
    expect(result.products.has("prod-borrado")).toBe(false);
    expect(result.thresholds).toEqual({ high: 30, low: 10 });
    expect(urls.filter((url) => url.startsWith("/api/products/")).sort()).toEqual([
      "/api/products/prod-borrado",
      "/api/products/prod-cable",
    ]);
    expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("un error que no es 404 se propaga: no se da por bueno un dato a medias", async () => {
    installGets({
      "/api/products/prod-cable": () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Sin permiso." } }, 403),
    });

    await expect(fetchPurchaseConfirmFacts("cont-supplier", ["prod-cable"])).rejects.toThrow(
      "Sin permiso.",
    );
  });
});

describe("PurchaseConfirmModal (CNF-01) · con su consulta", () => {
  const input = { ...baseInput, facts: undefined };

  function renderModal(open = true) {
    const QueryWrapper = createQueryWrapper();

    return render(
      <QueryWrapper>
        <PurchaseConfirmModal
          input={input}
          onConfirm={jest.fn()}
          onOpenChange={jest.fn()}
          open={open}
          supplierId="cont-supplier"
        />
      </QueryWrapper>,
    );
  }

  it("abre con lo que ya sabe y completa costo anterior, banda y vínculos al llegar la consulta", async () => {
    installGets();
    renderModal();

    expect(screen.getByRole("status")).toHaveTextContent(/Consultando el costo actual/);
    expect(within(lineOf("Cable HDMI")).getByText("ref 1.70")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    expect(within(lineOf("Cable HDMI")).getByText("ref 1.00")).toBeInTheDocument();
    // Cortes de la tienda (verde desde 30 %): 100 % → 17,65 % baja a amarillo.
    expect(within(lineOf("Cable HDMI")).getByText("17,65 %")).toBeInTheDocument();
    expect(within(lineOf("Cable HDMI")).getByText("Vínculo nuevo con el proveedor")).toBeInTheDocument();
    // El vínculo desactivado se reactiva: no cuenta como nuevo.
    expect(
      within(lineOf("Refresco Cola")).queryByText("Vínculo nuevo con el proveedor"),
    ).not.toBeInTheDocument();
  });

  it("si la consulta falla, lo dice y deja las cifras de la compra", async () => {
    installGets({
      "/api/suppliers/cont-supplier/products": () =>
        jsonResponse({ error: { code: "INTERNAL", message: "boom" } }, 500),
    });
    renderModal();

    expect(
      await screen.findByText(/No pudimos consultar el costo actual ni los vínculos/, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("ref 44.54 · Bs. 22.715,40")).toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("cerrado no consulta nada", async () => {
    const urls = installGets();

    renderModal(false);
    await flushDeferredClose();

    expect(urls).toHaveLength(0);
  });
});
