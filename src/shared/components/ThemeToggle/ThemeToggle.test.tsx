import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";

import { ThemeProvider } from "@/shared/theme/ThemeProvider";

import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
  });

  it("toggles between light and dark theme", () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(getByLabelText(/cambiar a tema oscuro/i));

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("control-ventas:theme")).toBe("dark");
  });
});
