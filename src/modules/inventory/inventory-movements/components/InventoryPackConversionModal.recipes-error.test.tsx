import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createQueryWrapper, jsonResponse } from "../../utils/requestAttempt.testUtils";
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
    id: "ppc-water",
    linkedProduct: linked("prod-water-unit", "Agua 600 ml", "AGU-UNI-001", 0),
    packProduct: linked("prod-water-pack", "Bulto de agua (x24)", "AGU-BUL-024", 7),
    role: "pack",
    unitsPerPack: 24,
  },
];

/**
 * INV-F5 · M4: si `GET /api/inventory/pack-conversions` falla, el modal lo dice
 * y ofrece reintentar; antes abría un buscador vacío, como si no hubiera empaques.
 */
describe("InventoryPackConversionModal · recetas caídas (INV-F5 · M4)", () => {
  function installApi() {
    const state = { failing: true, posts: 0 };

    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        state.posts += 1;
      }

      return state.failing
        ? jsonResponse(
            { error: { code: "INTERNAL_ERROR", message: "Ocurrio un error inesperado." } },
            500,
          )
        : jsonResponse({ data: packConversions });
    }) as unknown as typeof fetch;

    return state;
  }

  function openModal() {
    render(<InventoryPackConversionModal />, { wrapper: createQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));
  }

  it("muestra el error con Reintentar y no deja enviar", async () => {
    const api = installApi();

    openModal();

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("No pudimos cargar los empaques");
    expect(alert).toHaveTextContent("Ocurrio un error inesperado.");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    // Ni buscador vacío ni botón de envío: no hay nada que convertir.
    expect(screen.queryByRole("combobox", { name: "Producto empaque" })).toBeNull();
    expect(screen.queryByText("Solo empaques con receta activa.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Convertir empaque" })).toBeNull();
    expect(api.posts).toBe(0);
  });

  it("Reintentar vuelve a pedir las recetas y recupera el formulario", async () => {
    const user = userEvent.setup();
    const api = installApi();

    openModal();
    await screen.findByRole("alert");

    api.failing = false;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    const field = await screen.findByRole("combobox", { name: "Producto empaque" });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await user.type(field, "agu");
    expect(await screen.findByRole("option", { name: /Bulto de agua/ })).toBeInTheDocument();
  });

  it("mientras cargan las recetas lo dice en el campo", async () => {
    let release: (response: Response) => void = () => undefined;

    global.fetch = jest.fn(
      () => new Promise<Response>((resolve) => (release = resolve)),
    ) as unknown as typeof fetch;

    openModal();

    expect(await screen.findByText("Cargando empaques…")).toBeInTheDocument();

    release(jsonResponse({ data: packConversions }));

    expect(await screen.findByText("Solo empaques con receta activa.")).toBeInTheDocument();
  });
});

/** INV-F5 · M3: el motivo de la conversión tiene el mismo tope que el del ajuste. */
describe("InventoryPackConversionModal · tope del motivo (INV-F5 · M3)", () => {
  it("el motivo admite hasta 500 caracteres y dice cuántos lleva", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ data: packConversions }),
    ) as unknown as typeof fetch;

    render(<InventoryPackConversionModal />, { wrapper: createQueryWrapper() });
    fireEvent.click(screen.getByRole("button", { name: "Convertir empaque" }));

    const reason = await screen.findByLabelText("Motivo");

    expect(reason).toHaveAttribute("maxlength", "500");
    expect(screen.getByText("0 de 500 caracteres.")).toBeInTheDocument();
  });
});
