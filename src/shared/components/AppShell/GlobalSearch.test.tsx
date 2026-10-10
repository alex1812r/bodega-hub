import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { GLOBAL_SEARCH_DEBOUNCE_MS } from "@/modules/search/hooks/useGlobalSearch";
import type { GlobalSearchResults } from "@/modules/search/types";
import type { Permission } from "@/shared/auth/permissions";
import { ProcessGuard } from "@/shared/components/ProcessGuard";

import { GLOBAL_SEARCH_SHORTCUT_SETTLE_MS, GlobalSearch } from "./GlobalSearch";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    push: mockPush,
    refresh: jest.fn(),
    replace: jest.fn(),
  }),
}));

const ALL_PERMISSIONS: Permission[] = [
  "products.view",
  "sales.view",
  "purchases.view",
  "contacts.view",
];

const EMPTY: GlobalSearchResults = { contacts: [], products: [], purchases: [], sales: [] };

const DRILL = { barcode: "7501234567890", id: "prod-drill", name: "Taladro percutor", sku: "her-tal-001" };
const HAMMER = { barcode: null, id: "prod-hammer", name: "Martillo de una", sku: "her-mar-002" };
const SALE = {
  createdAt: "2026-10-09T12:00:00Z",
  customerName: "Ferreteria La Central",
  id: "sale-1",
  number: "V-20261009-000001",
  status: "pagada" as const,
  totalRef: 15,
};
const PURCHASE = {
  createdAt: "2026-10-08T12:00:00Z",
  id: "purchase-1",
  number: "C-20261008-000002",
  status: "recibido" as const,
  supplierName: "Suministros Industriales CA",
  totalRef: 20,
};
const CONTACT = { id: "cont-1", name: "Constructora Horizonte", taxId: "J-00000004-4", type: "cliente" as const };

type FetchCall = { q: string; signal: AbortSignal | undefined };

let fetchCalls: FetchCall[] = [];
let respond: (q: string) => GlobalSearchResults | Promise<GlobalSearchResults> = () => EMPTY;
let failWith: number | null = null;

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function renderSearch(ui: ReactNode = null, permissions: readonly Permission[] = ALL_PERMISSIONS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <header>
        <button type="button">Otro botón</button>
        <GlobalSearch permissions={permissions} />
      </header>
      {ui}
    </QueryClientProvider>,
  );
}

function getInput() {
  return screen.getByRole("combobox", { name: "Búsqueda global" });
}

function type(value: string) {
  fireEvent.focus(getInput());
  fireEvent.change(getInput(), { target: { value } });
}

function pressSlash(target: Element = document.body) {
  return fireEvent.keyDown(target, { key: "/" });
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    fetchCalls = [];
    respond = () => EMPTY;
    failWith = null;
    mockPush.mockClear();
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const q = new URL(String(input), "http://localhost").searchParams.get("q") ?? "";

      fetchCalls.push({ q, signal: init?.signal ?? undefined });

      if (failWith !== null) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, failWith);
      }

      return jsonResponse({ data: await respond(q) });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("is not rendered without any search permission", () => {
    renderSearch(null, ["dashboard.view", "cash.view"]);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir búsqueda" })).not.toBeInTheDocument();
  });

  it("is rendered with a single search permission", () => {
    renderSearch(null, ["purchases.view"]);

    expect(getInput()).toBeInTheDocument();
  });

  describe("atajo /", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it("focuses the search from anywhere outside a field", () => {
      renderSearch();

      const notPrevented = pressSlash();

      expect(notPrevented).toBe(false);
      expect(getInput()).not.toHaveFocus();

      act(() => {
        jest.advanceTimersByTime(GLOBAL_SEARCH_SHORTCUT_SETTLE_MS);
      });

      expect(getInput()).toHaveFocus();
      expect(getInput()).toHaveValue("");
    });

    it("does nothing while typing in an input, textarea, select or contenteditable", () => {
      renderSearch(
        <div>
          <input aria-label="Buscador del POS" />
          <textarea aria-label="Notas" />
          <select aria-label="Estado">
            <option>uno</option>
          </select>
          <div contentEditable data-testid="editable" suppressContentEditableWarning>
            texto
          </div>
        </div>,
      );

      for (const field of [
        screen.getByLabelText("Buscador del POS"),
        screen.getByLabelText("Notas"),
        screen.getByLabelText("Estado"),
        screen.getByTestId("editable"),
      ]) {
        field.focus();

        const notPrevented = pressSlash(field);

        act(() => {
          jest.advanceTimersByTime(1000);
        });

        expect(notPrevented).toBe(true);
        expect(getInput()).not.toHaveFocus();
      }
    });

    it("does nothing with a modal open", () => {
      renderSearch(
        <div aria-modal="true" role="dialog">
          <button type="button">Confirmar</button>
        </div>,
      );

      const notPrevented = pressSlash();

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(notPrevented).toBe(true);
      expect(getInput()).not.toHaveFocus();
    });

    it("does nothing with Ctrl, Meta or Alt", () => {
      renderSearch();

      fireEvent.keyDown(document.body, { ctrlKey: true, key: "/" });
      fireEvent.keyDown(document.body, { key: "/", metaKey: true });
      fireEvent.keyDown(document.body, { altKey: true, key: "/" });

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(getInput()).not.toHaveFocus();
    });

    it("does not capture a scanner burst that starts with /", () => {
      renderSearch();

      pressSlash();

      for (const key of ["7", "5", "0", "1"]) {
        act(() => {
          jest.advanceTimersByTime(8);
        });
        fireEvent.keyDown(document.body, { key });
      }

      fireEvent.keyDown(document.body, { key: "Enter" });

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(getInput()).not.toHaveFocus();
      expect(getInput()).toHaveValue("");
      expect(fetchCalls).toEqual([]);
    });

    it("does not capture a / in the middle of a scanner burst", () => {
      renderSearch();

      for (const key of ["A", "B", "/", "1", "2"]) {
        fireEvent.keyDown(document.body, { key });
        act(() => {
          jest.advanceTimersByTime(120);
        });
      }

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(getInput()).not.toHaveFocus();
    });

    it("returns the focus on Escape and clears the search", () => {
      renderSearch();

      const other = screen.getByRole("button", { name: "Otro botón" });

      other.focus();
      pressSlash(other);
      act(() => {
        jest.advanceTimersByTime(GLOBAL_SEARCH_SHORTCUT_SETTLE_MS);
      });

      expect(getInput()).toHaveFocus();

      fireEvent.change(getInput(), { target: { value: "tal" } });
      fireEvent.keyDown(getInput(), { key: "Escape" });

      expect(other).toHaveFocus();
      expect(getInput()).toHaveValue("");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("opens from the magnifier button and closes with its close button", () => {
    renderSearch();

    const magnifier = screen.getByRole("button", { name: "Abrir búsqueda" });

    magnifier.focus();
    fireEvent.click(magnifier);

    expect(getInput()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Escribe al menos 2 caracteres");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar búsqueda" }));

    expect(magnifier).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asks for two characters and does not query with fewer", () => {
    jest.useFakeTimers();
    renderSearch();

    type("a");

    expect(screen.getByRole("status")).toHaveTextContent("Escribe al menos 2 caracteres");

    act(() => {
      jest.advanceTimersByTime(GLOBAL_SEARCH_DEBOUNCE_MS * 4);
    });

    type("  a  ");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    act(() => {
      jest.advanceTimersByTime(GLOBAL_SEARCH_DEBOUNCE_MS * 4);
    });

    expect(fetchCalls).toEqual([]);
    expect(getInput()).toHaveAttribute("aria-expanded", "false");
  });

  it("debounces typing into a single request", async () => {
    jest.useFakeTimers();
    respond = () => ({ ...EMPTY, products: [DRILL] });
    renderSearch();

    type("ta");
    act(() => {
      jest.advanceTimersByTime(100);
    });
    type("tal");
    act(() => {
      jest.advanceTimersByTime(100);
    });
    type("tala");
    act(() => {
      jest.advanceTimersByTime(GLOBAL_SEARCH_DEBOUNCE_MS - 1);
    });

    expect(fetchCalls).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("Buscando…");

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(fetchCalls.map((call) => call.q)).toEqual(["tala"]);

    jest.useRealTimers();

    expect(await screen.findByRole("option", { name: /Taladro percutor/ })).toBeInTheDocument();
    expect(fetchCalls).toHaveLength(1);
  });

  it("cancels the previous request when the term changes", async () => {
    let releaseFirst: (value: GlobalSearchResults) => void = () => undefined;

    respond = (q) =>
      q === "tala"
        ? new Promise<GlobalSearchResults>((resolve) => {
            releaseFirst = resolve;
          })
        : { ...EMPTY, products: [HAMMER] };
    renderSearch();

    type("tala");
    await waitFor(() => expect(fetchCalls.map((call) => call.q)).toEqual(["tala"]));

    type("martillo");
    await waitFor(() => expect(fetchCalls.map((call) => call.q)).toEqual(["tala", "martillo"]));

    expect(fetchCalls[0].signal?.aborted).toBe(true);

    releaseFirst({ ...EMPTY, products: [DRILL] });

    expect(await screen.findByRole("option", { name: /Martillo de una/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Taladro/ })).not.toBeInTheDocument();
  });

  it("groups results by type and moves through them with the arrow keys", async () => {
    respond = () => ({
      contacts: [CONTACT],
      products: [DRILL, HAMMER],
      purchases: [PURCHASE],
      sales: [SALE],
    });
    renderSearch();

    type("000");

    const listbox = await screen.findByRole("listbox", { name: "Resultados de la búsqueda" });
    const input = getInput();

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(
      within(listbox)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-labelledby"))
        .map((id) => document.getElementById(id ?? "")?.textContent),
    ).toEqual(["Productos", "Ventas", "Compras", "Contactos"]);

    const options = within(listbox).getAllByRole("option");

    expect(options).toHaveLength(5);
    expect(options[2]).toHaveTextContent("V-20261009-000001");
    expect(options[2]).toHaveTextContent("Ferreteria La Central");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", options[4].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/products/prod-hammer");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("goes straight to the product when a scanned barcode + Enter has one exact match", async () => {
    respond = () => ({ ...EMPTY, products: [DRILL, { ...HAMMER, barcode: "75012345678901" }] });
    renderSearch();

    // El lector escribe y manda Enter antes de que haya resultados.
    type("7501234567890");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/products/prod-drill"));
    expect(fetchCalls.map((call) => call.q)).toEqual(["7501234567890"]);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("goes to the product by exact SKU + Enter", async () => {
    respond = () => ({ ...EMPTY, products: [HAMMER, DRILL] });
    renderSearch();

    type("HER-TAL-001");
    await screen.findByRole("listbox");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/products/prod-drill");
  });

  it("goes to the sale by invoice number + Enter", async () => {
    respond = () => ({ ...EMPTY, sales: [SALE, { ...SALE, id: "sale-2", number: "V-20261009-0000011" }] });
    renderSearch();

    type("V-20261009-000001");
    await screen.findByRole("listbox");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/sales/sale-1");
  });

  it("goes to the purchase by purchase number + Enter", async () => {
    respond = () => ({ ...EMPTY, purchases: [PURCHASE] });
    renderSearch();

    type("c-20261008-000002");
    await screen.findByRole("listbox");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/purchases/purchase-1");
  });

  it("goes to the contact by clicking its result", async () => {
    respond = () => ({ ...EMPTY, contacts: [CONTACT] });
    renderSearch();

    type("horizonte");

    const option = await screen.findByRole("option", { name: /Constructora Horizonte/ });

    expect(option).toHaveTextContent("Cliente · J-00000004-4");

    // Sin coincidencia exacta, Enter no elige a ciegas.
    fireEvent.keyDown(getInput(), { key: "Enter" });
    expect(mockPush).not.toHaveBeenCalled();

    const mouseDownNotPrevented = fireEvent.mouseDown(option);

    fireEvent.click(option);

    expect(mouseDownNotPrevented).toBe(false);
    expect(mockPush).toHaveBeenCalledWith("/contacts/cont-1");
  });

  it("does not jump when a partial fragment matches several documents", async () => {
    respond = () => ({ ...EMPTY, purchases: [PURCHASE], sales: [SALE] });
    renderSearch();

    type("2026");
    await screen.findByRole("listbox");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("drops a pending Enter when the text changes before the results arrive", async () => {
    respond = () => ({ ...EMPTY, products: [DRILL] });
    renderSearch();

    type("750123456789");
    fireEvent.keyDown(getInput(), { key: "Enter" });
    type("7501234567890");

    await screen.findByRole("option", { name: /Taladro percutor/ });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("asks the active process guard before leaving", async () => {
    respond = () => ({ ...EMPTY, products: [DRILL] });
    renderSearch(<ProcessGuard active label="Venta en curso" onLeave="discard" />);

    type("7501234567890");
    await screen.findByRole("listbox");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toHaveTextContent("Venta en curso");
  });

  it("renders hostile result text as plain text", async () => {
    const hostile = '<img src=x onerror="window.__pwned = true">';

    respond = () => ({
      ...EMPTY,
      contacts: [{ ...CONTACT, name: "<script>alert(1)</script>", taxId: "<b>J-1</b>" }],
      products: [{ ...DRILL, name: hostile }],
    });

    const { container } = renderSearch();

    type("<img");

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("Cliente · <b>J-1</b>")).toBeInTheDocument();
    expect(container.querySelector("img, script, b")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("shows the empty state with the searched text", async () => {
    renderSearch();

    type('  <b>zz"  ');

    expect(await screen.findByText('Sin resultados para "<b>zz""')).toBeInTheDocument();
    expect(getInput()).toHaveAttribute("aria-expanded", "false");
  });

  it("shows an error when the request fails and recovers on the next search", async () => {
    failWith = 500;
    renderSearch();

    type("taladro");

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo buscar. Intenta de nuevo.");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    failWith = null;
    respond = () => ({ ...EMPTY, products: [HAMMER] });
    type("martillo");

    expect(await screen.findByRole("option", { name: /Martillo de una/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes the results when the field loses focus", async () => {
    respond = () => ({ ...EMPTY, products: [DRILL] });
    renderSearch();

    type("taladro");
    await screen.findByRole("listbox");
    fireEvent.blur(getInput());

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(getInput()).toHaveAttribute("aria-expanded", "false");
  });
});
