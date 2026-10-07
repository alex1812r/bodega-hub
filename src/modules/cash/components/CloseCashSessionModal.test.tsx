import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CloseCashSessionModal } from "./CloseCashSessionModal";

const mutateAsync = jest.fn();

jest.mock("../hooks/useCash", () => ({
  useCloseCashSession: () => ({ isPending: false, mutateAsync }),
}));

function renderModal() {
  render(
    <CloseCashSessionModal
      onOpenChange={jest.fn()}
      open
      openingRef={10}
      openingVes={500}
      registerName="Caja 1"
      sessionId="session-1"
      theoreticalRef={25.5}
      theoreticalVes={1500.25}
    />,
  );
}

describe("CloseCashSessionModal · NumberInput (SHR-09)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it("prellena con el teorico y lo envia sin tocar", async () => {
    const user = userEvent.setup();

    renderModal();

    const ves = screen.getByLabelText("Efectivo contado Bs. (cajon completo)");

    expect(ves).toHaveAttribute("type", "text");
    expect(ves).toHaveValue("1500.25");

    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      closingRef: 25.5,
      closingVes: 1500.25,
      sessionId: "session-1",
    });
  });

  it("un monto con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();

    renderModal();

    const ves = screen.getByLabelText("Efectivo contado Bs. (cajon completo)");
    const ref = screen.getByLabelText("Efectivo contado REF (cajon completo)");

    await user.clear(ves);
    await user.type(ves, "1499,995");
    await user.clear(ref);
    await user.type(ref, "25.444");
    await user.click(screen.getByRole("button", { name: "Cerrar caja" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      closingRef: 25.44,
      closingVes: 1500,
      sessionId: "session-1",
    });
  });
});
