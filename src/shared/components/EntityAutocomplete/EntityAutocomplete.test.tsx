import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { ClientApiError } from "@/shared/api/apiFetch";

import { Modal } from "../Modal";
import { EntityAutocomplete, type EntityAutocompleteProps } from "./EntityAutocomplete";
import type {
  ContactEntityOption,
  EntityAutocompleteValue,
  EntityFetcher,
  EntityKind,
  EntityOption,
  ProductEntityOption,
} from "./entityAutocomplete.types";
import { getEntityRecentsStorageKey } from "./entityRecents";

function product(index: number, overrides: Partial<ProductEntityOption> = {}): ProductEntityOption {
  return {
    barcode: `75900000000${index}`,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock: 10 + index,
    id: `p-${index}`,
    isActive: true,
    label: `Producto ${index}`,
    salePriceRef: 1.5 + index,
    sku: `SKU-${index}`,
    ...overrides,
  };
}

function contact(index: number, overrides: Partial<ContactEntityOption> = {}): ContactEntityOption {
  return {
    id: `c-${index}`,
    isActive: true,
    label: `Contacto ${index}`,
    phone: `0414-000000${index}`,
    taxId: `J-1234567${index}`,
    type: "proveedor",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

type HarnessProps<K extends EntityKind> = Omit<
  EntityAutocompleteProps<K>,
  "label" | "onChange" | "value"
> & {
  initialValue?: EntityAutocompleteValue | null;
  label?: string;
  onChange?: (option: EntityOption<K> | null) => void;
};

function Harness<K extends EntityKind>({
  initialValue = null,
  label = "Producto",
  onChange,
  ...props
}: HarnessProps<K>) {
  const [value, setValue] = useState<EntityAutocompleteValue | null>(initialValue);

  return (
    <EntityAutocomplete
      {...props}
      label={label}
      onChange={(option) => {
        setValue(option);
        onChange?.(option);
      }}
      value={value}
    />
  );
}

async function settleMicrotasks() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve();
  }
}

async function flushPromises() {
  await act(settleMicrotasks);
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await settleMicrotasks();
  });
}

function getInput() {
  return screen.getByRole("combobox");
}

function focusInput() {
  act(() => getInput().focus());
}

function type(text: string) {
  focusInput();
  fireEvent.change(getInput(), { target: { value: text } });
}

async function search(text: string) {
  type(text);
  await advance(250);
}

function pressKey(key: string) {
  return fireEvent.keyDown(getInput(), { key });
}

/**
 * Clic de ratón con las acciones por defecto de Chromium, que jsdom no ejecuta
 * (SHR-35). Si `mousedown` no se cancela: con el campo enfocado y texto
 * seleccionado, la selección sigue intacta hasta DESPUÉS de `click` y solo
 * entonces se coloca el cursor; en cualquier otro caso el foco entra y el
 * cursor se coloca ya en `mousedown`. Devuelve si cada evento conservó su
 * acción por defecto.
 */
function browserClick(caret: number) {
  const input = getInput() as HTMLInputElement;
  const hadSelectedText =
    document.activeElement === input && input.selectionStart !== input.selectionEnd;
  const isMouseDownAllowed = fireEvent.mouseDown(input);
  const placesCaretAfterClick = isMouseDownAllowed && hadSelectedText;

  if (isMouseDownAllowed && !placesCaretAfterClick) {
    focusInput();
    input.setSelectionRange(caret, caret);
  }

  const isMouseUpAllowed = fireEvent.mouseUp(input);

  fireEvent.click(input);

  if (placesCaretAfterClick) {
    input.setSelectionRange(caret, caret);
  }

  return { isMouseDownAllowed, isMouseUpAllowed };
}

function activeOptionText() {
  const id = getInput().getAttribute("aria-activedescendant");

  return id ? document.getElementById(id)?.textContent : null;
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("EntityAutocomplete: búsqueda en servidor", () => {
  it("espera el debounce y hace una sola llamada por ráfaga con limit=8", async () => {
    const fetcher = jest.fn<ReturnType<EntityFetcher<"product">>, Parameters<EntityFetcher<"product">>>(
      async () => [product(1)],
    );
    render(<Harness entity="product" fetcher={fetcher} />);

    type("a");
    await advance(100);
    type("ar");
    await advance(100);
    type("arr");
    await advance(249);

    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Buscando...");

    await advance(1);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ exact: false, filters: {}, limit: 8, query: "arr" }),
    );
    expect(screen.getByRole("option", { name: /Producto 1/ })).toBeInTheDocument();
  });

  it("no busca con menos de dos caracteres", async () => {
    const fetcher = jest.fn(async () => [product(1)]);
    render(<Harness entity="product" fetcher={fetcher} />);

    await search("a");

    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByTestId("entity-autocomplete-popup")).not.toBeInTheDocument();
  });

  it("ignora la respuesta obsoleta: la de «ab» no pisa la de «abc»", async () => {
    const first = deferred<ProductEntityOption[]>();
    const second = deferred<ProductEntityOption[]>();
    const signals: AbortSignal[] = [];
    const fetcher: EntityFetcher<"product"> = jest.fn(({ query, signal }) => {
      signals.push(signal);
      return query === "ab" ? first.promise : second.promise;
    });
    render(<Harness entity="product" fetcher={fetcher} />);

    await search("ab");
    await search("abc");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    second.resolve([product(2, { label: "Resultado abc" })]);
    await flushPromises();
    first.resolve([product(1, { label: "Resultado ab" })]);
    await flushPromises();

    expect(screen.getByRole("option", { name: /Resultado abc/ })).toBeInTheDocument();
    expect(screen.queryByText("Resultado ab")).not.toBeInTheDocument();
  });

  it("vuelve a buscar cuando el texto regresa a un valor que otra búsqueda pisó", async () => {
    const fetcher = jest.fn(async ({ query }: { query: string }) =>
      query === "ab" ? [product(1, { label: "Resultado ab" })] : [],
    );
    render(<Harness entity="product" fetcher={fetcher} />);

    await search("ab");
    type("abc");
    pressKey("Enter");
    await flushPromises();
    type("ab");
    await flushPromises();

    expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual(["ab", "abc", "ab"]);
    expect(screen.getByRole("option", { name: /Resultado ab/ })).toBeInTheDocument();
  });

  it("muestra como máximo 8 resultados con SKU · stock · precio REF", async () => {
    const fetcher = jest.fn(async () => Array.from({ length: 12 }, (_, index) => product(index)));
    render(<Harness entity="product" fetcher={fetcher} />);

    await search("prod");

    const options = screen.getAllByRole("option");

    expect(options).toHaveLength(8);
    expect(options[0]).toHaveTextContent("Producto 0");
    expect(options[0]).toHaveTextContent("SKU-0 · Stock 10 · ref 1.50");
  });

  it("muestra tipo · teléfono en contactos", async () => {
    const fetcher = jest.fn(async () => [
      contact(1),
      contact(2, { phone: "", type: "ambos" }),
    ]);
    render(<Harness entity="contact" fetcher={fetcher} label="Proveedor" />);

    await search("cont");

    const options = screen.getAllByRole("option");

    expect(options[0]).toHaveTextContent("Proveedor · 0414-0000001");
    expect(options[1]).toHaveTextContent("Contacto 2Ambos");
  });

  it("admite renderSecondary", async () => {
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1)]}
        renderSecondary={(option) => `Habitual · ${option.sku}`}
      />,
    );

    await search("prod");

    expect(screen.getByRole("option")).toHaveTextContent("Habitual · SKU-1");
    expect(screen.getByRole("option")).not.toHaveTextContent("Stock");
  });

  it("pasa los filtros al fetcher, oculta los excluidos y vuelve a buscar si cambian", async () => {
    const fetcher = jest.fn(async () => [contact(1), contact(2), contact(3, { type: "cliente" })]);
    const { rerender } = render(
      <Harness
        entity="contact"
        fetcher={fetcher}
        filters={{ active: true, excludeIds: ["c-2"], type: ["proveedor", "ambos"] }}
      />,
    );

    await search("cont");

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { active: true, excludeIds: ["c-2"], type: ["proveedor", "ambos"] },
        limit: 8,
        query: "cont",
      }),
    );
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Contacto 1Proveedor · 0414-0000001",
    ]);

    rerender(<Harness entity="contact" fetcher={fetcher} filters={{ type: ["cliente"] }} />);
    await flushPromises();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: { type: ["cliente"] } }),
    );
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Contacto 3");
  });

  it("no vuelve a filtrar por isActive los resultados de contactos: ya lo aplica el BFF", async () => {
    const fetcher = jest.fn(async () => [contact(1), contact(2, { isActive: false })]);
    render(<Harness entity="contact" fetcher={fetcher} filters={{ active: true }} />);

    await search("cont");

    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ filters: { active: true } }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Contacto 1Proveedor · 0414-0000001",
      "Contacto 2Proveedor · 0414-0000002",
    ]);
  });

  it("no repite la búsqueda cuando los filtros llegan como objeto nuevo con el mismo contenido", async () => {
    const fetcher = jest.fn(async () => [product(1)]);
    const { rerender } = render(
      <Harness entity="product" fetcher={fetcher} filters={{ active: true }} />,
    );

    await search("prod");
    rerender(<Harness entity="product" fetcher={fetcher} filters={{ active: true }} />);
    await advance(300);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("EntityAutocomplete: estados", () => {
  it("muestra «Sin resultados para …»", async () => {
    render(<Harness entity="product" fetcher={async () => []} />);

    await search("zzz");

    expect(screen.getByRole("status")).toHaveTextContent("Sin resultados para “zzz”");
    expect(getInput()).toHaveAttribute("aria-expanded", "false");
  });

  it("muestra error.message y reintenta", async () => {
    const fetcher = jest
      .fn<Promise<ProductEntityOption[]>, []>()
      .mockRejectedValueOnce(new Error("Sin conexión con el servidor."))
      .mockResolvedValueOnce([product(1)]);
    render(<Harness entity="product" fetcher={fetcher} />);

    await search("prod");

    expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");

    await advance(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByRole("status")).toHaveTextContent("Buscando...");
    await flushPromises();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("option", { name: /Producto 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("en un 403 muestra el mensaje del servidor sin ofrecer reintento", async () => {
    const fetcher = jest.fn(async () => {
      throw new ClientApiError(403, "FORBIDDEN", "No tienes permiso para ver proveedores.");
    });
    render(<Harness entity="contact" fetcher={fetcher} />);

    await search("cont");

    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso para ver proveedores.");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("deshabilitado no busca, no abre y no ofrece limpiar", async () => {
    const fetcher = jest.fn(async () => [product(1)]);
    window.localStorage.setItem(
      getEntityRecentsStorageKey("product"),
      JSON.stringify([product(1)]),
    );
    render(
      <Harness
        disabled
        entity="product"
        fetcher={fetcher}
        initialValue={{ id: "p-9", label: "Harina PAN" }}
      />,
    );

    expect(getInput()).toBeDisabled();
    expect(getInput()).toHaveValue("Harina PAN");
    expect(screen.queryByRole("button", { name: /Limpiar/ })).not.toBeInTheDocument();

    fireEvent.click(getInput());
    await advance(300);

    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("muestra label, obligatorio, placeholder, error y autoFocus", () => {
    render(
      <Harness
        autoFocus
        entity="contact"
        error="Elige un proveedor."
        label="Proveedor"
        placeholder="Buscar proveedor"
        required
      />,
    );

    const input = screen.getByLabelText("Proveedor *");

    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("placeholder", "Buscar proveedor");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Elige un proveedor.");
  });
});

describe("EntityAutocomplete: valor controlado y limpiar", () => {
  it("muestra la etiqueta del valor y la restaura si se escribe sin elegir", async () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1)]}
        initialValue={{ id: "p-9", label: "Harina PAN" }}
        onChange={onChange}
      />,
    );

    expect(getInput()).toHaveValue("Harina PAN");

    await search("prod");
    expect(getInput()).toHaveValue("prod");

    fireEvent.blur(getInput());

    expect(getInput()).toHaveValue("Harina PAN");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("permite cambiar el valor eligiendo otra opción", async () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1)]}
        initialValue={{ id: "p-9", label: "Harina PAN" }}
        onChange={onChange}
      />,
    );

    await search("prod");
    fireEvent.click(screen.getByRole("option", { name: /Producto 1/ }));

    expect(onChange).toHaveBeenCalledWith(product(1));
    expect(getInput()).toHaveValue("Producto 1");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("el botón de limpiar quita el valor y deja el foco en el campo", () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => []}
        initialValue={{ id: "p-9", label: "Harina PAN" }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(getInput()).toHaveValue("");
    expect(getInput()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Limpiar Producto" })).not.toBeInTheDocument();
  });

  it("limpiar borra el texto escrito sin avisar cuando no había valor", async () => {
    const onChange = jest.fn();
    render(<Harness entity="product" fetcher={async () => [product(1)]} onChange={onChange} />);

    await search("prod");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));

    expect(getInput()).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("EntityAutocomplete: recientes", () => {
  it("ofrece los últimos seleccionados al enfocar con el campo vacío", async () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1), product(2)]}
        onChange={onChange}
      />,
    );

    focusInput();
    expect(screen.queryByText("Recientes")).not.toBeInTheDocument();

    await search("prod");
    fireEvent.click(screen.getByRole("option", { name: /Producto 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));

    expect(screen.getByText("Recientes")).toBeInTheDocument();

    const recent = screen.getByRole("option", { name: /Producto 2/ });

    // El stock y el precio guardados pueden estar viejos: solo se muestra el SKU.
    expect(recent).toHaveTextContent("Producto 2SKU-2");
    expect(recent).not.toHaveTextContent("Stock");
    expect(getInput()).not.toHaveAttribute("aria-activedescendant");

    fireEvent.click(recent);
    expect(onChange).toHaveBeenLastCalledWith(product(2));
  });

  it("separa los recientes por entidad y por recentsKey, y les aplica los filtros", () => {
    window.localStorage.setItem(
      getEntityRecentsStorageKey("contact", "compras"),
      JSON.stringify([contact(1), contact(2, { type: "cliente" })]),
    );
    window.localStorage.setItem(
      getEntityRecentsStorageKey("contact"),
      JSON.stringify([contact(3)]),
    );
    render(
      <Harness
        entity="contact"
        fetcher={async () => []}
        filters={{ type: ["proveedor", "ambos"] }}
        recentsKey="compras"
      />,
    );

    focusInput();

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Contacto 1Proveedor · 0414-0000001",
    ]);
  });

  it("recentsKey={null} desactiva los recientes: ni los ofrece ni guarda la elección", async () => {
    const scanned = product(1, { barcode: "7590000000001" });

    window.localStorage.setItem(
      getEntityRecentsStorageKey("product"),
      JSON.stringify([product(7)]),
    );
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [scanned]}
        onChange={onChange}
        recentsKey={null}
      />,
    );

    focusInput();

    expect(screen.queryByText("Recientes")).not.toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();

    await search("prod");
    fireEvent.click(screen.getByRole("option", { name: /Producto 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));

    // También el escaneo que elige por coincidencia exacta de código.
    type("7590000000001");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).toHaveBeenLastCalledWith(scanned);

    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));

    expect(screen.queryByText("Recientes")).not.toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem(getEntityRecentsStorageKey("product")) ?? "[]"),
    ).toEqual([product(7)]);
  });

  it("sigue filtrando por isActive los contactos recientes guardados en el navegador", () => {
    window.localStorage.setItem(
      getEntityRecentsStorageKey("contact"),
      JSON.stringify([contact(1, { isActive: false }), contact(2)]),
    );
    render(<Harness entity="contact" fetcher={async () => []} filters={{ active: true }} />);

    focusInput();

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Contacto 2Proveedor · 0414-0000002",
    ]);
  });

  it("guarda como máximo 8 recientes, el último primero y sin duplicados", async () => {
    const all = Array.from({ length: 10 }, (_, index) => product(index));
    window.localStorage.setItem(getEntityRecentsStorageKey("product"), JSON.stringify(all.slice(0, 8)));
    render(<Harness entity="product" fetcher={async () => [product(3), product(9)]} />);

    await search("prod");
    fireEvent.click(screen.getByRole("option", { name: /Producto 9/ }));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));
    await search("prod");
    fireEvent.click(screen.getByRole("option", { name: /Producto 3/ }));

    const stored = JSON.parse(
      window.localStorage.getItem(getEntityRecentsStorageKey("product")) ?? "[]",
    ) as ProductEntityOption[];

    expect(stored.map((item) => item.id)).toEqual([
      "p-3", "p-9", "p-0", "p-1", "p-2", "p-4", "p-5", "p-6",
    ]);
  });

  it("tolera el storage bloqueado: sin recientes y la selección sigue funcionando", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const onChange = jest.fn();
    render(<Harness entity="product" fetcher={async () => [product(1)]} onChange={onChange} />);

    focusInput();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await search("prod");
    fireEvent.click(screen.getByRole("option", { name: /Producto 1/ }));

    expect(onChange).toHaveBeenCalledWith(product(1));
  });

  it.each([
    ["JSON roto", "{{no-json"],
    ["no es una lista", JSON.stringify({ id: "p-1" })],
    ["elementos con otra forma", JSON.stringify([{ id: 1 }, null, "x", { id: "p-1", label: "Solo" }])],
  ])("tolera el storage corrupto (%s)", (_name, raw) => {
    window.localStorage.setItem(getEntityRecentsStorageKey("product"), raw);
    render(<Harness entity="product" fetcher={async () => []} />);

    focusInput();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("EntityAutocomplete: lector de barras y Enter", () => {
  it("Enter tras la ráfaga busca de inmediato y elige la coincidencia exacta de código de barras", async () => {
    const onChange = jest.fn();
    const scanned = product(5, { barcode: "7591234567890", label: "Arroz 1kg" });
    const fetcher = jest.fn(async () => [product(4, { barcode: "75912345678901" }), scanned]);
    render(<Harness entity="product" fetcher={fetcher} onChange={onChange} />);

    type("7591234567890");
    pressKey("Enter");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ exact: true, limit: 8, query: "7591234567890" }),
    );

    await flushPromises();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(scanned);

    await advance(500);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("Enter elige la coincidencia exacta de SKU sin distinguir mayúsculas", async () => {
    const onChange = jest.fn();
    const fetcher = jest.fn(async () => [
      product(1, { sku: "ARR-10" }),
      product(2, { sku: "ARR-1" }),
    ]);
    render(<Harness entity="product" fetcher={fetcher} onChange={onChange} />);

    type("arr-1");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "p-2" }));
  });

  it("Enter con el texto no envía el formulario que contiene el campo", async () => {
    render(<Harness entity="product" fetcher={async () => []} />);

    type("759");

    expect(pressKey("Enter")).toBe(false);
    await flushPromises();
  });

  it("Enter de escaneo con un único resultado no exacto no lo elige: deja la lista abierta", async () => {
    const onChange = jest.fn();
    const onNotFound = jest.fn();
    const trap = product(1, { barcode: "7591111111111", label: "Caja x12 ref 7599999999999" });
    render(
      <Harness
        entity="product"
        fetcher={async () => [trap]}
        onChange={onChange}
        onNotFound={onNotFound}
      />,
    );

    type("7599999999999");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
    expect(getInput()).toHaveValue("7599999999999");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Caja x12 ref 7599999999999");
  });

  it("Enter de escaneo no elige el único producto cuyo código solo contiene el texto leído", async () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1, { barcode: "7590000001234" })]}
        onChange={onChange}
      />,
    );

    type("0000001234");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("Enter con la lista cerrada (Esc) y un único resultado no exacto la reabre sin elegir", async () => {
    const onChange = jest.fn();
    render(<Harness entity="product" fetcher={async () => [product(1)]} onChange={onChange} />);

    await search("prod");
    pressKey("Escape");
    pressKey("Enter");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("la coincidencia exacta de código de barras no distingue mayúsculas ni espacios alrededor", async () => {
    const onChange = jest.fn();
    const scanned = product(1, { barcode: " Abc-123 " });
    render(
      <Harness
        entity="product"
        fetcher={async () => [scanned, product(2)]}
        onChange={onChange}
      />,
    );

    type(" abc-123 ");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).toHaveBeenCalledWith(scanned);
  });

  it("en contactos Enter solo elige con el RIF exacto, no por ser el único resultado", async () => {
    const onChange = jest.fn();
    const supplier = contact(1, { taxId: "J-12345671" });

    render(
      <EntityAutocomplete
        entity="contact"
        fetcher={async () => [supplier]}
        label="Proveedor"
        onChange={onChange}
        value={null}
      />,
    );

    type("J-1234567");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")).toHaveLength(1);

    type("j-12345671");
    pressKey("Enter");
    await flushPromises();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(supplier);
  });

  it("el texto de un escaneo sin resolver queda seleccionado: el siguiente escaneo lo reemplaza", async () => {
    render(<Harness entity="product" fetcher={async () => []} />);

    type("7599999999999");
    pressKey("Enter");
    await flushPromises();

    const input = getInput() as HTMLInputElement;

    expect(input).toHaveValue("7599999999999");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 13]);
  });

  it("Enter inmediato con varias coincidencias parciales y ninguna exacta no elige: abre la lista", async () => {
    const onChange = jest.fn();
    const onNotFound = jest.fn();
    const partial = Array.from({ length: 8 }, (_, index) =>
      product(index, { barcode: `759100000000${index}` }),
    );
    const fetcher = jest.fn(async () => partial);
    render(
      <Harness entity="product" fetcher={fetcher} onChange={onChange} onNotFound={onNotFound} />,
    );

    type("75910000000");
    pressKey("Enter");
    await flushPromises();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
    expect(getInput()).toHaveValue("75910000000");
    expect(screen.getAllByRole("option")).toHaveLength(8);

    // Un Enter suelto sobre el escaneo a la vista no elige (SHR-33 B1b);
    // resaltar una opción con las flechas, sí.
    pressKey("Enter");

    expect(onChange).not.toHaveBeenCalled();

    pressKey("ArrowDown");
    pressKey("Enter");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(partial[0]);
  });

  it("Enter con la lista cerrada (Esc) y varias coincidencias sin exacta la reabre sin elegir", async () => {
    const onChange = jest.fn();
    const onNotFound = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1), product(2)]}
        onChange={onChange}
        onNotFound={onNotFound}
      />,
    );

    await search("prod");
    pressKey("Escape");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    pressKey("Enter");

    expect(onChange).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("Enter con la lista ya visible elige la opción resaltada por defecto", async () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1), product(2), product(3)]}
        onChange={onChange}
      />,
    );

    await search("prod");
    expect(activeOptionText()).toContain("Producto 1");

    pressKey("Enter");

    expect(onChange).toHaveBeenCalledWith(product(1));
  });

  it("Enter con varios resultados elige el resaltado", async () => {
    const onChange = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1), product(2), product(3)]}
        onChange={onChange}
      />,
    );

    await search("prod");
    expect(activeOptionText()).toContain("Producto 1");

    pressKey("ArrowDown");
    pressKey("ArrowDown");
    expect(activeOptionText()).toContain("Producto 3");

    pressKey("Enter");

    expect(onChange).toHaveBeenCalledWith(product(3));
  });

  it("llama a onNotFound cuando el Enter no encuentra nada", async () => {
    const onChange = jest.fn();
    const onNotFound = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => []}
        onChange={onChange}
        onNotFound={onNotFound}
      />,
    );

    type("7599999999999");
    pressKey("Enter");
    await flushPromises();

    expect(onNotFound).toHaveBeenCalledTimes(1);
    expect(onNotFound).toHaveBeenCalledWith("7599999999999");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Sin resultados para “7599999999999”");

    // Una sola vez por escaneo: un Enter suelto no repite el aviso (SHR-33 B1c).
    pressKey("Enter");
    expect(onNotFound).toHaveBeenCalledTimes(1);
  });

  it("no elige una coincidencia exacta deshabilitada y muestra el motivo", async () => {
    const onChange = jest.fn();
    const onNotFound = jest.fn();
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1, { barcode: "759" }), product(2)]}
        getOptionDisabled={(option) => (option.id === "p-1" ? "Ya está en la compra" : null)}
        onChange={onChange}
        onNotFound={onNotFound}
      />,
    );

    type("759");
    pressKey("Enter");
    await flushPromises();

    const blocked = screen.getByRole("option", { name: /Producto 1/ });

    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveTextContent("Ya está en la compra");

    fireEvent.click(blocked);

    expect(onChange).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
  });

  /** El lector reemplaza el texto seleccionado tecla a tecla y pulsa Enter. */
  function rescan(code: string) {
    for (let length = 1; length <= code.length; length += 1) {
      type(code.slice(0, length));
    }

    return pressKey("Enter");
  }

  it.each([
    ["solo aparece en el nombre de un producto", "7599999999999", [
      product(1, { barcode: "7591111111111", label: "Caja x12 ref 7599999999999" }),
    ]],
    ["es subcadena de un código", "0000001234", [product(1, { barcode: "7590000001234" })]],
    ["coincide a medias con varios", "75910000000", [
      product(1, { barcode: "7591000000001" }),
      product(2, { barcode: "7591000000002" }),
    ]],
  ])(
    "repetir el escaneo de un código que %s sigue sin elegir (SHR-21 N1)",
    async (_name, code, items) => {
      const onChange = jest.fn();
      render(<Harness entity="product" fetcher={async () => items} onChange={onChange} />);

      type(code);
      pressKey("Enter");
      await flushPromises();

      expect(getInput()).toHaveValue(code);
      expect(screen.getAllByRole("option")).toHaveLength(items.length);

      rescan(code);
      await flushPromises();
      rescan(code);
      await advance(500);

      expect(onChange).not.toHaveBeenCalled();
      expect(getInput()).toHaveValue(code);
      expect(screen.getAllByRole("option")).toHaveLength(items.length);

      // Resaltar una opción con las flechas sí es una elección.
      pressKey("ArrowDown");
      pressKey("Enter");

      expect(onChange).toHaveBeenCalledTimes(1);
    },
  );

  it("repetir el escaneo de un código que ahora sí es exacto lo elige (SHR-21 N1)", async () => {
    const onChange = jest.fn();
    const scanned = product(2, { barcode: "0000001234" });
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1, { barcode: "7590000001234" }), scanned]}
        onChange={onChange}
      />,
    );

    await search("00000012");
    rescan("0000001234");
    await flushPromises();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(scanned);
  });

  it("un segundo Enter con el escaneo todavía buscando no envía el formulario (SHR-21 N2)", async () => {
    const pending = deferred<ProductEntityOption[]>();
    const onChange = jest.fn();
    const scanned = product(1, { barcode: "7590000000100" });
    render(<Harness entity="product" fetcher={() => pending.promise} onChange={onChange} />);

    type("7590000000100");

    expect(pressKey("Enter")).toBe(false);
    expect(getInput()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Buscando...");

    // Sufijo CR LF del lector, o el cajero que insiste.
    expect(pressKey("Enter")).toBe(false);
    expect(pressKey("Enter")).toBe(false);

    pending.resolve([scanned]);
    await flushPromises();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(scanned);
  });

  it("Enter con el campo vacío y sin escaneos pendientes deja pasar el envío del formulario", async () => {
    render(
      <EntityAutocomplete
        entity="product"
        fetcher={async () => []}
        label="Producto"
        onChange={jest.fn()}
        value={null}
      />,
    );

    focusInput();
    expect(pressKey("Enter")).toBe(true);

    type("7599999999999");
    pressKey("Enter");
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));

    expect(getInput()).toHaveValue("");
    expect(pressKey("Enter")).toBe(true);
  });
});

describe("EntityAutocomplete: escaneos seguidos", () => {
  const codeA = "7590000000100";
  const codeB = "7590000000200";
  const productA = product(1, { barcode: codeA, label: "Producto A" });
  const productB = product(2, { barcode: codeB, label: "Producto B" });
  const catalog = [productA, productB];

  /** Servidor con latencia: responde por código exacto pasados `latencyFor(query)` ms. */
  function slowFetcher(latencyFor: (query: string) => number, failing: string[] = []) {
    return jest.fn<ReturnType<EntityFetcher<"product">>, Parameters<EntityFetcher<"product">>>(
      ({ query }) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (failing.includes(query)) {
              reject(new Error("Sin conexión con el servidor."));
            } else {
              resolve(catalog.filter((item) => item.barcode === query));
            }
          }, latencyFor(query));
        }),
    );
  }

  /** Como el POS: cada elección agrega una línea y el campo sigue sin valor. */
  function renderScanner(fetcher: EntityFetcher<"product">) {
    const onChange = jest.fn();
    const onNotFound = jest.fn();

    render(
      <EntityAutocomplete
        entity="product"
        fetcher={fetcher}
        label="Producto"
        onChange={onChange}
        onNotFound={onNotFound}
        value={null}
      />,
    );

    return { onChange, onNotFound };
  }

  /** El lector escribe a continuación de lo que haya en el campo y pulsa Enter. */
  function scan(code: string) {
    type((getInput() as HTMLInputElement).value + code);
    pressKey("Enter");
  }

  it.each([150, 400])(
    "dos escaneos con %i ms de pausa y el servidor a 600 ms eligen los dos, en orden",
    async (gap) => {
      const fetcher = slowFetcher(() => 600);
      const { onChange, onNotFound } = renderScanner(fetcher);

      scan(codeA);
      expect(getInput()).toHaveValue("");

      await advance(gap);
      scan(codeB);
      expect(getInput()).toHaveValue("");

      await advance(2000);

      expect(fetcher.mock.calls.map(([params]) => [params.query, params.exact])).toEqual([
        [codeA, true],
        [codeB, true],
      ]);
      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-1", "p-2"]);
      expect(onNotFound).not.toHaveBeenCalled();
      expect(getInput()).toHaveValue("");
    },
  );

  it("mantiene el orden de los escaneos aunque el primero responda después del segundo", async () => {
    const { onChange } = renderScanner(slowFetcher((query) => (query === codeA ? 1500 : 50)));

    scan(codeA);
    await advance(100);
    scan(codeB);
    await advance(1000);

    expect(onChange).not.toHaveBeenCalled();

    await advance(1000);

    expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-1", "p-2"]);
  });

  it("cada escaneo termina con su propio código: el desconocido en onNotFound y el otro elegido", async () => {
    const { onChange, onNotFound } = renderScanner(slowFetcher(() => 600));

    scan("0000000000000");
    await advance(150);
    scan(codeB);
    await advance(2000);

    expect(onNotFound.mock.calls).toEqual([["0000000000000"]]);
    expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
  });

  it("un escaneo que falla mientras llega el siguiente se avisa con su código y no frena al otro", async () => {
    const { onChange, onNotFound } = renderScanner(slowFetcher(() => 600, [codeA]));

    scan(codeA);
    await advance(150);
    scan(codeB);
    await advance(2000);

    expect(onNotFound.mock.calls).toEqual([[codeA]]);
    expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
  });

  it("la respuesta del primer escaneo no borra el segundo a medio leer", async () => {
    const { onChange } = renderScanner(slowFetcher(() => 600));

    scan(codeA);
    await advance(500);
    type((getInput() as HTMLInputElement).value + codeB.slice(0, 6));
    await advance(200);

    expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-1"]);
    expect(getInput()).toHaveValue(codeB.slice(0, 6));

    type(codeB);
    pressKey("Enter");
    await advance(700);

    expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-1", "p-2"]);
  });

  it("usa el onChange vigente cuando responde un escaneo lento", async () => {
    const first = jest.fn();
    const latest = jest.fn();
    const fetcher = slowFetcher(() => 600);
    const { rerender } = render(
      <EntityAutocomplete entity="product" fetcher={fetcher} label="Producto" onChange={first} value={null} />,
    );

    scan(codeA);
    rerender(
      <EntityAutocomplete entity="product" fetcher={fetcher} label="Producto" onChange={latest} value={null} />,
    );
    await advance(700);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(productA);
  });

  it("mientras un escaneo espera respuesta el campo vacío muestra «Buscando...»", async () => {
    renderScanner(slowFetcher(() => 600));

    scan(codeA);

    expect(getInput()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Buscando...");

    await advance(700);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("un escaneo con error y sin otro detrás vuelve al campo con el error y Reintentar", async () => {
    const { onChange, onNotFound } = renderScanner(slowFetcher(() => 100, [codeA]));

    scan(codeA);
    await advance(200);

    expect(getInput()).toHaveValue(codeA);
    expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(onNotFound).not.toHaveBeenCalled();
  });

  describe("elección del usuario con un escaneo en vuelo (SHR-21 N3)", () => {
    /** Escaneo (exacto) a 1500 ms; búsqueda por nombre a 50 ms. */
    function scanSlowListFast() {
      return jest.fn<ReturnType<EntityFetcher<"product">>, Parameters<EntityFetcher<"product">>>(
        ({ exact, query, signal }) =>
          new Promise((resolve, reject) => {
            setTimeout(
              () => {
                if (signal.aborted) {
                  reject(new DOMException("Aborted", "AbortError"));
                } else {
                  resolve(
                    catalog.filter((item) =>
                      exact ? item.barcode === query : item.label.includes(query),
                    ),
                  );
                }
              },
              exact ? 1500 : 50,
            );
          }),
      );
    }

    function renderSingleSelect(initialValue: EntityAutocompleteValue | null = null) {
      const onChange = jest.fn();
      const onNotFound = jest.fn();
      const fetcher = scanSlowListFast();

      render(
        <Harness
          entity="product"
          fetcher={fetcher}
          initialValue={initialValue}
          onChange={onChange}
          onNotFound={onNotFound}
        />,
      );

      return { fetcher, onChange, onNotFound };
    }

    it("elegir otra opción con flecha + Enter cancela el escaneo lento: gana la elección", async () => {
      const { fetcher, onChange, onNotFound } = renderSingleSelect();

      scan(codeA);
      await advance(100);
      await search("Producto B");
      await advance(100);
      pressKey("ArrowDown");
      pressKey("Enter");

      expect(onChange.mock.calls.map(([option]) => option?.id)).toEqual(["p-2"]);

      await advance(3000);

      expect(onChange.mock.calls.map(([option]) => option?.id)).toEqual(["p-2"]);
      expect(fetcher.mock.calls[0][0].signal.aborted).toBe(true);
      expect(onNotFound).not.toHaveBeenCalled();
      expect(getInput()).toHaveValue("Producto B");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("elegir otra opción con un clic cancela el escaneo lento", async () => {
      const { onChange } = renderSingleSelect();

      scan(codeA);
      await advance(100);
      await search("Producto B");
      await advance(100);
      fireEvent.click(screen.getByRole("option", { name: /Producto B/ }));
      await advance(3000);

      expect(onChange.mock.calls.map(([option]) => option?.id)).toEqual(["p-2"]);
      expect(getInput()).toHaveValue("Producto B");
    });

    it("el botón de limpiar cancela el escaneo lento: el campo queda vacío", async () => {
      const { onChange, onNotFound } = renderSingleSelect({ id: "p-2", label: "Producto B" });

      type(codeA);
      pressKey("Enter");
      await advance(100);
      fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));
      await advance(3000);

      expect(onChange.mock.calls).toEqual([[null]]);
      expect(onNotFound).not.toHaveBeenCalled();
      expect(getInput()).toHaveValue("");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("tras cancelar, el siguiente escaneo se resuelve con normalidad", async () => {
      const { onChange } = renderScanner(scanSlowListFast());

      scan(codeA);
      await advance(100);
      await search("Producto B");
      await advance(100);
      fireEvent.click(screen.getByRole("option", { name: /Producto B/ }));
      scan(codeA);

      expect(screen.getByRole("status")).toHaveTextContent("Buscando...");

      await advance(1600);

      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2", "p-1"]);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("teclear o borrar sin elegir no cancela el escaneo ya enviado", async () => {
      const { onChange } = renderSingleSelect();

      scan(codeA);
      await advance(100);
      type("Prod");
      type("");
      pressKey("Escape");
      await advance(3000);

      expect(onChange.mock.calls.map(([option]) => option?.id)).toEqual(["p-1"]);
    });
  });

  describe("escaneo devuelto al campo y desplazado por el siguiente (SHR-25)", () => {
    const partialCode = "75900000";
    const otherPartialCode = "759000000";
    const failingCode = "7590000000999";

    /** A 100 ms: código exacto si `exact`; si no, por trozo de código o de nombre. */
    function partialFetcher() {
      return jest.fn<ReturnType<EntityFetcher<"product">>, Parameters<EntityFetcher<"product">>>(
        ({ query }) =>
          new Promise((resolve, reject) => {
            setTimeout(() => {
              if (query === failingCode) {
                reject(new Error("Sin conexión con el servidor."));
              } else {
                resolve(
                  catalog.filter(
                    (item) => item.barcode?.includes(query) || item.label.includes(query),
                  ),
                );
              }
            }, 100);
          }),
      );
    }

    /** El lector reemplaza el texto seleccionado del campo tecla a tecla y pulsa Enter. */
    function scanOver(code: string) {
      for (let length = 1; length <= code.length; length += 1) {
        type(code.slice(0, length));
      }

      pressKey("Enter");
    }

    /** Escaneo sin coincidencia exacta: vuelve al campo, seleccionado, con su lista. */
    async function scanShownInField(code: string, optionCount: number) {
      scanOver(code);
      await advance(200);

      expect(getInput()).toHaveValue(code);
      expect(screen.getAllByRole("option")).toHaveLength(optionCount);
    }

    it("el siguiente escaneo avisa con el código parcial que pisa, una sola vez", async () => {
      const { onChange, onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);

      expect(onNotFound).not.toHaveBeenCalled();

      scanOver(codeB);

      expect(onNotFound.mock.calls).toEqual([[partialCode]]);

      await advance(200);
      scanOver(codeA);
      await advance(200);

      expect(onNotFound.mock.calls).toEqual([[partialCode]]);
      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2", "p-1"]);
    });

    it("dos parciales seguidos y un tercero: cada parcial se avisa al ser pisado", async () => {
      const { onChange, onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);
      await scanShownInField(otherPartialCode, 2);

      expect(onNotFound.mock.calls).toEqual([[partialCode]]);

      scanOver(codeB);
      await advance(200);

      expect(onNotFound.mock.calls).toEqual([[partialCode], [otherPartialCode]]);
      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
    });

    it("el siguiente escaneo avisa con el código que volvió al campo con un error", async () => {
      const { onChange, onNotFound } = renderScanner(partialFetcher());

      scanOver(failingCode);
      await advance(200);

      expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión con el servidor.");
      expect(onNotFound).not.toHaveBeenCalled();

      scanOver(codeB);
      await advance(200);

      expect(onNotFound.mock.calls).toEqual([[failingCode]]);
      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
    });

    it("repetir el escaneo del mismo código no avisa: sigue a la vista", async () => {
      const { onChange, onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);
      await scanShownInField(partialCode, 2);

      scanOver(failingCode);
      await advance(200);
      scanOver(failingCode);
      await advance(200);

      expect(onNotFound.mock.calls).toEqual([[partialCode]]);
      expect(onChange).not.toHaveBeenCalled();
      expect(getInput()).toHaveValue(failingCode);
    });

    it("un código sin resultados ya se avisó al responder: el siguiente escaneo no lo repite", async () => {
      const { onNotFound } = renderScanner(partialFetcher());

      scanOver("0000000000000");
      await advance(200);
      scanOver(codeB);
      await advance(200);

      expect(onNotFound.mock.calls).toEqual([["0000000000000"]]);
    });

    it("si el usuario elige una opción de la lista, el siguiente escaneo no avisa", async () => {
      const { onChange, onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);
      fireEvent.click(screen.getByRole("option", { name: /Producto A/ }));
      scanOver(codeB);
      await advance(200);

      expect(onNotFound).not.toHaveBeenCalled();
      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-1", "p-2"]);
    });

    it("si el usuario limpia el campo con el botón, el siguiente escaneo no avisa", async () => {
      const { onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);
      fireEvent.click(screen.getByRole("button", { name: "Limpiar Producto" }));
      scanOver(codeB);
      await advance(200);

      expect(onNotFound).not.toHaveBeenCalled();
    });

    it("si el usuario borra el texto a mano, el siguiente escaneo no avisa", async () => {
      const { onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);
      type("");
      scanOver(codeB);
      await advance(200);

      expect(onNotFound).not.toHaveBeenCalled();
    });

    it("si el usuario corrige el texto a mano y pulsa Enter, no avisa con el código anterior", async () => {
      const { onChange, onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);

      // Dos clics seguidos al final (el primero conserva la selección, SHR-33;
      // el segundo deja el cursor) y completa el código tecla a tecla.
      const input = getInput() as HTMLInputElement;
      const missingDigits = codeB.slice(partialCode.length);

      browserClick(partialCode.length);
      browserClick(partialCode.length);

      expect([input.selectionStart, input.selectionEnd]).toEqual([
        partialCode.length,
        partialCode.length,
      ]);

      for (let length = 1; length <= missingDigits.length; length += 1) {
        pressKey(missingDigits[length - 1]);
        type(partialCode + missingDigits.slice(0, length));
      }

      pressKey("Enter");
      await advance(200);

      expect(onNotFound).not.toHaveBeenCalled();
      expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
    });

    it("si el usuario escribe otra búsqueda y ve sus resultados, el siguiente escaneo no avisa", async () => {
      const { onNotFound } = renderScanner(partialFetcher());

      await scanShownInField(partialCode, 2);
      await search("Producto B");
      await advance(200);

      expect(screen.getAllByRole("option")).toHaveLength(1);

      scanOver(codeA);
      await advance(200);

      expect(onNotFound).not.toHaveBeenCalled();
    });

    describe("todo Enter que no elige deja su texto seleccionado (SHR-31)", () => {
      function selection() {
        const input = getInput() as HTMLInputElement;

        return [input.selectionStart, input.selectionEnd];
      }

      /**
       * Como el navegador: cada tecla sustituye lo seleccionado o se inserta en
       * el cursor (`fireEvent.change` por sí solo pisaría el campo entero).
       */
      function readerScan(code: string) {
        const input = getInput() as HTMLInputElement;

        focusInput();

        for (const key of code) {
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;

          pressKey(key);
          fireEvent.change(input, {
            target: { value: input.value.slice(0, start) + key + input.value.slice(end) },
          });
        }

        pressKey("Enter");
      }

      it("parcial, el mismo parcial otra vez y un exacto: el exacto se elige y el parcial se avisa una vez", async () => {
        const fetcher = partialFetcher();
        const { onChange, onNotFound } = renderScanner(fetcher);

        readerScan(partialCode);
        await advance(200);

        expect(getInput()).toHaveValue(partialCode);
        expect(selection()).toEqual([0, partialCode.length]);

        readerScan(partialCode);
        await advance(200);

        expect(onChange).not.toHaveBeenCalled();
        expect(onNotFound).not.toHaveBeenCalled();
        expect(getInput()).toHaveValue(partialCode);
        expect(screen.getAllByRole("option")).toHaveLength(2);
        expect(selection()).toEqual([0, partialCode.length]);

        readerScan(codeB);
        await advance(200);

        expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual([partialCode, codeB]);
        expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
        expect(onNotFound.mock.calls).toEqual([[partialCode]]);
        expect(getInput()).toHaveValue("");
      });

      it("el mismo parcial tres veces y otro parcial: se avisa una sola vez", async () => {
        const { onChange, onNotFound } = renderScanner(partialFetcher());

        for (let pass = 0; pass < 3; pass += 1) {
          readerScan(partialCode);
          await advance(200);

          expect(selection()).toEqual([0, partialCode.length]);
        }

        readerScan(otherPartialCode);
        await advance(200);

        expect(onNotFound.mock.calls).toEqual([[partialCode]]);
        expect(onChange).not.toHaveBeenCalled();
        expect(getInput()).toHaveValue(otherPartialCode);
        expect(selection()).toEqual([0, otherPartialCode.length]);
      });

      it("Enter sobre «Sin resultados» ya cargado: avisa, queda seleccionado y el siguiente escaneo no lo repite", async () => {
        const unknownCode = "0000000000000";
        const fetcher = partialFetcher();
        const { onChange, onNotFound } = renderScanner(fetcher);

        await search(unknownCode);
        await advance(200);

        expect(screen.getByRole("status")).toHaveTextContent("Sin resultados");

        pressKey("Enter");

        expect(onNotFound.mock.calls).toEqual([[unknownCode]]);
        expect(selection()).toEqual([0, unknownCode.length]);

        readerScan(codeB);
        await advance(200);

        expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual([unknownCode, codeB]);
        expect(onNotFound.mock.calls).toEqual([[unknownCode]]);
        expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
      });

      it("Enter con la lista cerrada (Esc) la reabre con el texto seleccionado y el siguiente escaneo lo avisa", async () => {
        const fetcher = partialFetcher();
        const { onChange, onNotFound } = renderScanner(fetcher);

        await search(partialCode);
        await advance(200);
        pressKey("Escape");
        pressKey("Enter");

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getAllByRole("option")).toHaveLength(2);
        expect(selection()).toEqual([0, partialCode.length]);

        readerScan(codeB);
        await advance(200);

        expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual([partialCode, codeB]);
        expect(onNotFound.mock.calls).toEqual([[partialCode]]);
        expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
      });

      it.each([
        ["la coincidencia exacta está deshabilitada", codeA, ["p-1"]],
        ["todas las opciones a la vista están deshabilitadas", partialCode, ["p-1", "p-2"]],
      ])(
        "Enter con los resultados cargados cuando %s: no elige, queda seleccionado y el siguiente escaneo lo avisa",
        async (_name, code, disabledIds) => {
          const fetcher = partialFetcher();
          const onChange = jest.fn();
          const onNotFound = jest.fn();

          render(
            <EntityAutocomplete
              entity="product"
              fetcher={fetcher}
              getOptionDisabled={(option) =>
                disabledIds.includes(option.id) ? "Ya está en la compra" : null
              }
              label="Producto"
              onChange={onChange}
              onNotFound={onNotFound}
              value={null}
            />,
          );

          await search(code);
          await advance(200);
          pressKey("Enter");

          expect(onChange).not.toHaveBeenCalled();
          expect(onNotFound).not.toHaveBeenCalled();
          expect(getInput()).toHaveValue(code);
          expect(screen.getAllByText("Ya está en la compra")).toHaveLength(disabledIds.length);
          expect(selection()).toEqual([0, code.length]);

          readerScan(otherPartialCode);
          await advance(200);

          expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual([
            code,
            otherPartialCode,
          ]);
          expect(onNotFound.mock.calls).toEqual([[code]]);
        },
      );

      describe("escaneo a la vista: clic, Enter suelto y resaltado (SHR-33)", () => {
        const unknownCode = "1110000000009";

        function clickAwayAndBack(caret: number) {
          act(() => getInput().blur());
          browserClick(caret);
        }

        function highlightedOptions() {
          return screen
            .getAllByRole("option")
            .filter((option) => option.getAttribute("aria-selected") === "true");
        }

        it.each([
          ["al final del campo ya enfocado", () => browserClick(partialCode.length)],
          ["sobre el texto del campo ya enfocado", () => browserClick(0)],
          ["fuera y de vuelta en el campo", () => clickAwayAndBack(partialCode.length)],
        ])(
          "N1: un clic %s conserva la selección y el siguiente escaneo no se concatena",
          async (_name, click) => {
            const fetcher = partialFetcher();
            const { onChange, onNotFound } = renderScanner(fetcher);

            readerScan(partialCode);
            await advance(200);
            click();

            expect(getInput()).toHaveValue(partialCode);
            expect(selection()).toEqual([0, partialCode.length]);

            readerScan(codeB);
            await advance(200);

            expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual([
              partialCode,
              codeB,
            ]);
            expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
            expect(onNotFound.mock.calls).toEqual([[partialCode]]);
          },
        );

        it("N1: con un inexistente a la vista, clic y escanear otro: no se busca la concatenación ni se avisa dos veces", async () => {
          const fetcher = partialFetcher();
          const { onChange, onNotFound } = renderScanner(fetcher);

          readerScan(unknownCode);
          await advance(200);
          browserClick(unknownCode.length);

          expect(selection()).toEqual([0, unknownCode.length]);

          readerScan(codeB);
          await advance(200);

          expect(fetcher.mock.calls.map(([params]) => params.query)).toEqual([unknownCode, codeB]);
          expect(onNotFound.mock.calls).toEqual([[unknownCode]]);
          expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
        });

        it("N1: el segundo clic seguido coloca el cursor; salir del campo y volver vuelve a seleccionar", async () => {
          renderScanner(partialFetcher());

          readerScan(partialCode);
          await advance(200);
          browserClick(3);
          browserClick(3);

          expect(selection()).toEqual([3, 3]);

          clickAwayAndBack(5);

          expect(selection()).toEqual([0, partialCode.length]);
        });

        it("N1: el primer clic en el campo ya enfocado cancela las acciones por defecto que deshacen la selección y abre la lista", async () => {
          renderScanner(partialFetcher());

          readerScan(partialCode);
          await advance(200);
          pressKey("Escape");

          expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
          expect(browserClick(3)).toEqual({ isMouseDownAllowed: false, isMouseUpAllowed: false });
          expect(selection()).toEqual([0, partialCode.length]);
          expect(screen.getAllByRole("option")).toHaveLength(2);

          // El segundo es del navegador entero: cursor, doble clic o arrastre.
          expect(browserClick(3)).toEqual({ isMouseDownAllowed: true, isMouseUpAllowed: true });
          expect(selection()).toEqual([3, 3]);
        });

        it("N1: un arrastre que acaba fuera del campo no deja bloqueado el siguiente", async () => {
          renderScanner(partialFetcher());

          readerScan(partialCode);
          await advance(200);

          // Sin `mouseup` ni `click` sobre el campo.
          expect(fireEvent.mouseDown(getInput())).toBe(false);
          expect(selection()).toEqual([0, partialCode.length]);
          expect(fireEvent.mouseDown(getInput())).toBe(true);
        });

        it("N1: el botón secundario no se cancela", async () => {
          renderScanner(partialFetcher());

          readerScan(partialCode);
          await advance(200);

          expect(fireEvent.mouseDown(getInput(), { button: 2 })).toBe(true);
        });

        it("N1: primer clic, segundo clic y completar el código a mano: se elige sin avisar", async () => {
          const fetcher = partialFetcher();
          const { onChange, onNotFound } = renderScanner(fetcher);

          readerScan(partialCode);
          await advance(200);
          browserClick(partialCode.length);
          browserClick(partialCode.length);

          expect(selection()).toEqual([partialCode.length, partialCode.length]);

          readerScan(codeB.slice(partialCode.length));
          await advance(200);

          expect(onNotFound).not.toHaveBeenCalled();
          expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
        });

        it("N1: sin escaneo a la vista el clic no se toca: cursor donde se pulsa", async () => {
          renderScanner(partialFetcher());

          await search(partialCode);
          await advance(200);
          (getInput() as HTMLInputElement).select();

          expect(browserClick(3)).toEqual({ isMouseDownAllowed: true, isMouseUpAllowed: true });
          expect(selection()).toEqual([3, 3]);
        });

        it("N1: tras una flecha de cursor el clic ya no repone la selección", async () => {
          const { onChange, onNotFound } = renderScanner(partialFetcher());
          const missingDigits = codeB.slice(partialCode.length);

          readerScan(partialCode);
          await advance(200);

          // Flecha derecha: el navegador deja el cursor al final.
          pressKey("ArrowRight");
          (getInput() as HTMLInputElement).setSelectionRange(partialCode.length, partialCode.length);
          browserClick(partialCode.length);

          expect(selection()).toEqual([partialCode.length, partialCode.length]);

          readerScan(missingDigits);
          await advance(200);

          expect(onNotFound).not.toHaveBeenCalled();
          expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
        });

        it("B1b: un Enter suelto con el parcial a la vista no elige ni envía; ↓ resalta la primera y Enter la elige", async () => {
          const { onChange, onNotFound } = renderScanner(partialFetcher());

          readerScan(partialCode);
          await advance(200);

          expect(screen.getAllByRole("option")).toHaveLength(2);
          expect(getInput()).not.toHaveAttribute("aria-activedescendant");
          expect(highlightedOptions()).toHaveLength(0);

          // LF de un sufijo CR LF que llega después de la respuesta, o Enter a mano.
          expect(pressKey("Enter")).toBe(false);
          expect(pressKey("Enter")).toBe(false);

          expect(onChange).not.toHaveBeenCalled();
          expect(onNotFound).not.toHaveBeenCalled();
          expect(getInput()).toHaveValue(partialCode);
          expect(selection()).toEqual([0, partialCode.length]);
          expect(highlightedOptions()).toHaveLength(0);

          pressKey("ArrowDown");

          expect(activeOptionText()).toContain("Producto A");

          pressKey("Enter");

          expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-1"]);
          expect(onNotFound).not.toHaveBeenCalled();
        });

        it("B1c: un Enter suelto sobre «Sin resultados» no repite onNotFound, y el siguiente escaneo tampoco", async () => {
          const { onChange, onNotFound } = renderScanner(partialFetcher());

          readerScan(unknownCode);
          await advance(200);

          expect(screen.getByRole("status")).toHaveTextContent("Sin resultados");
          expect(onNotFound.mock.calls).toEqual([[unknownCode]]);

          expect(pressKey("Enter")).toBe(false);
          expect(pressKey("Enter")).toBe(false);

          expect(onNotFound.mock.calls).toEqual([[unknownCode]]);
          expect(selection()).toEqual([0, unknownCode.length]);

          readerScan(codeB);
          await advance(200);

          expect(onNotFound.mock.calls).toEqual([[unknownCode]]);
          expect(onChange.mock.calls.map(([option]) => option.id)).toEqual(["p-2"]);
        });

        it("B2: el texto que vuelve a uno ya cargado no pinta la primera opción como resaltada y ↓ va a la primera", async () => {
          const onChange = jest.fn();
          render(
            <Harness
              entity="product"
              fetcher={async () => [product(1), product(2), product(3)]}
              onChange={onChange}
            />,
          );

          await search("prod");

          expect(activeOptionText()).toContain("Producto 1");

          type("prod0");
          type("prod");

          expect(screen.getAllByRole("option")).toHaveLength(3);
          expect(getInput()).not.toHaveAttribute("aria-activedescendant");
          expect(highlightedOptions()).toHaveLength(0);

          await advance(500);

          expect(highlightedOptions()).toHaveLength(0);

          pressKey("Enter");

          expect(onChange).not.toHaveBeenCalled();
          expect(highlightedOptions()).toHaveLength(0);

          pressKey("ArrowDown");

          expect(activeOptionText()).toContain("Producto 1");

          pressKey("Enter");

          expect(onChange.mock.calls.map(([option]) => option?.id)).toEqual(["p-1"]);
        });
      });
    });
  });
});

describe("EntityAutocomplete: teclado y ARIA", () => {
  it("cumple el patrón combobox y navega con flechas, Home y End saltando deshabilitadas", async () => {
    render(
      <Harness
        entity="product"
        fetcher={async () => [product(1), product(2), product(3), product(4)]}
        getOptionDisabled={(option) => (option.id === "p-2" ? "Sin stock" : false)}
      />,
    );

    const input = getInput();

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).not.toHaveAttribute("aria-controls");

    await search("prod");

    const listbox = screen.getByRole("listbox", { name: "Producto" });

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(within(listbox).getAllByRole("option")).toHaveLength(4);
    expect(activeOptionText()).toContain("Producto 1");
    expect(screen.getByRole("option", { name: /Producto 1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: /Producto 3/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    pressKey("ArrowDown");
    expect(activeOptionText()).toContain("Producto 3");

    pressKey("End");
    expect(activeOptionText()).toContain("Producto 4");

    pressKey("ArrowDown");
    expect(activeOptionText()).toContain("Producto 1");

    pressKey("ArrowUp");
    expect(activeOptionText()).toContain("Producto 4");

    pressKey("Home");
    expect(activeOptionText()).toContain("Producto 1");
  });

  it("Escape cierra el desplegable y ArrowDown lo reabre", async () => {
    render(<Harness entity="product" fetcher={async () => [product(1)]} />);

    await search("prod");
    pressKey("Escape");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(getInput()).toHaveAttribute("aria-expanded", "false");
    expect(getInput()).toHaveValue("prod");

    pressKey("ArrowDown");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("cierra el desplegable al perder el foco", async () => {
    render(<Harness entity="product" fetcher={async () => [product(1)]} />);

    await search("prod");
    fireEvent.blur(getInput());

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("el clic en el desplegable no le quita el foco al campo", async () => {
    render(<Harness entity="product" fetcher={async () => [product(1)]} />);

    await search("prod");

    expect(fireEvent.mouseDown(screen.getByRole("option"))).toBe(false);
  });
});

describe("EntityAutocomplete dentro de un Modal", () => {
  it("fuera de un diálogo monta el desplegable en body", async () => {
    render(<Harness entity="product" fetcher={async () => [product(1)]} />);

    await search("prod");

    const popup = screen.getByTestId("entity-autocomplete-popup");

    expect(popup.parentElement).toBe(document.body);
    expect(popup).toContainElement(screen.getByRole("listbox"));
  });

  it("monta el desplegable dentro del diálogo y Escape lo cierra sin cerrar el modal", async () => {
    const onOpenChange = jest.fn();
    render(
      <Modal onOpenChange={onOpenChange} description="Busca el producto." open title="Vincular producto">
        <Harness entity="product" fetcher={async () => [product(1)]} />
      </Modal>,
    );

    await search("prod");

    const dialog = screen.getByRole("dialog");
    const popup = screen.getByTestId("entity-autocomplete-popup");

    // Fuera de Dialog.Content el bloqueo de scroll de Radix cancela rueda y
    // arrastre táctil sobre la lista (SHR-05 F1).
    expect(dialog).toContainElement(screen.getByRole("listbox"));
    expect(popup.parentElement).toBe(dialog);
    expect(popup).toHaveClass("fixed", "z-50", "pointer-events-auto");

    pressKey("Escape");
    await advance(10);

    expect(screen.queryByTestId("entity-autocomplete-popup")).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    pressKey("Escape");
    await advance(10);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("elegir una opción con el ratón no cierra el modal", async () => {
    const onOpenChange = jest.fn();
    const onChange = jest.fn();
    render(
      <Modal onOpenChange={onOpenChange} description="Busca el producto." open title="Vincular producto">
        <Harness entity="product" fetcher={async () => [product(1)]} onChange={onChange} />
      </Modal>,
    );

    await search("prod");

    const option = screen.getByRole("option", { name: /Producto 1/ });

    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    await advance(10);

    expect(onChange).toHaveBeenCalledWith(product(1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
