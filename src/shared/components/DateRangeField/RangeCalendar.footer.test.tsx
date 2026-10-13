/**
 * REP-F6 · con un rango ya elegido el pie del calendario decía «Elige el día de
 * inicio.», como si no hubiera nada. El pie cuenta el estado: sin rango, con el
 * inicio elegido, o con el rango ya puesto.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RangeCalendar } from "./RangeCalendar";

const TODAY = "2026-10-09";

function footer() {
  return screen.getByTestId("range-calendar-hint");
}

describe("RangeCalendar · pie según el estado", () => {
  it("sin rango pide el día de inicio", () => {
    render(<RangeCalendar onSelectRange={jest.fn()} today={TODAY} />);

    expect(footer()).toHaveTextContent("Elige el día de inicio.");
    expect(footer()).toHaveAttribute("aria-live", "polite");
  });

  it("con un rango ya elegido lo muestra y dice cómo cambiarlo", () => {
    render(<RangeCalendar from="2026-09-01" onSelectRange={jest.fn()} to="2026-09-30" today={TODAY} />);

    expect(footer()).toHaveTextContent("Rango elegido: 1–30 sep 2026. Elige un día para cambiarlo.");
    expect(footer()).not.toHaveTextContent("Elige el día de inicio");
  });

  it("al elegir el inicio pide el día de fin, también si ya había un rango", async () => {
    const user = userEvent.setup();

    render(<RangeCalendar from="2026-09-01" onSelectRange={jest.fn()} to="2026-09-30" today={TODAY} />);
    await user.click(screen.getByRole("button", { name: "lunes, 7 de septiembre de 2026" }));

    expect(footer()).toHaveTextContent("Elige el día de fin.");
  });

  it("con un solo extremo (rango abierto) sigue pidiendo el inicio", () => {
    render(<RangeCalendar from="2026-09-01" onSelectRange={jest.fn()} today={TODAY} />);

    expect(footer()).toHaveTextContent("Elige el día de inicio.");
  });
});
