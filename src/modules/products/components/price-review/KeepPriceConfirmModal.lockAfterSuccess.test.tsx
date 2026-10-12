import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KeepPriceConfirmModal } from "./KeepPriceConfirmModal";

// GQ-09: `keep_product_price` no tiene clave de idempotencia: un segundo POST es otra fila
// de historial. El modal de confirmación se sustituye por un botón que SIEMPRE llama a
// `onConfirm` (la ventana en que el modal real se está cerrando tras el éxito).
const mockMutateAsync = jest.fn();

jest.mock("../../../../shared/components/ConfirmActionModal", () => ({
  ConfirmActionModal: ({
    confirmLabel,
    onConfirm,
  }: {
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  }) => (
    <button onClick={() => void Promise.resolve(onConfirm()).catch(() => undefined)} type="button">
      {confirmLabel}
    </button>
  ),
}));
jest.mock("../../hooks/usePriceReview", () => ({
  COST_CHANGED_LEFT_QUEUE_TITLE: "El costo cambió",
  useCostConflictRefresh: () => ({ fetchProduct: jest.fn().mockResolvedValue(null) }),
  useKeepProductPrice: () => ({
    error: null,
    isPending: false,
    mutateAsync: mockMutateAsync,
    reset: jest.fn(),
  }),
}));
jest.mock("./freshPricing", () => ({
  useFreshProductPricing: () => ({
    fresh: { currentCostRef: 10, currentPriceRef: 12 },
    refetch: jest.fn(),
    status: "ready",
  }),
}));

const product = { currentCostRef: 10, id: "p-1", name: "Arroz", salePriceRef: 12 };

function modal(open: boolean) {
  // El padre ignora `onOpenChange`: el modal sigue montado y abierto tras el éxito.
  return <KeepPriceConfirmModal onOpenChange={() => undefined} open={open} product={product} />;
}

describe("KeepPriceConfirmModal · un POST por decisión (GQ-09)", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
  });

  it("en vuelo y tras el éxito no envía otra vez; al cerrarse y reabrirse vuelve a aceptar", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;

    mockMutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const { rerender } = render(modal(true));
    const confirm = () => screen.getByRole("button", { name: "Mantener precio" });

    // En vuelo: dos clics en el mismo tick.
    fireEvent.click(confirm());
    fireEvent.click(confirm());
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(mockMutateAsync.mock.results[0].value).resolves.toBeUndefined());

    // Tras el éxito, con el modal aún a la vista.
    await user.click(confirm());
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    // Otra apertura es otra decisión.
    rerender(modal(false));
    rerender(modal(true));
    await user.click(confirm());
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("un rechazo del servidor deja reintentar", async () => {
    const user = userEvent.setup();

    mockMutateAsync.mockRejectedValueOnce(new Error("El costo cambió")).mockResolvedValueOnce(undefined);
    render(modal(true));

    await user.click(screen.getByRole("button", { name: "Mantener precio" }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Mantener precio" }));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
  });
});
