import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { priceFromMarkup } from "@/shared/utils/pricing";

import { RepriceConfirmModal, type RepriceProduct } from "./RepriceConfirmModal";

/** CNF-07 · confirmación del reprecio masivo: lista completa antes → después y resumen. */

const BADGE_TITLE = "Ganancia sobre el costo (ya con IVA)";
const LIST_NAME = "Precio y ganancia antes y después";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

const fetchMock = jest.fn();

function posts() {
  return fetchMock.mock.calls
    .filter(([, init]: [string, RequestInit | undefined]) => init?.method === "POST")
    .map(([url, init]: [string, RequestInit]) => ({ body: JSON.parse(String(init.body)), url }));
}

const ARROZ: RepriceProduct = { currentCostRef: 9, id: "p-arroz", name: "Arroz", salePriceRef: 10 };
/** Al 30 % baja: 10 × 1,30 = 13 < 14. */
const HARINA: RepriceProduct = { currentCostRef: 10, id: "p-harina", name: "Harina", salePriceRef: 14 };
/** Al 30 % queda igual: 10 × 1,30 = 13. */
const SAL: RepriceProduct = { currentCostRef: 10, id: "p-sal", name: "Sal", salePriceRef: 13 };
const SIN_COSTO: RepriceProduct = { currentCostRef: 0, id: "p-nuevo", name: "Nuevo", salePriceRef: 5 };

type ModalProps = Partial<React.ComponentProps<typeof RepriceConfirmModal>>;

/** Respuesta del POST de reprecio; cada test puede cambiarla. */
let repriceResponse: Response;

/**
 * Al abrirse, la confirmación relee la cola «Por revisar» (CNF-F10): aquí devuelve los
 * mismos productos, con las mismas cifras, que recibe el modal.
 */
function serveQueue(products: RepriceProduct[]) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? repriceResponse
      : jsonResponse({
          data: {
            items: products.map(({ id, ...figures }) => ({ ...figures, productId: id })),
            limit: 100,
            skip: 0,
            total: products.length,
          },
        }),
  );
}

async function renderModal(props: ModalProps = {}) {
  const onDone = jest.fn();

  serveQueue(props.products ?? [ARROZ, HARINA]);
  const onOpenChange = jest.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <RepriceConfirmModal
        markupPct={30}
        onDone={onDone}
        onOpenChange={onOpenChange}
        open
        products={[ARROZ, HARINA]}
        rateVes={40}
        {...props}
      />
    </QueryClientProvider>,
  );

  // Con la relectura hecha aparecen la lista y el botón de confirmar.
  await screen.findByRole("list", { name: LIST_NAME });

  return { onDone, onOpenChange, user: userEvent.setup({ delay: null }) };
}

function rows() {
  return within(screen.getByRole("list", { name: LIST_NAME })).getAllByTestId("price-change-effect");
}

function summary() {
  return within(screen.getByRole("list", { name: "Resumen del reprecio" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

beforeEach(() => {
  fetchMock.mockReset();
  repriceResponse = jsonResponse({ data: { failed: 0, results: [], updated: 2 } });
  global.fetch = fetchMock;
});

describe("RepriceConfirmModal (CNF-07)", () => {
  it("lista cada producto con precio en REF y Bs y ganancia con semáforo, antes → después", async () => {
    await renderModal();

    const [arroz, harina] = rows();

    // 9 × 1,30 = 11,70; a la tasa 40: 400 → 468.
    expect(arroz).toHaveTextContent(/Arroz.*ref 10\.00\s*pasa a\s*ref 11\.70.*Sube/);
    expect(arroz).toHaveTextContent(/Bs\. 400,00\s*pasa a\s*Bs\. 468,00/);

    const arrozBadges = within(arroz).getAllByTitle(BADGE_TITLE);

    expect(arrozBadges[0]).toHaveTextContent("11,11 %");
    expect(arrozBadges[0]).toHaveAttribute("data-band", "low");
    expect(arrozBadges[1]).toHaveTextContent("30 %");
    expect(arrozBadges[1]).toHaveAttribute("data-band", "high");

    expect(harina).toHaveTextContent(/Harina.*ref 14\.00\s*pasa a\s*ref 13\.00.*Baja/);
    expect(harina).toHaveAttribute("data-direction", "down");
    expect(screen.getByText("Motivo: Reprecio al 30 %")).toBeInTheDocument();
    expect(posts()).toEqual([]);
  });

  it("el semáforo usa los cortes de la tienda", async () => {
    await renderModal({ products: [ARROZ], thresholds: { high: 40, low: 12 } });

    const badges = within(rows()[0]).getAllByTitle(BADGE_TITLE);

    expect(badges[0]).toHaveAttribute("data-band", "low");
    expect(badges[1]).toHaveAttribute("data-band", "mid");
  });

  it("resume cuántos suben, bajan, no cambian, quedan bajo costo y no tienen costo", async () => {
    await renderModal({ products: [ARROZ, HARINA, SAL, SIN_COSTO] });

    expect(summary()).toEqual([
      "1 sube",
      "1 baja",
      "0 quedan bajo su costo",
      "1 no cambia",
      "1 sin costo (no se cambia)",
    ]);
    expect(screen.getByText("Sin costo: no se cambiará")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("avisa en tono de peligro cuando un precio nuevo queda por debajo del costo", async () => {
    // Un % negativo deja el precio bajo el costo: 9 × 0,90 = 8,10.
    await renderModal({ markupPct: -10, products: [ARROZ, HARINA] });

    expect(summary()).toEqual(["0 suben", "2 bajan", "2 quedan bajo su costo"]);

    const warnings = screen.getAllByRole("note");

    // El aviso general más el de cada fila.
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toHaveAttribute("data-tone", "danger");
    expect(warnings[0]).toHaveTextContent(
      "2 productos quedan con el precio por debajo de su costo: cada venta sería a pérdida.",
    );
    expect(within(rows()[0]).getByRole("note")).toHaveTextContent(
      "El precio nuevo queda por debajo del costo (ref 9.00)",
    );
  });

  it("con 50 productos los lista todos, con el precio que calculará el servidor", async () => {
    const products = Array.from({ length: 50 }, (_, index) => ({
      currentCostRef: 1 + index * 0.37,
      id: `p-${index}`,
      name: `Producto ${index + 1}`,
      salePriceRef: 1,
    }));

    await renderModal({ markupPct: 17.5, products });

    const list = rows();

    expect(list).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Cambiar 50 precios" })).toBeEnabled();
    expect(summary()).toEqual(["50 suben", "0 bajan", "0 quedan bajo su costo"]);
    // Mismo redondeo que `reprice_product_to_markup`: `priceFromMarkup` de @bodega/core.
    expect(list[49]).toHaveTextContent(
      `ref ${priceFromMarkup(products[49].currentCostRef, 17.5).toFixed(2)}`,
    );
  });

  it("cancelar no envía nada", async () => {
    const { onDone, onOpenChange, user } = await renderModal();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDone).not.toHaveBeenCalled();
    expect(posts()).toEqual([]);
  });

  it("doble clic al confirmar envía UNA sola petición, con el costo de la vista previa", async () => {
    const { onDone } = await renderModal();
    const confirm = screen.getByRole("button", { name: "Cambiar 2 precios" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(posts()).toEqual([
      {
        body: {
          items: [
            { expectedCostRef: 9, productId: "p-arroz" },
            { expectedCostRef: 10, productId: "p-harina" },
          ],
          markupPct: 30,
        },
        url: "/api/products/price-review/reprice",
      },
    ]);
  });

  it("un error del servidor se muestra tal cual y el modal sigue abierto", async () => {
    repriceResponse = jsonResponse(
      { error: { code: "FORBIDDEN", message: "No autorizado para cambiar precios." } },
      403,
    );
    const { onDone, onOpenChange, user } = await renderModal();

    await user.click(screen.getByRole("button", { name: "Cambiar 2 precios" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "No autorizado para cambiar precios.",
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
