/**
 * PAG-03b · buscador de documentos con saldo: el paso previo al modal de pago en
 * `/payments`. Busca en servidor, nunca pide un ID y solo devuelve el documento elegido.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  dateRangeChip,
  dateRangeLabel,
  pickCustomDateRange,
} from "@/shared/components/DateRangeField/testing";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";

import type { OpenDocument } from "../hooks/useOpenDocuments";
import {
  PAYMENT_DOCUMENT_PICKER_DEBOUNCE_MS,
  PAYMENT_DOCUMENT_PICKER_PAGE_SIZE,
  PaymentDocumentPicker,
} from "./PaymentDocumentPicker";

// Hoy operativo fijo: los presets relativos del rango se calculan con él.
jest.mock("../../dashboard/utils/businessDate", () => ({
  getBusinessTodayIsoDate: () => "2026-10-09",
}));

function sale(index: number, overrides: Partial<OpenDocument> = {}): OpenDocument {
  return {
    contact: { id: `cont-${index}`, name: `Cliente ${index}` },
    createdAt: "2026-10-01T15:10:00.000Z",
    id: `sale-${index}`,
    number: `V-00000${index}`,
    paidVes: 0,
    pendingRef: 10 + index,
    pendingVes: 5000 + index,
    refRateVes: 500,
    status: "pendiente_pago",
    totalRef: 10 + index,
    totalVes: 5000 + index,
    type: "sale",
    ...overrides,
  };
}

const PURCHASE: OpenDocument = {
  contact: { id: "cont-supplier", name: "Distribuidora Polar" },
  createdAt: "2026-09-20T15:10:00.000Z",
  id: "purchase-9",
  number: "C-000009",
  paidRef: 0,
  paidVes: 0,
  pendingRef: 40,
  pendingVes: 20000,
  refRateVes: 500,
  status: "recibido",
  totalRef: 40,
  totalVes: 20000,
  type: "purchase",
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

type Query = Record<string, string>;
type Scope = ReturnType<typeof within>;

/** Resultados del buscador (las opciones del `<select>` de tipo no cuentan). */
function results(scope: Scope) {
  return within(scope.getByRole("listbox")).getAllByRole("option");
}

async function findResults(scope: Scope) {
  return within(await scope.findByRole("listbox")).getAllByRole("option");
}

describe("PaymentDocumentPicker", () => {
  const fetchMock = jest.fn();
  const onSelect = jest.fn();
  let respond: (query: Query) => Promise<Response> | Response;

  function listResponse(items: OpenDocument[], total = items.length) {
    return jsonResponse({
      data: {
        items,
        limit: items.length,
        skip: 0,
        total,
        totals: { count: total, pendingVes: 0, truncated: false },
      },
    });
  }

  beforeEach(() => {
    onSelect.mockReset();
    respond = (query) =>
      listResponse(query.type === "purchase" ? [PURCHASE] : [sale(1), sale(2), sale(3)]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const [path, search = ""] = String(url).split("?");

      if (path !== "/api/payments/open-documents") {
        return jsonResponse({ error: { code: "NOT_FOUND", message: "No encontrado." } }, 404);
      }

      return respond(Object.fromEntries(new URLSearchParams(search)));
    });
    global.fetch = fetchMock;
  });

  /** Query de cada `GET /api/payments/open-documents`, en orden. */
  function requests(): Query[] {
    return fetchMock.mock.calls.map(([url]) =>
      Object.fromEntries(new URLSearchParams(String(url).split("?")[1] ?? "")),
    );
  }

  function lastRequest() {
    const all = requests();

    return all[all.length - 1];
  }

  function Harness({ canPayPurchases }: { canPayPurchases: boolean }) {
    const [open, setOpen] = useState(true);

    return (
      <>
        <button onClick={() => setOpen(true)} type="button">
          Abrir buscador
        </button>
        <PaymentDocumentPicker
          canPayPurchases={canPayPurchases}
          onOpenChange={setOpen}
          onSelect={onSelect}
          open={open}
        />
      </>
    );
  }

  async function renderPicker({ canPayPurchases = true } = {}) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Harness canPayPurchases={canPayPurchases} />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Registrar pago" });

    return { dialog: within(dialog), dialogElement: dialog, user: userEvent.setup() };
  }

  it("lista las ventas por cobrar con numero, contacto, fecha, saldo en REF y en Bs y tipo", async () => {
    const { dialog } = await renderPicker();

    const options = await findResults(dialog);
    const first = within(options[0]);

    expect(options).toHaveLength(3);
    expect(first.getByText("V-000001")).toBeInTheDocument();
    expect(first.getByText("Cliente 1")).toBeInTheDocument();
    expect(first.getByText(formatDate("2026-10-01T15:10:00.000Z"))).toBeInTheDocument();
    expect(first.getByText(formatRefUsd(11))).toBeInTheDocument();
    expect(first.getByText(formatVesBs(5001))).toBeInTheDocument();
    expect(first.getByText("Venta")).toBeInTheDocument();
    expect(dialog.getByRole("listbox", { name: "Ventas por cobrar" })).toBeInTheDocument();
    expect(lastRequest()).toEqual({
      limit: String(PAYMENT_DOCUMENT_PICKER_PAGE_SIZE),
      skip: "0",
      type: "sale",
    });
  });

  it("no tiene ningun campo de ID: solo buscador, tipo y fechas", async () => {
    const { dialog, dialogElement } = await renderPicker();

    await findResults(dialog);

    const labels = Array.from(dialogElement.querySelectorAll("label")).map(
      (label) => label.textContent,
    );

    expect(labels).toEqual(["Buscar documento", "Tipo de documento"]);
    expect(dialog.getByRole("group", { name: "Rango de fechas" })).toBeInTheDocument();
    expect(dialogElement.querySelector('input[type="date"]')).toBeNull();
    expect(dialog.queryByLabelText(/ID/)).not.toBeInTheDocument();
    expect(dialogElement).not.toHaveTextContent("sale-1");
  });

  it("busca en servidor con debounce: una sola peticion con el texto completo y sin espacios", async () => {
    const { dialog, user } = await renderPicker();

    await findResults(dialog);
    await user.type(dialog.getByLabelText("Buscar documento"), "  polar ");

    await waitFor(() => expect(lastRequest().search).toBe("polar"));
    expect(requests().map((request) => request.search)).toEqual([undefined, "polar"]);
    expect(PAYMENT_DOCUMENT_PICKER_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);
  });

  it("el selector de tipo pide las compras por pagar", async () => {
    const { dialog, user } = await renderPicker();

    await findResults(dialog);
    await user.selectOptions(dialog.getByLabelText("Tipo de documento"), "Compras por pagar");

    const option = within((await findResults(dialog))[0]);

    expect(lastRequest()).toMatchObject({ type: "purchase" });
    expect(option.getByText("C-000009")).toBeInTheDocument();
    expect(option.getByText("Distribuidora Polar")).toBeInTheDocument();
    expect(option.getByText("Compra")).toBeInTheDocument();
    expect(dialog.getByRole("listbox", { name: "Compras por pagar" })).toBeInTheDocument();
  });

  it("el rango de fechas viaja como from/to y no se puede dejar invertido", async () => {
    const { dialog, dialogElement, user } = await renderPicker();

    await findResults(dialog);
    expect(lastRequest().from).toBeUndefined();

    await pickCustomDateRange(user, "5 de octubre de 2026", "1 de octubre de 2026", dialogElement);
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({ from: "2026-10-01", to: "2026-10-05" }),
    );
    expect(dateRangeLabel(dialogElement)).toHaveTextContent("1–5 oct 2026");
  });

  it("INT-05 · «Mes pasado» pide su rango en un clic y quitarlo vuelve a pedir sin fechas", async () => {
    const { dialog, dialogElement, user } = await renderPicker();

    await findResults(dialog);
    await user.click(dateRangeChip("Mes pasado", dialogElement));
    await waitFor(() =>
      expect(lastRequest()).toMatchObject({ from: "2026-09-01", limit: "20", to: "2026-09-30" }),
    );

    await user.click(dialog.getByRole("button", { name: "Quitar rango de fechas" }));
    await waitFor(() => expect(lastRequest().from).toBeUndefined());
    expect(lastRequest().to).toBeUndefined();
  });

  it("vendedor: sin selector de tipo y solo pide ventas", async () => {
    const { dialog, user } = await renderPicker({ canPayPurchases: false });

    await findResults(dialog);
    await user.type(dialog.getByLabelText("Buscar documento"), "polar");
    await waitFor(() => expect(lastRequest().search).toBe("polar"));

    expect(dialog.queryByLabelText("Tipo de documento")).not.toBeInTheDocument();
    expect(dialog.queryByText("Compras por pagar")).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Buscar documento")).toHaveAttribute(
      "placeholder",
      "Número o cliente",
    );
    expect(requests().every((request) => request.type === "sale")).toBe(true);
  });

  it("sin resultados muestra «No hay documentos con saldo»", async () => {
    respond = () => listResponse([]);
    const { dialog } = await renderPicker();

    expect(await dialog.findByText("No hay documentos con saldo")).toBeInTheDocument();
    expect(dialog.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("mientras carga avisa y no ofrece nada que elegir", async () => {
    respond = () => new Promise<Response>(() => undefined);
    const { dialog, user } = await renderPicker();

    expect(await dialog.findByText("Buscando documentos...")).toBeInTheDocument();
    await user.type(dialog.getByLabelText("Buscar documento"), "{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("si la busqueda falla muestra el mensaje del servidor y «Reintentar» vuelve a pedirla", async () => {
    respond = () =>
      jsonResponse({ error: { code: "INTERNAL", message: "Fallo al leer documentos." } }, 500);
    const { dialog, user } = await renderPicker();

    expect(await dialog.findByText("Fallo al leer documentos.")).toBeInTheDocument();
    expect(dialog.queryByRole("listbox")).not.toBeInTheDocument();

    respond = () => listResponse([sale(1)]);
    await user.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(await findResults(dialog)).toHaveLength(1);
    expect(dialog.queryByText("Fallo al leer documentos.")).not.toBeInTheDocument();
  });

  describe("teclado", () => {
    it("el foco arranca en el buscador y el primer resultado queda resaltado", async () => {
      const { dialog } = await renderPicker();
      const options = await findResults(dialog);
      const search = dialog.getByRole("combobox", { name: "Buscar documento" });

      expect(search).toHaveFocus();
      expect(options[0]).toHaveAttribute("aria-selected", "true");
      expect(search).toHaveAttribute("aria-activedescendant", options[0].id);
    });

    it("las flechas recorren los resultados sin salirse y Enter elige el resaltado", async () => {
      const { dialog, user } = await renderPicker();
      const options = await findResults(dialog);
      const search = dialog.getByRole("combobox", { name: "Buscar documento" });

      await user.keyboard("{ArrowUp}");
      expect(options[0]).toHaveAttribute("aria-selected", "true");

      await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(options[2]).toHaveAttribute("aria-selected", "true");
      expect(search).toHaveAttribute("aria-activedescendant", options[2].id);

      await user.keyboard("{ArrowUp}{Enter}");

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(sale(2));
    });

    it("Enter con el texto recien tecleado no elige un resultado de la busqueda anterior", async () => {
      const { dialog, user } = await renderPicker();

      await findResults(dialog);
      await user.type(dialog.getByLabelText("Buscar documento"), "polar{Enter}");

      expect(onSelect).not.toHaveBeenCalled();
      await waitFor(() => expect(lastRequest().search).toBe("polar"));
    });
  });

  it("un clic elige el documento con su saldo", async () => {
    const { dialog, user } = await renderPicker();
    const options = await findResults(dialog);

    await user.click(options[2]);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(sale(3));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ pendingRef: 13, pendingVes: 5003 });
  });

  describe("ver mas", () => {
    const allSales = Array.from({ length: 45 }, (_unused, index) => sale(index + 1));

    it("pide mas filas de la misma busqueda y conserva a la vista las ya cargadas", async () => {
      let releaseSecondPage: (() => void) | undefined;

      respond = (query) => {
        const page = listResponse(allSales.slice(0, Number(query.limit)), allSales.length);

        if (query.limit === "20") {
          return page;
        }

        return new Promise<Response>((resolve) => {
          releaseSecondPage = () => resolve(page);
        });
      };
      const { dialog, user } = await renderPicker();

      expect(await findResults(dialog)).toHaveLength(20);
      expect(dialog.getByText("Mostrando 20 de 45")).toBeInTheDocument();

      await user.click(dialog.getByRole("button", { name: "Ver más" }));

      await waitFor(() => expect(lastRequest()).toMatchObject({ limit: "40", skip: "0" }));
      expect(results(dialog)).toHaveLength(20);
      expect(dialog.getByRole("button", { name: "Cargando..." })).toBeDisabled();

      await act(async () => releaseSecondPage?.());

      await waitFor(() => expect(results(dialog)).toHaveLength(40));
      expect(dialog.getByText("Mostrando 40 de 45")).toBeInTheDocument();
    });

    it("sin mas documentos no ofrece «Ver más»", async () => {
      const { dialog } = await renderPicker();

      await findResults(dialog);

      expect(dialog.getByText("Mostrando 3 de 3")).toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
    });

    it("cambiar un filtro vuelve a la primera tanda", async () => {
      respond = (query) =>
        listResponse(allSales.slice(0, Number(query.limit)), allSales.length);
      const { dialog, user } = await renderPicker();

      await findResults(dialog);
      await user.click(dialog.getByRole("button", { name: "Ver más" }));
      await waitFor(() => expect(results(dialog)).toHaveLength(40));

      await user.selectOptions(dialog.getByLabelText("Tipo de documento"), "purchase");

      await waitFor(() => expect(lastRequest()).toMatchObject({ limit: "20", type: "purchase" }));
    });
  });

  it("Cancelar cierra el buscador y al reabrirlo empieza sin filtros", async () => {
    const { dialog, user } = await renderPicker();

    await findResults(dialog);
    await user.type(dialog.getByLabelText("Buscar documento"), "polar");
    await waitFor(() => expect(lastRequest().search).toBe("polar"));
    await user.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Abrir buscador" }));

    const reopened = within(await screen.findByRole("dialog", { name: "Registrar pago" }));

    expect(reopened.getByLabelText("Buscar documento")).toHaveValue("");
    expect(await findResults(reopened)).toHaveLength(3);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
