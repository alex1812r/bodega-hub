import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryPackConversionModal } from "./InventoryPackConversionModal";

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function linked(id: string, name: string, sku: string, currentStock: number) {
  return { currentCostRef: 1, currentStock, id, name, salePriceRef: 2, sku };
}

const packConversions = [
  {
    id: "ppc-cigars",
    linkedProduct: linked("prod-cigar-unit", "Cigarro suelto", "CIG-UNI-001", 3),
    packProduct: linked("prod-cigar-pack", "Caja cigarros (x10)", "CIG-CAJ-010", 5),
    role: "pack",
    unitsPerPack: 10,
  },
  {
    id: "ppc-water",
    linkedProduct: linked("prod-water-unit", "Agua 600 ml", "AGU-UNI-001", 0),
    packProduct: linked("prod-water-pack", "Bulto de agua (x24)", "AGU-BUL-024", 7),
    role: "pack",
    unitsPerPack: 24,
  },
];

const conversionResult = { data: { conversionId: "conv-1", unitQuantity: 10 } };

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
  await screen.findByText(/Stock empaque: 5/);
}

function getForm() {
  const form = document.getElementById("inventory-pack-conversion-form");

  if (!form) {
    throw new Error("El formulario de conversion no esta montado.");
  }

  return form;
}

const CONFIRM_TITLE = "Confirmar conversión de empaque";
const REASON = "Reposición de mostrador";

/** CNF-F4: el motivo es obligatorio; sin él la confirmación no se abre. */
function fillReason() {
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: REASON } });
}

function queryConfirm() {
  return screen.queryByRole("dialog", { name: CONFIRM_TITLE });
}

/** CNF-08: el formulario ya no envía; abre la confirmación con las dos caras de la conversión. */
async function openConfirm() {
  fillReason();
  fireEvent.submit(getForm());

  return screen.findByRole("dialog", { name: CONFIRM_TITLE });
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Convertir empaque" });
}

async function submitAndConfirm() {
  const dialog = await openConfirm();

  fireEvent.click(confirmButton(dialog));

  return dialog;
}

async function cancelConfirm(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(queryConfirm()).not.toBeInTheDocument());
}

describe("InventoryPackConversionModal · buscador de empaque (INV-07)", () => {
  function renderModal(defaultPackProductId?: string) {
    const gets: string[] = [];
    const api = installFetchStub((url) => {
      gets.push(url);

      return packConversions;
    });

    render(<InventoryPackConversionModal defaultPackProductId={defaultPackProductId} />, {
      wrapper: createQueryWrapper(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));

    return { api, gets };
  }

  function getPackField() {
    return screen.getByRole<HTMLInputElement>("combobox", { name: "Producto empaque" });
  }

  it("busca por nombre entre los empaques con receta, elige uno y lo envía con clave", async () => {
    const user = userEvent.setup();
    const { api, gets } = renderModal();
    api.respondToNextPost(conversionResult);

    const field = await screen.findByRole("combobox", { name: "Producto empaque" });

    // Ya no es un <select> con todas las recetas a la vista.
    expect(field.tagName).toBe("INPUT");
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText(/Stock empaque/)).toBeNull();

    await user.type(field, "agu");

    const option = await screen.findByRole("option", { name: /Bulto de agua \(x24\)/ });

    expect(option).toHaveTextContent("AGU-BUL-024 · Stock 7 · → Agua 600 ml (x24)");
    expect(screen.queryByRole("option", { name: /Caja cigarros/ })).toBeNull();

    await user.click(option);

    expect(field).toHaveValue("Bulto de agua (x24)");
    expect(screen.getByText("Stock empaque: 7. Unidad: Agua 600 ml (stock 0).")).toBeVisible();
    // Una sola lectura: las recetas; ninguna petición al catálogo de productos.
    expect(gets).toEqual(["/api/inventory/pack-conversions"]);

    await submitAndConfirm();
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-water-pack",
      packQuantity: 1,
      reason: REASON,
    });
  });

  it("busca por SKU, sin distinguir mayúsculas", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(await screen.findByRole("combobox", { name: "Producto empaque" }), "cig-caj");

    expect(await screen.findByRole("option", { name: /Caja cigarros \(x10\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Bulto de agua/ })).toBeNull();
  });

  it("precarga el empaque recibido y se puede cambiar", async () => {
    const user = userEvent.setup();
    renderModal("prod-cigar-pack");

    await screen.findByText(/Stock empaque: 5/);
    expect(getPackField()).toHaveValue("Caja cigarros (x10)");

    await user.click(screen.getByRole("button", { name: "Limpiar Producto empaque" }));

    expect(getPackField()).toHaveValue("");
    expect(screen.queryByText(/Stock empaque/)).toBeNull();
  });

  it("un producto que no es empaque no se precarga; enviar sin empaque avisa y no envía", async () => {
    const { api, gets } = renderModal("prod-cigar-unit");

    await waitFor(() => expect(gets).toHaveLength(1));
    await waitFor(() => expect(getPackField()).toBeEnabled());
    expect(getPackField()).toHaveValue("");

    fireEvent.submit(getForm());

    expect(screen.getByText("Selecciona un empaque.")).toBeVisible();
    expect(getPackField()).toHaveAttribute("aria-invalid", "true");
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
  });
});

describe("InventoryPackConversionModal · aviso de cantidad (SHR-09G)", () => {
  function getQuantityInput() {
    return screen.getByLabelText<HTMLInputElement>("Cantidad de empaques");
  }

  async function renderOpen(conversions = packConversions) {
    const api = installFetchStub(() => conversions);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
    await screen.findByText(/Stock empaque: /);

    return api;
  }

  it("al abrir no muestra ningun aviso", async () => {
    await renderOpen();

    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Indica una cantidad mayor a cero.")).not.toBeInTheDocument();
  });

  it.each(["0", ""])("cantidad %p: avisa y no envia", async (value) => {
    const api = await renderOpen();

    fireEvent.change(getQuantityInput(), { target: { value } });

    expect(screen.getByText("Indica una cantidad mayor a cero.")).toBeVisible();
    expect(getQuantityInput()).toHaveAttribute("aria-invalid", "true");
    expect(getQuantityInput()).toHaveAccessibleDescription("Indica una cantidad mayor a cero.");

    fireEvent.submit(getForm());

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    expect(screen.getByText("Indica una cantidad mayor a cero.")).toBeVisible();
  });

  it("cantidad mayor que el stock: dice cuantos empaques hay y no envia", async () => {
    const api = await renderOpen();

    fireEvent.change(getQuantityInput(), { target: { value: "6" } });

    expect(screen.getByText("Solo hay 5 empaque(s) en stock.")).toBeVisible();
    expect(getQuantityInput()).toHaveAccessibleDescription("Solo hay 5 empaque(s) en stock.");
    // Sin `max`: la cantidad tecleada no se corrige en silencio.
    fireEvent.blur(getQuantityInput());
    expect(getQuantityInput()).toHaveValue("6");

    fireEvent.submit(getForm());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // CNF-08: el empaque quedaría en negativo; se frena antes de la confirmación.
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
  });

  it("empaque sin stock: el aviso aparece al intentar enviar, no antes", async () => {
    const api = await renderOpen([
      { ...packConversions[0], packProduct: { ...packConversions[0].packProduct, currentStock: 0 } },
    ]);

    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.submit(getForm());

    expect(screen.getByText("No hay empaques en stock para abrir.")).toBeVisible();
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
  });

  it("cantidad valida: un solo POST con el mismo payload de siempre", async () => {
    const api = await renderOpen();
    api.respondToNextPost(conversionResult);

    fireEvent.change(getQuantityInput(), { target: { value: "2" } });
    expect(getQuantityInput()).not.toHaveAttribute("aria-invalid");

    await submitAndConfirm();
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 2,
      reason: REASON,
    });
  });
});

describe("InventoryPackConversionModal · idempotencia (C6)", () => {
  it("doble envio = un solo POST, con clave, y el boton queda deshabilitado", async () => {
    const api = installFetchStub(() => packConversions);
    const release = api.holdNextPost(conversionResult);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    await openDialog();

    fillReason();
    fireEvent.submit(getForm());
    fireEvent.submit(getForm());

    const dialog = await screen.findByRole("dialog", { name: CONFIRM_TITLE });

    // Abrir la confirmación no envía nada.
    expect(api.posts).toHaveLength(0);
    fireEvent.click(confirmButton(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Convertir empaque|Procesando/ }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Procesando..." })).toBeDisabled(),
    );
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/conversions");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 1,
      reason: REASON,
    });

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());
    expect(api.posts).toHaveLength(1);
  });

  it("el reintento tras un error de red reutiliza la misma clave", async () => {
    const api = installFetchStub(() => packConversions);
    api.networkErrorOnNextPost();
    api.respondToNextPost(conversionResult);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    await openDialog();

    const dialog = await submitAndConfirm();

    // El error se dice dentro de la confirmación, que sigue abierta para reintentar.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /No pudimos confirmar si el movimiento se registró/,
    );
    expect(document.getElementById("inventory-pack-conversion-form")).not.toBeNull();

    await waitFor(() => expect(confirmButton(dialog)).toBeEnabled());
    fireEvent.click(confirmButton(dialog));
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());

    expect(api.posts).toHaveLength(2);
    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
  });

  it("tras un 4xx definitivo, cambiar el contenido estrena clave", async () => {
    const api = installFetchStub(() => packConversions);
    api.respondToNextPost({ error: { code: "BAD_REQUEST", message: "Dato inválido" } }, 400);
    api.respondToNextPost(conversionResult);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    await openDialog();

    const dialog = await submitAndConfirm();

    // El mensaje del servidor se muestra tal cual, dentro de la confirmación.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Dato inválido");
    await cancelConfirm(dialog);

    fireEvent.change(screen.getByLabelText("Cantidad de empaques"), { target: { value: "2" } });
    await submitAndConfirm();
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.packQuantity).toBe(2);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});

describe("InventoryPackConversionModal · cantidad entera (SHR-09J)", () => {
  async function renderOpen() {
    const api = installFetchStub(() => packConversions);

    render(<InventoryPackConversionModal defaultPackProductId="prod-cigar-pack" />, {
      wrapper: createQueryWrapper(),
    });
    await openDialog();

    return api;
  }

  it.each(["2.5", "2,5"])("cantidad %p: se ve 2.5, avisa y no envia (ni con Enter ni con el boton)", async (typed) => {
    const user = userEvent.setup();
    const api = await renderOpen();
    const quantity = screen.getByLabelText("Cantidad de empaques");

    await user.clear(quantity);
    await user.type(quantity, `${typed}{Enter}`);

    expect(quantity).toHaveValue("2.5");
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();

    fireEvent.submit(getForm());
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(api.posts).toHaveLength(0);
    expect(quantity).toHaveValue("2.5");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
  });

  it.each(["Enter", "boton"])("cantidad 3 enviada con %s: un solo POST con el payload de siempre", async (how) => {
    const user = userEvent.setup();
    const api = await renderOpen();
    api.respondToNextPost(conversionResult);
    const quantity = screen.getByLabelText("Cantidad de empaques");

    await user.clear(quantity);
    await user.type(quantity, "3");
    fillReason();

    if (how === "Enter") {
      await user.keyboard("{Enter}");
      // El pie queda fuera del <form> (boton asociado con `form=`): user-event solo
      // envia con Enter si el boton esta dentro o el formulario tiene un unico <input>,
      // y con el buscador ya son dos. El envio implicito se simula aparte.
      fireEvent.submit(getForm());
    } else {
      await user.click(screen.getByRole("button", { name: "Continuar" }));
    }

    await user.click(confirmButton(await screen.findByRole("dialog", { name: CONFIRM_TITLE })));
    await waitFor(() => expect(document.getElementById("inventory-pack-conversion-form")).toBeNull());

    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toEqual({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      packProductId: "prod-cigar-pack",
      packQuantity: 3,
      reason: REASON,
    });
  });
});
