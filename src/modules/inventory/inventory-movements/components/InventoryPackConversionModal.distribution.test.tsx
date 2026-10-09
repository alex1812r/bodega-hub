/**
 * INV-08 · Abrir empaque surtido: reparto editable, suma contra el total,
 * "Restablecer receta" y confirmación con el efecto antes de enviar `components`.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function product(id: string, name: string, currentStock: number) {
  return { currentCostRef: 1, currentStock, id, name, salePriceRef: 2, sku: `${id}-sku` };
}

function component(unitProductId: string, name: string, currentStock: number, isActive = true) {
  return {
    costWeight: 1,
    currentStock,
    isActive,
    name,
    sku: `${unitProductId}-sku`,
    unitProductId,
    unitsPerPack: 2,
  };
}

const single = {
  components: [{ ...component("prod-cigar-unit", "Cigarro suelto", 3), unitsPerPack: 10 }],
  id: "ppc-cigars",
  kind: "single",
  label: null,
  linkedProduct: product("prod-cigar-unit", "Cigarro suelto", 3),
  packProduct: product("prod-cigar-pack", "Caja cigarros (x10)", 5),
  role: "pack",
  sources: [],
  totalUnits: 10,
  unitsPerPack: 10,
};

// El BFF ordena los componentes por nombre; los ids van en otro orden a propósito.
const assorted = {
  components: [
    component("prod-3-cola", "Cola", 12),
    component("prod-1-manzana", "Manzana", 0),
    component("prod-2-naranja", "Naranja", 5, false),
  ],
  id: "ppc-surtido",
  kind: "assorted",
  label: "Sabores surtidos",
  linkedProduct: product("prod-3-cola", "Cola", 12),
  packProduct: product("prod-surtido", "Surtido A", 9),
  role: "pack",
  sources: [],
  totalUnits: 6,
  unitsPerPack: 6,
};

const opened = {
  data: {
    components: [
      { isActive: true, unitProductId: "prod-1-manzana", units: 2 },
      { isActive: true, unitProductId: "prod-3-cola", units: 4 },
    ],
    conversionId: "conv-1",
    packQuantity: 1,
    totalUnits: 6,
    unitQuantity: 6,
    unitsPerPack: 6,
  },
};

const formId = "inventory-pack-conversion-form";
const uuid = expect.stringMatching(/^[0-9a-f-]{36}$/);

async function renderOpen(packProductId = "prod-surtido") {
  const api = installFetchStub(() => [single, assorted]);
  const QueryWrapper = createQueryWrapper();

  render(
    <QueryWrapper>
      <ToastProvider>
        <InventoryPackConversionModal defaultPackProductId={packProductId} />
      </ToastProvider>
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
  await screen.findByText(/Stock empaque: /);

  return api;
}

function setQuantity(value: string) {
  fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value } });
}

function units(name: string) {
  return screen.getByLabelText<HTMLInputElement>(`Unidades de ${name}`);
}

function setUnits(name: string, value: string) {
  fireEvent.change(units(name), { target: { value } });
}

function submitForm() {
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);
}

function queryConfirm() {
  return screen.queryByRole("dialog", { name: "Abrir empaque surtido" });
}

async function openConfirm() {
  submitForm();

  return screen.findByRole("dialog", { name: "Abrir empaque surtido" });
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Abrir empaque" });
}

describe("InventoryPackConversionModal · reparto del surtido (INV-08)", () => {
  it("precarga receta × empaques, con nombre, SKU y stock de cada componente", async () => {
    await renderOpen();

    expect(units("Cola")).toHaveValue("2");
    expect(units("Manzana")).toHaveValue("2");
    expect(units("Naranja")).toHaveValue("2");
    expect(screen.getByText("6 de 6 unidades")).toBeVisible();
    expect(screen.getByText("prod-3-cola-sku · Stock actual 12")).toBeVisible();
    expect(screen.getByText("prod-1-manzana-sku · Stock actual 0")).toBeVisible();
    expect(screen.getByText("Naranja (inactivo)")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
    // Sin `type="number"`: campo de texto con teclado numérico.
    expect(units("Cola")).toHaveAttribute("type", "text");
  });

  it("al cambiar los empaques sin haber tocado el reparto, se recalcula desde la receta", async () => {
    await renderOpen();
    setQuantity("3");

    expect(units("Cola")).toHaveValue("6");
    expect(units("Manzana")).toHaveValue("6");
    expect(units("Naranja")).toHaveValue("6");
    expect(screen.getByText("18 de 18 unidades")).toBeVisible();
  });

  it("avisa de un componente inactivo que recibe unidades, y deja de avisar si recibe 0", async () => {
    await renderOpen();

    expect(
      screen.getByText(
        "Naranja está inactivo: recibirá stock, pero no se podrá vender hasta activarlo.",
      ),
    ).toBeVisible();

    setUnits("Naranja", "0");
    setUnits("Cola", "4");

    expect(screen.queryByText(/está inactivo/)).not.toBeInTheDocument();
    expect(screen.getByText("6 de 6 unidades")).toBeVisible();
  });

  it("sin cantidad válida no hay reparto que mostrar", async () => {
    await renderOpen();
    setQuantity("");

    expect(screen.queryByLabelText("Unidades de Cola")).not.toBeInTheDocument();
    expect(screen.queryByText(/de \d+ unidades/)).not.toBeInTheDocument();
  });

  it("una suma que no coincide avisa, apaga «Continuar» y no llega a la confirmación", async () => {
    const api = await renderOpen();

    setUnits("Cola", "4");

    expect(screen.getByText("8 de 6 unidades")).toBeVisible();
    expect(screen.getByText("Sobran 2 unidad(es): el reparto debe sumar 6.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    submitForm();
    expect(queryConfirm()).not.toBeInTheDocument();

    setUnits("Manzana", "");

    expect(screen.getByText("6 de 6 unidades")).toBeVisible();
    expect(screen.queryByText(/Sobran|Faltan/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();

    setUnits("Cola", "1");

    expect(screen.getByText("Faltan 3 unidad(es) por repartir: el reparto debe sumar 6.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    expect(api.posts).toHaveLength(0);
  });

  it("unidades con decimales: el campo avisa y no se puede continuar", async () => {
    const user = userEvent.setup();
    await renderOpen();

    await user.clear(units("Cola"));
    await user.type(units("Cola"), "2.5");
    await user.clear(units("Manzana"));
    await user.type(units("Manzana"), "1.5");

    expect(screen.getByText("6 de 6 unidades")).toBeVisible();
    expect(units("Cola")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("Debe ser un número entero.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();

    submitForm();
    expect(queryConfirm()).not.toBeInTheDocument();
  });

  it("no acepta unidades negativas", async () => {
    const user = userEvent.setup();
    await renderOpen();

    await user.clear(units("Cola"));
    await user.type(units("Cola"), "-3");

    expect(units("Cola")).toHaveValue("3");
  });

  it("reparto tocado + cambio de empaques: conserva lo tecleado y avisa de la suma", async () => {
    await renderOpen();

    setUnits("Cola", "4");
    setUnits("Manzana", "0");
    setQuantity("2");

    expect(units("Cola")).toHaveValue("4");
    expect(units("Manzana")).toHaveValue("0");
    expect(units("Naranja")).toHaveValue("2");
    expect(screen.getByText("6 de 12 unidades")).toBeVisible();
    expect(screen.getByText("Faltan 6 unidad(es) por repartir: el reparto debe sumar 12.")).toBeVisible();
  });

  it("«Restablecer receta» vuelve a receta × empaques y el reparto sigue de nuevo a la cantidad", async () => {
    const user = userEvent.setup();
    await renderOpen();

    setUnits("Cola", "4");
    setQuantity("2");
    await user.click(screen.getByRole("button", { name: "Restablecer receta" }));

    expect(units("Cola")).toHaveValue("4");
    expect(units("Manzana")).toHaveValue("4");
    expect(units("Naranja")).toHaveValue("4");
    expect(screen.getByText("12 de 12 unidades")).toBeVisible();
    expect(screen.queryByText(/Sobran|Faltan/)).not.toBeInTheDocument();

    setQuantity("1");
    expect(units("Cola")).toHaveValue("2");
  });

  it("cambiar de empaque descarta el reparto tecleado", async () => {
    const user = userEvent.setup();
    await renderOpen();

    setUnits("Cola", "4");
    await user.click(screen.getByRole("button", { name: "Limpiar Producto empaque" }));
    expect(screen.queryByLabelText("Unidades de Cola")).not.toBeInTheDocument();

    await user.type(screen.getByRole("combobox", { name: "Producto empaque" }), "surt");
    await user.click(await screen.findByRole("option", { name: /Surtido A/ }));

    // El mismo empaque elegido otra vez conserva lo tecleado; otro empaque no lo hereda.
    expect(units("Cola")).toHaveValue("4");

    await user.click(screen.getByRole("button", { name: "Limpiar Producto empaque" }));
    await user.type(screen.getByRole("combobox", { name: "Producto empaque" }), "caja");
    await user.click(await screen.findByRole("option", { name: /Caja cigarros/ }));

    expect(screen.queryByLabelText(/Unidades de/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });
});

describe("InventoryPackConversionModal · confirmación del surtido (INV-08)", () => {
  it("muestra −N del empaque y +unidades por componente, con el stock antes → después", async () => {
    await renderOpen();
    setQuantity("3");
    setUnits("Cola", "10");
    setUnits("Manzana", "8");
    setUnits("Naranja", "0");

    const dialog = await openConfirm();
    const effects = within(dialog).getAllByRole("listitem");

    expect(
      within(dialog).getByText("Vas a abrir 3 empaque(s) de Surtido A con este reparto."),
    ).toBeVisible();
    // Naranja recibe 0: no aparece.
    expect(effects).toHaveLength(3);
    expect(effects[0]).toHaveTextContent(/−3 Surtido A\s*Stock 9\s*pasa a\s*6$/);
    expect(effects[1]).toHaveTextContent(/\+10 Cola\s*Stock 12\s*pasa a\s*22$/);
    expect(effects[2]).toHaveTextContent(/\+8 Manzana\s*Stock 0\s*pasa a\s*8$/);
    expect(within(dialog).queryByText(/Naranja/)).not.toBeInTheDocument();
  });

  it("marca en la confirmación el componente inactivo que recibe unidades", async () => {
    await renderOpen();

    const dialog = await openConfirm();
    const effects = within(dialog).getAllByRole("listitem");

    expect(effects).toHaveLength(4);
    expect(effects[3]).toHaveTextContent(/\+2 Naranja \(inactivo\)\s*Stock 5\s*pasa a\s*7$/);
    expect(effects[3]).toHaveAttribute("data-tone", "warning");
  });

  it("confirmar envía el reparto real en `components`, por id y sin los 0, con clave", async () => {
    const api = await renderOpen();
    api.respondToNextPost(opened);
    setUnits("Cola", "4");
    setUnits("Naranja", "0");

    const dialog = await openConfirm();

    expect(api.posts).toHaveLength(0);
    fireEvent.click(confirmButton(dialog));

    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: uuid,
      components: [
        { unitProductId: "prod-1-manzana", units: 2 },
        { unitProductId: "prod-3-cola", units: 4 },
      ],
      packProductId: "prod-surtido",
      packQuantity: 1,
    });
    expect(
      within(await screen.findByRole("status")).getByText("Abriste 1 Surtido A: +4 Cola, +2 Manzana"),
    ).toBeInTheDocument();
  });

  it("el reparto por receta también viaja en `components`", async () => {
    const api = await renderOpen();
    api.respondToNextPost(opened);
    setQuantity("2");

    fireEvent.click(confirmButton(await openConfirm()));
    await waitFor(() => expect(api.posts).toHaveLength(1));

    expect(api.posts[0]?.body).toMatchObject({
      components: [
        { unitProductId: "prod-1-manzana", units: 4 },
        { unitProductId: "prod-2-naranja", units: 4 },
        { unitProductId: "prod-3-cola", units: 4 },
      ],
      packQuantity: 2,
    });
  });

  it("doble clic en confirmar = 1 petición, y en vuelo no se cierra ninguno de los dos modales", async () => {
    const api = await renderOpen();
    const release = api.holdNextPost(opened);
    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Abrir empaque|Procesando/ }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );
    expect(api.posts).toHaveLength(1);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(queryConfirm()).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(document.getElementById(formId)).not.toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(api.posts).toHaveLength(1);
  });

  it("un error de red avisa del resultado incierto y el reintento del mismo reparto conserva la clave", async () => {
    const api = await renderOpen();
    api.networkErrorOnNextPost();
    api.respondToNextPost(opened);
    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/No pudimos confirmar si el movimiento se registró/);
    expect(document.getElementById(formId)).not.toBeNull();

    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body).toEqual(api.posts[0]?.body);
  });

  it.each([
    [400, "El reparto debe sumar 6 unidades (1 empaques × 6) y suma 4."],
    [409, "La clave de la solicitud ya se usó con otro contenido."],
  ])("tras un %i, cambiar el reparto estrena clave", async (status, message) => {
    const api = await renderOpen();
    api.respondToNextPost({ error: { code: "ERROR", message } }, status);
    api.respondToNextPost(opened);
    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(queryConfirm()).not.toBeInTheDocument());

    setUnits("Cola", "4");
    setUnits("Naranja", "0");

    const secondDialog = await openConfirm();

    // El error del intento anterior no pertenece a esta confirmación.
    expect(within(secondDialog).queryByText(message)).not.toBeInTheDocument();
    fireEvent.click(confirmButton(secondDialog));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.components).toEqual([
      { unitProductId: "prod-1-manzana", units: 2 },
      { unitProductId: "prod-3-cola", units: 4 },
    ]);
    expect(api.posts[1]?.body.clientRequestId).toEqual(uuid);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("tras un 409, reintentar el mismo reparto conserva la clave", async () => {
    const api = await renderOpen();
    api.respondToNextPost({ error: { code: "CONFLICT", message: "Stock insuficiente de empaque" } }, 409);
    api.respondToNextPost(opened);
    const dialog = await openConfirm();

    fireEvent.click(confirmButton(dialog));
    await within(dialog).findByRole("alert");
    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });

  it("al cancelar la confirmación el foco vuelve al formulario y el reparto sigue ahí", async () => {
    const user = userEvent.setup();
    await renderOpen();
    setUnits("Cola", "4");
    setUnits("Manzana", "0");

    const continueButton = screen.getByRole("button", { name: "Continuar" });

    continueButton.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "Abrir empaque surtido" });

    // Foco al abrir: dentro de la confirmación (lo coloca `ConfirmActionModal`).
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(queryConfirm()).not.toBeInTheDocument());

    await waitFor(() => expect(screen.getByRole("button", { name: "Continuar" })).toHaveFocus());
    expect(units("Cola")).toHaveValue("4");
    expect(document.getElementById(formId)).not.toBeNull();
  });
});

describe("InventoryPackConversionModal · empaque en negativo (INV-08)", () => {
  it("más empaques de los que hay: avisa en español y no llega a la confirmación", async () => {
    const api = await renderOpen();

    setQuantity("10");

    expect(screen.getByText("Solo hay 9 empaque(s) en stock.")).toBeVisible();
    expect(screen.getByLabelText("Cantidad de empaques")).toHaveAttribute("aria-invalid", "true");

    submitForm();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
  });
});

describe("InventoryPackConversionModal · empaque 1 a 1 (INV-08)", () => {
  it("sin reparto que editar: confirma con su efecto (CNF-08) y envía sin `components`", async () => {
    const api = await renderOpen("prod-cigar-pack");
    api.respondToNextPost({ data: { conversionId: "conv-2", unitQuantity: 20 } });
    setQuantity("2");

    expect(screen.queryByText("Reparto de unidades")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restablecer receta" })).not.toBeInTheDocument();

    submitForm();

    // La confirmación del 1 a 1 es la suya, no la del surtido.
    const dialog = await screen.findByRole("dialog", { name: "Confirmar conversión de empaque" });

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Convertir empaque" }));
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: uuid,
      packProductId: "prod-cigar-pack",
      packQuantity: 2,
    });
  });
});
