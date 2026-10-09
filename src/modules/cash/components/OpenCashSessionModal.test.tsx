import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OpenCashSessionModal } from "./OpenCashSessionModal";

// El guardia de datos tecleados (CNF-15) usa el router del App Router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mutateAsync = jest.fn();

jest.mock("../hooks/useCash", () => ({
  useLastUntransferredClosure: () => ({ data: null, isFetching: false, isLoading: false }),
  useOpenCashSession: () => ({ isPending: false, mutateAsync }),
}));

describe("OpenCashSessionModal · NumberInput (SHR-09)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it("los montos son campos de texto y el payload sale redondeado a 2 decimales", async () => {
    const user = userEvent.setup();

    render(
      <OpenCashSessionModal onOpenChange={jest.fn()} open registerId="reg-1" registerName="Caja 1" />,
    );

    const ves = screen.getByLabelText("Apertura Bs.");
    const ref = screen.getByLabelText("Apertura REF");

    expect(ves).toHaveAttribute("type", "text");
    expect(ref).toHaveAttribute("type", "text");

    await user.type(ves, "100,555");
    await user.type(ref, "12.344");
    await user.click(screen.getByRole("button", { name: "Abrir caja" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      openingRef: 12.34,
      openingVes: 100.56,
      registerId: "reg-1",
    });
  });
});
