/**
 * INV-F2 · ajuste de stock: la clave de idempotencia solo se repite con el
 * mismo contenido (F1), el modal no se cierra con el envío en vuelo (F2) y el
 * error de red se dice en español (F3).
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { UNCERTAIN_STOCK_REQUEST_MESSAGE } from "../../utils/stockRequestError";
import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

function product(id: string, name: string, sku: string, currentStock: number) {
  return {
    barcode: null,
    categoryId: "cat-1",
    currentCostRef: 1,
    currentStock,
    id,
    isActive: true,
    name,
    salePriceRef: 2,
    sku,
  };
}

const catalog = [
  product("prod-a", "Producto A", "QA-A", 11),
  product("prod-b", "Producto B", "QA-B", 0),
];

function products(url: string) {
  const { pathname } = new URL(url, "http://localhost");
  const found = catalog.find((item) => pathname === `/api/products/${item.id}`);

  if (!found) {
    throw new Error(`GET inesperado en el test: ${url}`);
  }

  return found;
}

const formId = "inventory-adjustment-form";

function getForm() {
  return document.getElementById(formId) as HTMLFormElement;
}

function setQuantity(value: string) {
  fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value } });
}

async function openWith(productLabel: string, quantity: string) {
  fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Producto" })).toHaveValue(productLabel),
  );
  setQuantity(quantity);
}

async function closeWithEscape() {
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Ajuste de stock" }), { key: "Escape" });
  await waitFor(() => expect(document.getElementById(formId)).toBeNull());
}

/** Deja pasar el cierre diferido del Modal (setTimeout 0). */
async function flushDeferredClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("InventoryAdjustmentModal · clave tras un resultado incierto (INV-F2 · F1)", () => {
  it("respuesta perdida → Esc → ajuste de OTRO producto: clave nueva y sin el error anterior", async () => {
    const api = installFetchStub(products);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "mov-2" } });

    const Wrapper = createQueryWrapper();
    const { rerender } = render(
      <Wrapper>
        <InventoryAdjustmentModal defaultProductId="prod-a" />
      </Wrapper>,
    );
    await openWith("Producto A (QA-A)", "1");
    fireEvent.submit(getForm());
    await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);

    await closeWithEscape();
    rerender(
      <Wrapper>
        <InventoryAdjustmentModal defaultProductId="prod-b" />
      </Wrapper>,
    );
    await openWith("Producto B (QA-B)", "7");

    expect(screen.queryByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).not.toBeInTheDocument();

    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body).toMatchObject({ productId: "prod-b", quantityDelta: 7 });
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("respuesta perdida → cerrar y reabrir con el MISMO contenido: clave nueva", async () => {
    const api = installFetchStub(products);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "mov-2" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-a" />, {
      wrapper: createQueryWrapper(),
    });
    await openWith("Producto A (QA-A)", "1");
    fireEvent.submit(getForm());
    await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);

    await closeWithEscape();
    await openWith("Producto A (QA-A)", "1");
    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("respuesta perdida → cambiar la cantidad sin cerrar: clave nueva", async () => {
    const api = installFetchStub(products);
    api.networkErrorOnNextPost();
    api.respondToNextPost({ data: { id: "mov-2" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-a" />, {
      wrapper: createQueryWrapper(),
    });
    await openWith("Producto A (QA-A)", "1");
    fireEvent.submit(getForm());
    await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE);

    setQuantity("5");
    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(2));

    expect(api.posts[1]?.body.quantityDelta).toBe(5);
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });

  it("409 → mismo contenido: misma clave; 409 → cambiar el motivo: clave nueva", async () => {
    const api = installFetchStub(products);
    const conflict = { error: { code: "CONFLICT", message: "Stock insuficiente" } };
    api.respondToNextPost(conflict, 409);
    api.respondToNextPost(conflict, 409);
    api.respondToNextPost({ data: { id: "mov-1" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-a" />, {
      wrapper: createQueryWrapper(),
    });
    await openWith("Producto A (QA-A)", "1");
    fireEvent.submit(getForm());
    // El 409 trae respuesta del servidor: se muestra tal cual.
    await screen.findByText("Stock insuficiente");

    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Registrar movimiento" })).toBeEnabled(),
    );

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "conteo" } });
    fireEvent.submit(getForm());
    await waitFor(() => expect(api.posts).toHaveLength(3));

    expect(api.posts[1]?.body.clientRequestId).toBe(api.posts[0]?.body.clientRequestId);
    expect(api.posts[2]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});

describe("InventoryAdjustmentModal · envío en vuelo (INV-F2 · F2)", () => {
  it("Esc, «Cancelar» y «Cerrar modal» no cierran y los campos quedan deshabilitados", async () => {
    const api = installFetchStub(products);
    const onOpenChange = jest.fn();
    const release = api.holdNextPost({ data: { id: "mov-1" } });

    render(<InventoryAdjustmentModal defaultProductId="prod-a" onOpenChange={onOpenChange} />, {
      wrapper: createQueryWrapper(),
    });
    await openWith("Producto A (QA-A)", "2");
    fireEvent.submit(getForm());
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrando..." })).toBeDisabled());

    expect(screen.getByRole("combobox", { name: "Producto" })).toBeDisabled();
    expect(screen.getByLabelText("Tipo de movimiento")).toBeDisabled();
    expect(screen.getByLabelText("Cantidad")).toBeDisabled();
    expect(screen.getByLabelText("Motivo")).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Ajuste de stock" }), { key: "Escape" });
    await flushDeferredClose();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await flushDeferredClose();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar modal" }));
    await flushDeferredClose();

    expect(document.getElementById(formId)).not.toBeNull();
    expect(screen.getByLabelText("Cantidad")).toHaveValue("2");
    expect(onOpenChange.mock.calls).toEqual([[true]]);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.getElementById(formId)).toBeNull());
    expect(api.posts).toHaveLength(1);
  });

  it("si la petición en vuelo falla, el error se ve porque el modal siguió abierto", async () => {
    const api = installFetchStub(products);
    const release = api.holdNextPost({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500);

    render(<InventoryAdjustmentModal defaultProductId="prod-a" />, {
      wrapper: createQueryWrapper(),
    });
    await openWith("Producto A (QA-A)", "2");
    fireEvent.submit(getForm());
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrando..." })).toBeDisabled());

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Ajuste de stock" }), { key: "Escape" });
    await flushDeferredClose();
    await act(async () => {
      release();
    });

    expect(await screen.findByText(UNCERTAIN_STOCK_REQUEST_MESSAGE)).toBeVisible();
    expect(screen.getByLabelText("Cantidad")).toBeEnabled();
  });
});

describe("InventoryAdjustmentModal · texto del error (INV-F2 · F3)", () => {
  it("un error de red no muestra «Failed to fetch» sino el aviso de resultado incierto", async () => {
    const api = installFetchStub(products);
    api.networkErrorOnNextPost();

    render(<InventoryAdjustmentModal defaultProductId="prod-a" />, {
      wrapper: createQueryWrapper(),
    });
    await openWith("Producto A (QA-A)", "1");
    fireEvent.submit(getForm());

    expect(
      await screen.findByText(
        "No pudimos confirmar si el movimiento se registró. Revisa los movimientos del producto antes de volver a intentarlo.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
  });
});
