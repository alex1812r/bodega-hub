import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

/**
 * CNF-15 · guardia de cambios sin guardar del formulario de producto: con cambios,
 * cerrar pregunta con el modal del tema y nombra el proceso; sin cambios, o tras
 * guardar, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../../shared/auth/Can", () => ({
  Can: () => null,
}));

// Sin configuración de la tienda: el formulario usa los chips y el semáforo por defecto.
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));

jest.mock("../../hooks/useProducts", () => ({
  useProducts: () => ({ data: undefined }),
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type UserSession = ReturnType<typeof userEvent.setup>;
type Product = NonNullable<ProductFormModalProps["product"]>;

const CLOSE_WAYS = ["Escape", "clic fuera", "Cancelar", "la X"] as const;

type CloseWay = (typeof CLOSE_WAYS)[number];

const categories = [
  { id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 },
  { id: "cat-2", isActive: true, name: "Víveres", taxRate: 16 },
];

const savedProduct = {
  barcode: "7591234567890",
  categoryId: "cat-1",
  currentCostRef: 1.5,
  currentStock: 4,
  description: "Paquete de 1 kg",
  id: "prod-1",
  isActive: true,
  minStock: 1,
  name: "Harina PAN",
  salePriceRef: 2,
  sku: "harina-pan",
} as Product;

/** Consumidor con el modal controlado: lo cierra cuando el formulario lo pide. */
function Host({
  onOpenChange,
  ...props
}: Partial<ProductFormModalProps> & { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        abrir formulario
      </button>
      <ProductFormModal
        categories={categories}
        initialValues={{ categoryId: "cat-1" }}
        {...props}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          onOpenChange(nextOpen);
        }}
        open={open}
      />
    </>
  );
}

/** Radix registra su escucha de «clic fuera» en un setTimeout(0) tras montar el diálogo. */
async function settleDialog() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderForm(props: Partial<ProductFormModalProps> = {}) {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = jest.fn();

  render(<Host {...props} onOpenChange={onOpenChange} />);
  await settleDialog();

  return { onOpenChange, user };
}

function formDialog() {
  return screen.getByRole("dialog", { name: /^(Crear|Editar|Nuevo) producto$/ });
}

/** Por su título: con la pregunta del guardia encima, el formulario queda fuera del árbol accesible. */
function queryFormDialog() {
  return (
    screen
      .queryAllByRole("dialog", { hidden: true })
      .find((dialog) =>
        /^(Crear|Editar|Nuevo) producto$/.test(dialog.querySelector("h2")?.textContent ?? ""),
      ) ?? null
  );
}

function guardDialog() {
  return screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });
}

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

async function closeWith(user: UserSession, way: CloseWay) {
  if (way === "Escape") {
    await user.keyboard("{Escape}");
  } else if (way === "Cancelar") {
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));
  } else if (way === "la X") {
    await user.click(within(formDialog()).getByRole("button", { name: "Cerrar modal" }));
  } else {
    const backdrop = formDialog().previousElementSibling;

    if (!(backdrop instanceof HTMLElement)) {
      throw new Error("No se encontró el fondo del modal");
    }

    // El modal ignora el clic en el fondo durante medio segundo tras abrirse.
    const now = performance.now();
    const clock = jest.spyOn(performance, "now").mockReturnValue(now + 1000);

    // Radix decide el «clic fuera» al bajar el puntero.
    fireEvent.pointerDown(backdrop);
    clock.mockRestore();
  }
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
}

describe("ProductFormModal · guardia de cambios sin guardar (CNF-15)", () => {
  it.each(CLOSE_WAYS)("sin cambios, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await renderForm();

    await closeWith(user, way);

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)(
    "con cambios, %s pregunta nombrando el producto y no cierra",
    async (way) => {
      const { onOpenChange, user } = await renderForm();

      await paste(user, "Nombre", "Harina PAN");
      await closeWith(user, way);

      const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

      expect(guard).toHaveTextContent("Producto nuevo «Harina PAN» sin guardar");
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryFormDialog()).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    },
  );

  it("«Seguir aquí» conserva lo tecleado en los dos niveles y devuelve el foco al campo", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Harina PAN");
    await paste(user, "Código de barras", "7591234567890");
    await paste(user, "Costo REF", "1.5");
    await user.click(screen.getByRole("button", { name: "30 %" }));
    await user.click(screen.getByRole("button", { name: /Más opciones/ }));
    await paste(user, "SKU", "harina-pan");
    await paste(user, "Stock inicial", "4");
    await paste(user, "Descripción", "Paquete de 1 kg");
    await user.keyboard("{Escape}");

    const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    // El foco queda atrapado en la pregunta, en la opción que no pierde nada.
    expect(within(guard).getByRole("button", { name: "Seguir aquí" })).toHaveFocus();

    await user.click(within(guard).getByRole("button", { name: "Seguir aquí" }));

    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina PAN");
    expect(screen.getByLabelText("Código de barras")).toHaveValue("7591234567890");
    expect(screen.getByLabelText("Costo REF")).toHaveValue("1.5");
    expect(screen.getByLabelText("Precio REF")).toHaveValue("1.95");
    expect(screen.getByLabelText("SKU")).toHaveValue("harina-pan");
    expect(screen.getByLabelText("Stock inicial")).toHaveValue("4");
    expect(screen.getByLabelText("Descripción")).toHaveValue("Paquete de 1 kg");
    expect(screen.getByLabelText("Descripción")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Esc sobre la pregunta equivale a «Seguir aquí»: solo se cierra la pregunta", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Harina PAN");
    await user.keyboard("{Escape}");
    await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    expect(formDialog()).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina PAN");
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("«Salir» cierra y descarta: al reabrir el formulario está limpio y cierra sin preguntar", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Harina PAN");
    await paste(user, "Costo REF", "1.5");
    await user.keyboard("{Escape}");
    await user.click(
      within(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).getByRole(
        "button",
        { name: "Salir" },
      ),
    );

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "abrir formulario" }));

    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByLabelText("Costo REF")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("tocar un campo y volver al valor original no cuenta como cambio", async () => {
    const { user } = await renderForm({ mode: "edit", product: savedProduct });

    // Texto controlado, campo no controlado y número: se cambian y se dejan como estaban.
    await user.type(screen.getByLabelText("Nombre"), "X");
    await user.keyboard("{Backspace}");
    await user.type(screen.getByLabelText("Código de barras"), "9");
    await user.keyboard("{Backspace}");
    await user.clear(screen.getByLabelText("Costo REF"));
    await user.paste("1.5");
    await user.selectOptions(screen.getByLabelText("Categoría"), "cat-2");
    await user.selectOptions(screen.getByLabelText("Categoría"), "cat-1");
    // Pasar por un número sin tocarlo solo lo redondea a la vista.
    await user.click(screen.getByLabelText("Costo REF"));
    await user.tab();

    expect(dispatchBeforeUnload()).toBe(false);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("edición: abrir y cerrar sin tocar no pregunta; con un cambio nombra el producto que se edita", async () => {
    const { onOpenChange, user } = await renderForm({ mode: "edit", product: savedProduct });

    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "abrir formulario" }));
    await user.clear(screen.getByLabelText("Costo REF"));
    await user.paste("1.8");
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      "Edición de producto «Harina PAN»",
    );
    // No se volvió a pedir el cierre al consumidor.
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("un precio elegido con un chip, sin teclear nada más, ya es un cambio", async () => {
    const { user } = await renderForm({ mode: "edit", product: savedProduct });

    await user.click(screen.getByRole("button", { name: "20 %" }));
    await user.keyboard("{Escape}");

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      "Edición de producto «Harina PAN»",
    );
  });

  it("con cambios avisa al recargar o cerrar la pestaña; sin cambios no", async () => {
    const { user } = await renderForm();

    expect(dispatchBeforeUnload()).toBe(false);

    await paste(user, "Nombre", "Harina PAN");

    expect(dispatchBeforeUnload()).toBe(true);
  });

  it("con cambios, el atrás del navegador pregunta en vez de salir", async () => {
    const { user } = await renderForm();

    await paste(user, "Nombre", "Harina PAN");
    // ATRÁS aterriza en la entrada gemela del guardia.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __processGuard: "twin" } }));
    });

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      "Producto nuevo «Harina PAN» sin guardar",
    );
    expect(queryFormDialog()).toBeInTheDocument();
  });

  it("tras guardar con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ...savedProduct, id: "prod-new" });
    const { onOpenChange, user } = await renderForm({ onSubmit });

    await paste(user, "Nombre", "Harina PAN");
    await paste(user, "Precio REF", "2");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("si el guardado falla, lo tecleado sigue sin guardar y cerrar vuelve a preguntar", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error("SKU repetido"));
    const { user } = await renderForm({ onSubmit });

    await paste(user, "Nombre", "Harina PAN");
    await paste(user, "Precio REF", "2");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre", { selector: "input" })).toHaveValue("Harina PAN");
  });

  it("mientras guarda, Cancelar cierra como antes, sin pregunta", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const { rerender } = render(<Host onOpenChange={onOpenChange} />);

    await paste(user, "Nombre", "Harina PAN");
    // El consumidor marca el envío en curso.
    rerender(<Host isSubmitting onOpenChange={onOpenChange} />);
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("«Guardar y crear otro» deja el formulario limpio: cerrar después no pregunta", async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ...savedProduct, id: "prod-new" });
    const { user } = await renderForm({ onSubmit });

    await paste(user, "Nombre", "Harina PAN");
    await paste(user, "Precio REF", "2");
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("modo compact: lo precargado no es un cambio; teclear encima sí", async () => {
    const { onOpenChange, user } = await renderForm({
      compact: true,
      initialValues: { categoryId: "cat-1", name: "Malta 355" },
    });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "abrir formulario" }));
    await paste(user, "Costo REF", "1.16");
    await user.keyboard("{Escape}");

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      "Producto nuevo «Malta 355» sin guardar",
    );
  });

  it("clic fuera sobre el fondo de la pregunta no cierra el formulario de debajo", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Harina PAN");
    await user.keyboard("{Escape}");

    const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });
    const backdrop = guard.previousElementSibling as HTMLElement;
    const now = performance.now();
    const clock = jest.spyOn(performance, "now").mockReturnValue(now + 1000);

    await settleDialog();
    fireEvent.pointerDown(backdrop);
    clock.mockRestore();

    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    expect(formDialog()).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina PAN");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
