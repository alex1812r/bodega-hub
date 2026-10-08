import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import type { ContactEntityOption, EntityFetcher } from "@/shared/components/EntityAutocomplete";

import {
  addProductSupplier,
  buildProductSuppliersPayload,
  createProductSuppliersState,
  EMPTY_PRODUCT_SUPPLIERS_STATE,
  getProductSuppliersErrors,
  ProductSuppliersFields,
  type ProductSuppliersFormState,
  removeProductSupplier,
  setPreferredProductSupplier,
} from "./ProductSuppliersFields";

/** PRO-14 · proveedores en el formulario de producto. */

const mockPermissions = { current: ["products.manage", "contacts.view"] };

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.current.includes(permission),
    isLoading: false,
  }),
}));

beforeEach(() => {
  mockPermissions.current = ["products.manage", "contacts.view"];
});

type UserSession = ReturnType<typeof userEvent.setup>;

function contact(id: string, label: string, isActive = true): ContactEntityOption {
  return { id, isActive, label, phone: "", taxId: "", type: "proveedor" };
}

const polar = contact("sup-polar", "Alimentos Polar");
const mavesa = contact("sup-mavesa", "Mavesa");
const cargill = contact("sup-cargill", "Cargill");

const fetchSuppliers: EntityFetcher<"contact"> = async ({ query }) =>
  [polar, mavesa, cargill].filter((option) =>
    option.label.toLowerCase().includes(query.toLowerCase()),
  );

function link(
  supplierId: string,
  name: string,
  extra: Partial<Parameters<typeof createProductSuppliersState>[0][number]> = {},
) {
  return { lastCostRef: 0, supplier: { isActive: true, name }, supplierId, ...extra };
}

function Harness({
  initial = EMPTY_PRODUCT_SUPPLIERS_STATE,
  onState,
  showErrors,
}: {
  initial?: ProductSuppliersFormState;
  onState?: (state: ProductSuppliersFormState) => void;
  showErrors?: boolean;
}) {
  const [state, setState] = useState(initial);

  return (
    <ProductSuppliersFields
      onChange={(next) => {
        setState(next);
        onState?.(next);
      }}
      showErrors={showErrors}
      state={state}
      supplierFetcher={fetchSuppliers}
    />
  );
}

function renderFields(props: Parameters<typeof Harness>[0] = {}) {
  const onState = jest.fn<void, [ProductSuppliersFormState]>();
  const user = userEvent.setup({ delay: null });

  render(<Harness onState={onState} {...props} />);

  return { onState, user };
}

function searchField() {
  return screen.getByRole("combobox", { name: "Añadir proveedor" });
}

async function addSupplier(user: UserSession, text: string, name: string) {
  await user.type(searchField(), text);
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

function preferredRadio(name: string) {
  return screen.getByRole("radio", { name: `Habitual: ${name}` });
}

describe("ProductSuppliersFields (PRO-14)", () => {
  it("el primer proveedor añadido queda como habitual; el segundo no lo cambia", async () => {
    const { onState, user } = renderFields();

    expect(screen.getByText("Este producto no tiene proveedores vinculados.")).toBeVisible();

    await addSupplier(user, "pol", "Alimentos Polar");

    expect(preferredRadio("Alimentos Polar")).toBeChecked();
    expect(searchField()).toHaveValue("");

    await addSupplier(user, "mav", "Mavesa");

    expect(preferredRadio("Alimentos Polar")).toBeChecked();
    expect(preferredRadio("Mavesa")).not.toBeChecked();
    expect(within(screen.getByRole("radiogroup")).getAllByRole("radio")).toHaveLength(2);
    expect(buildProductSuppliersPayload(onState.mock.lastCall![0])).toEqual([
      { isPreferred: true, supplierId: "sup-polar" },
      { isPreferred: false, supplierId: "sup-mavesa" },
    ]);
  });

  it("cambia el habitual con el radio y con las flechas: siempre uno solo", async () => {
    const { user } = renderFields({
      initial: createProductSuppliersState([
        link("sup-polar", "Alimentos Polar", { isPreferred: true }),
        link("sup-mavesa", "Mavesa"),
        link("sup-cargill", "Cargill"),
      ]),
    });

    await user.click(preferredRadio("Mavesa"));

    expect(preferredRadio("Mavesa")).toBeChecked();
    expect(preferredRadio("Alimentos Polar")).not.toBeChecked();

    await user.keyboard("{ArrowDown}");

    expect(preferredRadio("Cargill")).toBeChecked();
    expect(preferredRadio("Cargill")).toHaveFocus();
    expect(preferredRadio("Mavesa")).not.toBeChecked();

    // Da la vuelta al llegar al final, y vuelve atrás con la flecha contraria.
    await user.keyboard("{ArrowRight}");
    expect(preferredRadio("Alimentos Polar")).toBeChecked();

    await user.keyboard("{ArrowUp}");
    expect(preferredRadio("Cargill")).toBeChecked();
    expect(
      screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toHaveLength(1);
  });

  it("al quitar al habitual pasa al siguiente con aviso; sin más proveedores queda sin habitual, con aviso", async () => {
    const { user } = renderFields({
      initial: createProductSuppliersState([
        link("sup-polar", "Alimentos Polar", { isPreferred: true }),
        link("sup-mavesa", "Mavesa"),
      ]),
    });

    await user.click(screen.getByRole("button", { name: "Quitar a Alimentos Polar" }));

    expect(
      screen.queryByRole("radio", { name: "Habitual: Alimentos Polar" }),
    ).not.toBeInTheDocument();
    expect(preferredRadio("Mavesa")).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("El habitual pasa a Mavesa.");

    await user.click(screen.getByRole("button", { name: "Quitar a Mavesa" }));

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Este producto queda sin proveedor habitual.",
    );
  });

  it("quitar a uno que no es el habitual no mueve el habitual ni avisa", async () => {
    const { user } = renderFields({
      initial: createProductSuppliersState([
        link("sup-polar", "Alimentos Polar", { isPreferred: true }),
        link("sup-mavesa", "Mavesa"),
      ]),
    });

    await user.click(screen.getByRole("button", { name: "Quitar a Mavesa" }));

    expect(preferredRadio("Alimentos Polar")).toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("al quitar al habitual salta a los inactivos: pasa al primero ACTIVO de la lista", () => {
    const state = createProductSuppliersState([
      link("sup-polar", "Alimentos Polar", { isPreferred: true }),
      link("sup-viejo", "Proveedor Viejo", {
        supplier: { isActive: false, name: "Proveedor Viejo" },
      }),
      link("sup-mavesa", "Mavesa"),
    ]);

    expect(removeProductSupplier(state, "sup-polar")).toMatchObject({
      notice: "El habitual pasa a Mavesa.",
      preferredSupplierId: "sup-mavesa",
    });
  });

  it("un proveedor ya añadido sale deshabilitado con su motivo, y si llega igual se funde en su fila", async () => {
    const { onState, user } = renderFields();

    await addSupplier(user, "pol", "Alimentos Polar");
    await user.type(searchField(), "pol");

    const option = await screen.findByRole("option", { name: /Alimentos Polar/ });

    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveTextContent("Ya está en la lista");

    await user.click(option);

    expect(screen.getAllByRole("radio")).toHaveLength(1);

    const state = onState.mock.lastCall![0];
    const merged = addProductSupplier(state, polar);

    expect(merged).toBe(state);
    expect(buildProductSuppliersPayload(merged)).toEqual([
      { isPreferred: true, supplierId: "sup-polar" },
    ]);
  });

  it("un proveedor inactivo no puede marcarse habitual: radio bloqueado con su motivo", async () => {
    const initial = createProductSuppliersState([
      link("sup-polar", "Alimentos Polar", { isPreferred: true }),
      link("sup-viejo", "Proveedor Viejo", {
        supplier: { isActive: false, name: "Proveedor Viejo" },
      }),
      link("sup-mavesa", "Mavesa"),
    ]);
    const { user } = renderFields({ initial });

    expect(screen.getByText("Inactivo")).toBeVisible();
    expect(preferredRadio("Proveedor Viejo")).toBeDisabled();
    expect(preferredRadio("Proveedor Viejo")).toHaveAccessibleDescription(
      "Proveedor inactivo: no puede ser el habitual.",
    );

    await user.click(preferredRadio("Proveedor Viejo"));
    expect(preferredRadio("Alimentos Polar")).toBeChecked();

    // Las flechas lo saltan.
    await user.click(preferredRadio("Alimentos Polar"));
    await user.keyboard("{ArrowDown}");
    expect(preferredRadio("Mavesa")).toBeChecked();

    expect(setPreferredProductSupplier(initial, "sup-viejo")).toBe(initial);
  });

  it("un habitual guardado con el proveedor ya inactivo no se muestra como habitual", () => {
    const state = createProductSuppliersState([
      link("sup-viejo", "Proveedor Viejo", {
        isPreferred: true,
        supplier: { isActive: false, name: "Proveedor Viejo" },
      }),
    ]);

    expect(state.preferredSupplierId).toBeNull();
  });

  it("costo y código son opcionales: vacíos no viajan; un código vaciado que existía viaja como null", async () => {
    const { onState, user } = renderFields({
      initial: createProductSuppliersState([
        link("sup-polar", "Alimentos Polar", {
          isPreferred: true,
          lastCostRef: 1.5,
          supplierSku: "pol-001",
        }),
        link("sup-mavesa", "Mavesa"),
      ]),
    });

    expect(screen.getByLabelText("Costo REF de Alimentos Polar")).toHaveValue("1.5");
    expect(screen.getByLabelText("SKU del proveedor Alimentos Polar")).toHaveValue("pol-001");

    await user.type(screen.getByLabelText("Costo REF de Mavesa"), "2,25");
    await user.type(screen.getByLabelText("SKU del proveedor Mavesa"), "MAV-9");

    expect(buildProductSuppliersPayload(onState.mock.lastCall![0])).toEqual([
      { costRef: 1.5, isPreferred: true, supplierId: "sup-polar", supplierSku: "pol-001" },
      { costRef: 2.25, isPreferred: false, supplierId: "sup-mavesa", supplierSku: "MAV-9" },
    ]);

    await user.clear(screen.getByLabelText("Costo REF de Alimentos Polar"));
    await user.clear(screen.getByLabelText("SKU del proveedor Alimentos Polar"));
    await user.clear(screen.getByLabelText("Costo REF de Mavesa"));
    await user.clear(screen.getByLabelText("SKU del proveedor Mavesa"));

    expect(buildProductSuppliersPayload(onState.mock.lastCall![0])).toEqual([
      { isPreferred: true, supplierId: "sup-polar", supplierSku: null },
      { isPreferred: false, supplierId: "sup-mavesa" },
    ]);
    // Vaciar un costo que existía no lo borra: se avisa de que se conserva.
    expect(screen.getByLabelText("Costo REF de Alimentos Polar")).toHaveAccessibleDescription(
      /Vacío: se conserva/,
    );
  });

  it("valida el costo negativo o fuera de rango y avisa en el campo tras intentar enviar", () => {
    const state: ProductSuppliersFormState = {
      ...createProductSuppliersState([
        link("sup-polar", "Alimentos Polar", { isPreferred: true }),
        link("sup-mavesa", "Mavesa"),
        link("sup-cargill", "Cargill"),
      ]),
    };

    state.rows[0].costRef = "-1";
    state.rows[2].costRef = "99999999999";

    expect(getProductSuppliersErrors(state)).toEqual({
      costs: {
        "sup-cargill": "El costo está fuera de rango.",
        "sup-polar": "El costo no puede ser negativo.",
      },
    });

    render(<Harness initial={state} showErrors />);

    expect(screen.getByLabelText("Costo REF de Alimentos Polar")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Costo REF de Alimentos Polar")).toHaveAccessibleDescription(
      "El costo no puede ser negativo.",
    );
    expect(screen.getByLabelText("Costo REF de Mavesa")).not.toHaveAttribute("aria-invalid");
  });

  it("más de 50 proveedores: avisa cuántos sobran; con 50 justos no", () => {
    const links = Array.from({ length: 52 }, (_, index) =>
      link(`sup-${index}`, `Proveedor ${index}`, { isPreferred: index === 0 }),
    );
    const state = createProductSuppliersState(links);

    expect(getProductSuppliersErrors(state)).toEqual({
      costs: {},
      list: "Un producto admite como máximo 50 proveedores: quita 2.",
    });
    expect(
      getProductSuppliersErrors(createProductSuppliersState(links.slice(0, 50))),
    ).toBeUndefined();

    render(<Harness initial={state} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Un producto admite como máximo 50 proveedores: quita 2.",
    );
  });

  it("solo carga los vínculos activos y un mismo proveedor repetido queda en una fila", () => {
    const state = createProductSuppliersState([
      link("sup-polar", "Alimentos Polar", { isPreferred: true }),
      link("sup-polar", "Alimentos Polar"),
      link("sup-mavesa", "Mavesa", { isActive: false }),
    ]);

    expect(state.rows.map((row) => row.supplierId)).toEqual(["sup-polar"]);
    expect(state.preferredSupplierId).toBe("sup-polar");
  });

  it("mientras carga o si la carga falla no hay lista ni buscador; el fallo ofrece reintentar", async () => {
    const onRetryLoad = jest.fn();
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(
      <ProductSuppliersFields
        isLoading
        onChange={jest.fn()}
        state={EMPTY_PRODUCT_SUPPLIERS_STATE}
      />,
    );

    expect(screen.getByText("Cargando proveedores...")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    rerender(
      <ProductSuppliersFields
        loadError="No tienes permiso para acceder a contactos de tipo proveedor."
        onChange={jest.fn()}
        onRetryLoad={onRetryLoad}
        state={EMPTY_PRODUCT_SUPPLIERS_STATE}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar los proveedores: No tienes permiso para acceder a contactos de tipo proveedor.",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });

  describe("PRO-F8 · fila para el ancho real del diálogo", () => {
    const initial = createProductSuppliersState([
      link("sup-polar", "Distribuidora Lab Norte", { isPreferred: true, lastCostRef: 1.2 }),
      link("sup-viejo", "Proveedor Viejo", {
        supplier: { isActive: false, name: "Proveedor Viejo" },
      }),
    ]);

    function rowOf(supplierId: string) {
      return document.querySelector<HTMLElement>(`[data-product-supplier-row="${supplierId}"]`)!;
    }

    it("el nombre va en una primera línea propia con Habitual y Quitar; costo y SKU, en la segunda", () => {
      renderFields({ initial });

      const row = rowOf("sup-polar");
      const header = row.querySelector<HTMLElement>("[data-product-supplier-header]")!;
      const name = header.querySelector<HTMLElement>("[data-product-supplier-name]")!;
      const fields = row.querySelector<HTMLElement>("[data-product-supplier-fields]")!;

      // La celda del nombre crece y parte la línea: nunca queda en 0 px.
      expect(name).toHaveTextContent("Distribuidora Lab Norte");
      expect(name).toHaveClass("min-w-0", "flex-1", "break-words");
      expect(name.className).toMatch(/\bbasis-/);
      expect(header).toHaveClass("flex", "flex-wrap", "min-w-0");
      expect(header).toContainElement(preferredRadio("Distribuidora Lab Norte"));
      expect(header).toContainElement(
        screen.getByRole("button", { name: "Quitar a Distribuidora Lab Norte" }),
      );

      expect(fields).toContainElement(screen.getByLabelText("Costo REF de Distribuidora Lab Norte"));
      expect(fields).toContainElement(
        screen.getByLabelText("SKU del proveedor Distribuidora Lab Norte"),
      );
      // Costo y SKU nunca comparten línea con el nombre.
      expect(Array.from(row.children)).toEqual([header, fields]);
    });

    it("no decide columnas con el ancho de la ventana: el diálogo es estrecho en cualquier pantalla", () => {
      renderFields({ initial });

      for (const row of [rowOf("sup-polar"), rowOf("sup-viejo")]) {
        const layout = [
          row,
          ...Array.from(
            row.querySelectorAll<HTMLElement>(
              "[data-product-supplier-header], [data-product-supplier-name], [data-product-supplier-fields], [data-product-supplier-cost], [data-product-supplier-remove]",
            ),
          ),
        ];

        expect(layout).toHaveLength(6);

        for (const element of layout) {
          expect(element.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):/);
        }
      }
    });

    it("el chip Inactivo acompaña al nombre y el motivo queda dentro de la fila", () => {
      renderFields({ initial });

      const row = rowOf("sup-viejo");
      const name = row.querySelector<HTMLElement>("[data-product-supplier-name]")!;

      expect(within(name).getByText("Inactivo")).toBeVisible();
      expect(within(row).getByText("Proveedor inactivo: no puede ser el habitual.")).toBeVisible();
    });

    it("el radio Habitual tiene un objetivo de 36 px de alto con foco visible y su etiqueta es clicable", async () => {
      const { user } = renderFields({
        initial: createProductSuppliersState([
          link("sup-polar", "Alimentos Polar", { isPreferred: true }),
          link("sup-mavesa", "Mavesa"),
        ]),
      });

      const radio = preferredRadio("Mavesa");
      const target = radio.closest("label")!;

      expect(target).toHaveClass("min-h-9", "cursor-pointer", "shrink-0");
      expect(radio).toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring");

      await user.click(within(target).getByText("Habitual"));

      expect(radio).toBeChecked();
      expect(preferredRadio("Alimentos Polar")).not.toBeChecked();
    });
  });

  describe("PRO-F8 · sin acceso a Contactos", () => {
    const initial = createProductSuppliersState([
      link("sup-polar", "Alimentos Polar", { isPreferred: true, lastCostRef: 1.5 }),
      link("sup-mavesa", "Mavesa"),
    ]);

    it("quien no puede listar contactos no ve el buscador, sino cómo conseguirlo; el resto sigue operativo", async () => {
      // Rol almacén: guarda proveedores (`products.manage`), pero no lista contactos.
      mockPermissions.current = ["products.manage"];

      const { onState, user } = renderFields({ initial });

      expect(screen.queryByRole("combobox", { name: "Añadir proveedor" })).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "Para añadir proveedores necesitas acceso a Contactos. Puedes cambiar el habitual, el costo y el SKU de los ya vinculados.",
        ),
      ).toBeVisible();

      await user.click(preferredRadio("Mavesa"));
      await user.type(screen.getByLabelText("Costo REF de Mavesa"), "2");
      await user.type(screen.getByLabelText("SKU del proveedor Mavesa"), "mav-1");
      await user.click(screen.getByRole("button", { name: "Quitar a Alimentos Polar" }));

      expect(buildProductSuppliersPayload(onState.mock.lastCall![0])).toEqual([
        { costRef: 2, isPreferred: true, supplierId: "sup-mavesa", supplierSku: "mav-1" },
      ]);
    });

    it("con acceso a Contactos el buscador sigue ahí y no hay línea de ayuda", () => {
      renderFields({ initial });

      expect(searchField()).toBeVisible();
      expect(screen.queryByText(/necesitas acceso a Contactos/)).not.toBeInTheDocument();
    });
  });
});
