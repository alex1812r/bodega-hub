/**
 * CNF-F10 · CAOS-04b: las confirmaciones de reprecio («Aplicar» del aviso de compra,
 * reprecio masivo y «Mantener precio») releen precio y costo al abrirse. El «antes»
 * que muestran y el aviso de éxito salen de lo que dice el servidor, no de la lista
 * que se cargó antes de que otro usuario cambiara el precio.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/shared/components/Toast";
import { IMPACT_TIMEOUT_MS } from "@/shared/impact";

import type { ProductPriceReviewItem } from "../../hooks/usePriceReview";
import { KeepPriceConfirmModal } from "./KeepPriceConfirmModal";
import { PurchaseRepriceNotice } from "./PurchaseRepriceNotice";
import { RepriceConfirmModal, type RepriceProduct } from "./RepriceConfirmModal";

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));

type Reply = () => Promise<Response>;
type Write = { body: Record<string, unknown>; url: string };

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const ok = (data: unknown): Reply => () => Promise.resolve(jsonResponse({ data }));
const fail: Reply = () =>
  Promise.resolve(jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Sin servicio" } }, 500));
const hang: Reply = () => new Promise<Response>(() => undefined);

function reviewItem(overrides: Partial<ProductPriceReviewItem> = {}): ProductPriceReviewItem {
  return {
    currentBand: "low",
    currentCostRef: 9,
    currentMarginPct: 11.111111,
    name: "Tubo PVC 1/2",
    previousBand: "high",
    previousCostRef: 8,
    previousMarginPct: 25,
    productId: "prod-1",
    purchase: { id: "pur-1", number: "C-000123", receivedAt: "2026-10-07T12:00:00.000Z" },
    salePriceRef: 10,
    sku: "tubo",
    snapshotAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

const queuePage = (items: ProductPriceReviewItem[], total = items.length): Reply =>
  ok({ items, limit: 100, skip: 0, total });
const product = (salePriceRef: unknown, currentCostRef: unknown = 9): Reply =>
  ok({ currentCostRef, id: "prod-1", name: "Tubo PVC 1/2", priceReview: {}, salePriceRef });

/**
 * `products`: una respuesta por cada relectura de `GET /api/products/prod-1` (la última se
 * repite). `queue`: lo mismo para la cola «Por revisar». `writes`: respuestas de los POST.
 */
function installServer(routes: { products?: Reply[]; queue?: Reply[]; writes?: Reply[] }) {
  const calls = { productReads: 0, queueReads: [] as string[], writes: [] as Write[] };
  const next = (replies: Reply[] | undefined, index: number) =>
    (replies?.[Math.min(index, (replies?.length ?? 1) - 1)] ?? fail)();

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (init?.method === "POST") {
      calls.writes.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, url });

      return next(routes.writes, calls.writes.length - 1);
    }

    if (url.startsWith("/api/settings/pricing")) {
      return ok({ chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 })();
    }

    if (url.startsWith("/api/exchange-rates/current")) {
      return ok({ rateVes: 40 })();
    }

    if (url === "/api/products/prod-1") {
      calls.productReads += 1;

      return next(routes.products, calls.productReads - 1);
    }

    calls.queueReads.push(url);

    return next(routes.queue, calls.queueReads.length - 1);
  }) as unknown as typeof fetch;

  return calls;
}

function renderWithProviders(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  jest.useRealTimers();
});

describe("PurchaseRepriceNotice · «Aplicar» relee el producto al abrir (CAOS-04b)", () => {
  async function openApply() {
    renderWithProviders(<PurchaseRepriceNotice purchaseId="pur-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    return screen.findByRole("dialog", { name: "Aplicar reprecio" });
  }

  const applyButton = (dialog: HTMLElement) =>
    within(dialog).queryByRole("button", { name: "Aplicar precio" });

  it("otro usuario cambió el precio: el «antes» es el fresco, lo avisa y el éxito dice lo que el servidor sustituyó", async () => {
    const calls = installServer({
      products: [product(99)],
      queue: [queuePage([reviewItem()])],
      writes: [ok({ history: { previousSalePriceRef: 99 }, product: { salePriceRef: 11.25 } })],
    });
    const dialog = await openApply();

    expect(
      await within(dialog).findByText("El precio cambió desde que se cargó este aviso: ahora es ref 99.00."),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId("price-change-effect")).toHaveTextContent(
      /Precio\s*ref 99\.00\s*pasa a\s*ref 11\.25/,
    );
    expect(dialog).toHaveTextContent("El precio de Tubo PVC 1/2 pasa de ref 99.00 a ref 11.25.");
    expect(dialog).not.toHaveTextContent("ref 10.00");

    fireEvent.click(applyButton(dialog) as HTMLElement);

    expect(await screen.findByText("Pasa de ref 99.00 a ref 11.25.")).toBeInTheDocument();
    expect(calls.writes).toEqual([
      {
        body: { expectedCostRef: 9, reason: "Reprecio al 25 % por compra C-000123", salePriceRef: 11.25 },
        url: "/api/products/prod-1/price",
      },
    ]);
  });

  it("si otro cambio entra entre la relectura y el envío, el éxito dice el precio que de verdad sustituyó", async () => {
    installServer({
      products: [product(10)],
      queue: [queuePage([reviewItem()])],
      writes: [ok({ history: { previousSalePriceRef: 50 }, product: { salePriceRef: 11.25 } })],
    });
    const dialog = await openApply();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Aplicar precio" }));

    expect(await screen.findByText("Pasa de ref 50.00 a ref 11.25.")).toBeInTheDocument();
  });

  it("el costo cambió: la propuesta y el costo esperado salen del costo fresco", async () => {
    const calls = installServer({
      products: [product(10, 10)],
      queue: [queuePage([reviewItem()])],
      writes: [ok({ history: { previousSalePriceRef: 10 }, product: { salePriceRef: 12.5 } })],
    });
    const dialog = await openApply();

    expect(
      await within(dialog).findByText("El costo cambió desde que se cargó este aviso: ahora es ref 10.00."),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId("price-change-effect")).toHaveTextContent(
      /Precio\s*ref 10\.00\s*pasa a\s*ref 12\.50/,
    );

    fireEvent.click(applyButton(dialog) as HTMLElement);

    await waitFor(() => expect(calls.writes).toHaveLength(1));
    expect(calls.writes[0].body).toMatchObject({ expectedCostRef: 10, salePriceRef: 12.5 });
  });

  it("el precio ya es el propuesto: no hay nada que cambiar ni botón para hacerlo", async () => {
    const calls = installServer({ products: [product(11.25)], queue: [queuePage([reviewItem()])] });
    const dialog = await openApply();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "El precio ya es ref 11.25: no hay nada que cambiar.",
    );
    expect(applyButton(dialog)).not.toBeInTheDocument();
    expect(calls.writes).toEqual([]);
  });

  it("mientras relee no deja confirmar; si falla lo dice y Reintentar lo deja listo", async () => {
    const calls = installServer({ products: [fail, product(10)], queue: [queuePage([reviewItem()])] });
    const dialog = await openApply();

    expect(applyButton(dialog)).not.toBeInTheDocument();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo comprobar el precio actual.",
    );
    expect(applyButton(dialog)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));

    expect(await within(dialog).findByRole("button", { name: "Aplicar precio" })).toBeEnabled();
    expect(calls.writes).toEqual([]);
  });

  it.each([
    ["sin precio", product(undefined)],
    ["con el precio en null", product(null)],
    ["con el costo como texto", product(10, "9")],
  ])("una relectura 200 %s cuenta como fallo y no tumba nada", async (_label, reply) => {
    installServer({ products: [reply], queue: [queuePage([reviewItem()])] });
    const dialog = await openApply();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo comprobar el precio actual.",
    );
    expect(applyButton(dialog)).not.toBeInTheDocument();
  });

  it("una relectura que no responde deja de «comprobar» a los 15 s y ofrece reintentar", async () => {
    installServer({ products: [hang], queue: [queuePage([reviewItem()])] });
    renderWithProviders(<PurchaseRepriceNotice purchaseId="pur-1" />);

    const apply = await screen.findByRole("button", { name: "Aplicar" });

    // El reloj falso, antes de abrir: el límite de la relectura se arma al pedirla.
    jest.useFakeTimers();
    fireEvent.click(apply);

    const dialog = screen.getByRole("dialog", { name: "Aplicar reprecio" });

    expect(within(dialog).getByText("Comprobando el precio actual…")).toBeInTheDocument();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(IMPACT_TIMEOUT_MS + 1);
    });
    jest.useRealTimers();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo comprobar el precio actual.",
    );
    expect(within(dialog).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});

describe("RepriceConfirmModal · relee los seleccionados al abrir (CAOS-04b)", () => {
  const TUBO: RepriceProduct = { currentCostRef: 9, id: "prod-1", name: "Tubo PVC 1/2", salePriceRef: 10 };
  const CODO: RepriceProduct = { currentCostRef: 10, id: "prod-2", name: "Codo PVC", salePriceRef: 14 };
  const codoItem = (overrides: Partial<ProductPriceReviewItem> = {}) =>
    reviewItem({ currentCostRef: 10, name: "Codo PVC", productId: "prod-2", salePriceRef: 14, ...overrides });

  function renderModal(products = [TUBO, CODO]) {
    const onDone = jest.fn();

    renderWithProviders(
      <RepriceConfirmModal markupPct={30} onDone={onDone} onOpenChange={jest.fn()} open products={products} rateVes={40} />,
    );

    return { onDone };
  }

  const rows = async () =>
    within(await screen.findByRole("list", { name: "Precio y ganancia antes y después" })).getAllByRole("listitem");

  it("pinta precio y costo frescos, avisa de cuántos cambiaron y envía el costo fresco", async () => {
    const result = { failed: 0, results: [], updated: 2 };
    const calls = installServer({
      queue: [queuePage([reviewItem({ salePriceRef: 99 }), codoItem({ currentCostRef: 12 })])],
      writes: [ok(result)],
    });
    const { onDone } = renderModal();
    const [tubo, codo] = await rows();

    // 9 × 1,30 = 11,70 sobre el precio fresco (99); 12 × 1,30 = 15,60 sobre el costo fresco.
    expect(tubo).toHaveTextContent(/ref 99\.00\s*pasa a\s*ref 11\.70/);
    expect(codo).toHaveTextContent(/ref 14\.00\s*pasa a\s*ref 15\.60/);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("ref 10.00");
    expect(
      screen.getByText(
        "2 productos cambiaron de precio o de costo desde que se cargó la lista: se muestran sus cifras actuales.",
      ),
    ).toBeInTheDocument();
    expect(calls.queueReads).toEqual(["/api/products/price-review?limit=100&skip=0"]);

    fireEvent.click(screen.getByRole("button", { name: "Cambiar 2 precios" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result));
    expect(calls.writes[0].body).toEqual({
      items: [
        { expectedCostRef: 9, productId: "prod-1" },
        { expectedCostRef: 12, productId: "prod-2" },
      ],
      markupPct: 30,
    });
  });

  it("sin cambios no hay aviso", async () => {
    installServer({ queue: [queuePage([reviewItem(), codoItem()])] });
    renderModal();
    await rows();

    expect(screen.getByRole("dialog")).not.toHaveTextContent("desde que se cargó la lista");
  });

  it("un seleccionado que ya no está en «Por revisar» se dice y no se envía", async () => {
    const calls = installServer({
      queue: [queuePage([codoItem()])],
      writes: [ok({ failed: 0, results: [], updated: 1 })],
    });

    renderModal();

    const [tubo] = await rows();

    expect(tubo).toHaveTextContent("Tubo PVC 1/2");
    expect(tubo).toHaveTextContent("Ya no está en «Por revisar»: no se cambiará");

    fireEvent.click(screen.getByRole("button", { name: "Cambiar 1 precio" }));

    await waitFor(() => expect(calls.writes).toHaveLength(1));
    expect(calls.writes[0].body).toMatchObject({ items: [{ expectedCostRef: 10, productId: "prod-2" }] });
  });

  it("si ninguno sigue en «Por revisar», lo dice y no deja confirmar", async () => {
    installServer({ queue: [queuePage([])] });
    renderModal();

    expect(await within(await screen.findByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Ninguno de los productos seleccionados sigue en «Por revisar»: no hay nada que cambiar.",
    );
    expect(screen.queryByRole("button", { name: /Cambiar \d+ precio/ })).not.toBeInTheDocument();
  });

  it("una cola de más de una página se lee por páginas hasta dar con los seleccionados", async () => {
    const calls = installServer({
      queue: [queuePage([codoItem()], 150), queuePage([reviewItem()], 150)],
    });

    renderModal();

    expect(await rows()).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "Cambiar 2 precios" })).toBeEnabled();
    expect(calls.queueReads).toEqual([
      "/api/products/price-review?limit=100&skip=0",
      "/api/products/price-review?limit=100&skip=100",
    ]);
  });

  it.each([
    ["falla", fail],
    ["llega con un precio en null", queuePage([reviewItem({ salePriceRef: null as unknown as number })])],
  ])("si la relectura %s lo dice, no deja confirmar y Reintentar lo deja listo", async (_label, reply) => {
    const calls = installServer({ queue: [reply, queuePage([reviewItem(), codoItem()])] });

    renderModal();

    expect(await within(await screen.findByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "No se pudieron comprobar los precios actuales.",
    );
    expect(screen.queryByRole("button", { name: /Cambiar \d+ precio/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("button", { name: "Cambiar 2 precios" })).toBeEnabled();
    expect(calls.writes).toEqual([]);
  });
});

describe("KeepPriceConfirmModal · el precio que se mantiene es el fresco (CAOS-04b)", () => {
  const TUBO = { currentCostRef: 9, id: "prod-1", name: "Tubo PVC 1/2", salePriceRef: 10 };

  function renderKeep() {
    renderWithProviders(<KeepPriceConfirmModal onOpenChange={jest.fn()} open product={TUBO} />);

    return screen.findByRole("dialog", { name: "Mantener precio" });
  }

  it("otro usuario cambió el precio: dice el precio y la ganancia actuales y envía el costo fresco", async () => {
    const calls = installServer({ products: [product(18, 12)], writes: [ok({})] });
    const dialog = await renderKeep();

    expect(
      await within(dialog).findByText(/El precio no cambia: se queda en ref 18\.00 con una ganancia de 50 %\./),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("ref 10.00");

    fireEvent.click(within(dialog).getByRole("button", { name: "Mantener precio" }));

    await waitFor(() => expect(calls.writes).toHaveLength(1));
    expect(calls.writes[0]).toEqual({
      body: { expectedCostRef: 12 },
      url: "/api/products/prod-1/keep-price",
    });
  });

  it("si la relectura falla no deja mantener a ciegas y se puede reintentar", async () => {
    const calls = installServer({ products: [fail, product(10)] });
    const dialog = await renderKeep();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No se pudo comprobar el precio actual.",
    );
    expect(within(dialog).queryByRole("button", { name: "Mantener precio" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));

    expect(await within(dialog).findByRole("button", { name: "Mantener precio" })).toBeEnabled();
    expect(calls.writes).toEqual([]);
  });
});
