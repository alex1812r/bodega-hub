import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";

import { Pagination } from "./Pagination";
import {
  getCurrentPage,
  getItemRange,
  getSkipForPage,
  getTotalPages,
  getVisiblePageRange,
} from "./pagination-utils";

describe("pagination-utils", () => {
  it("derives page values from skip and limit", () => {
    expect(getCurrentPage(0, 10)).toBe(1);
    expect(getCurrentPage(20, 10)).toBe(3);
    expect(getTotalPages(95, 10)).toBe(10);
    expect(getSkipForPage(3, 10)).toBe(20);
    expect(getItemRange(20, 10, 95)).toEqual({ from: 21, to: 30 });
  });

  it("builds visible page ranges with ellipsis", () => {
    expect(getVisiblePageRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getVisiblePageRange(10, 25)).toEqual([1, -1, 9, 10, 11, -1, 25]);
  });
});

describe("Pagination", () => {
  it("renders range and page summary", () => {
    const { getByRole, getByText } = render(
      <Pagination limit={10} onSkipChange={jest.fn()} skip={20} total={95} />,
    );

    expect(getByText("21")).toBeVisible();
    expect(getByText("30")).toBeVisible();
    expect(getByText("95")).toBeVisible();
    expect(getByRole("button", { name: /ir a página 3/i })).toHaveAttribute("aria-current", "page");
    expect(getByText(/página/i)).toHaveTextContent("Página 3 de 10");
  });

  it("navigates to previous and next pages", () => {
    const onSkipChange = jest.fn();

    const { getByRole } = render(
      <Pagination limit={10} onSkipChange={onSkipChange} skip={20} total={95} />,
    );

    fireEvent.click(getByRole("button", { name: /página anterior/i }));
    expect(onSkipChange).toHaveBeenCalledWith(10);

    fireEvent.click(getByRole("button", { name: /página siguiente/i }));
    expect(onSkipChange).toHaveBeenCalledWith(30);
  });

  it("disables boundary navigation buttons", () => {
    const { getByRole, rerender } = render(
      <Pagination limit={10} onSkipChange={jest.fn()} skip={0} total={95} />,
    );

    expect(getByRole("button", { name: /página anterior/i })).toBeDisabled();

    rerender(<Pagination limit={10} onSkipChange={jest.fn()} skip={90} total={95} />);

    expect(getByRole("button", { name: /página siguiente/i })).toBeDisabled();
  });

  it("changes page when clicking a page button", () => {
    const onSkipChange = jest.fn();

    const { getByRole } = render(
      <Pagination limit={10} onSkipChange={onSkipChange} skip={0} total={95} />,
    );

    fireEvent.click(getByRole("button", { name: /ir a página 4/i }));

    expect(onSkipChange).toHaveBeenCalledWith(30);
  });

  it("updates limit and resets skip when page size changes", () => {
    const onSkipChange = jest.fn();
    const onLimitChange = jest.fn();

    const { getByLabelText } = render(
      <Pagination
        limit={10}
        onLimitChange={onLimitChange}
        onSkipChange={onSkipChange}
        skip={20}
        total={95}
      />,
    );

    fireEvent.change(getByLabelText(/resultados por página/i), { target: { value: "25" } });

    expect(onLimitChange).toHaveBeenCalledWith(25);
    expect(onSkipChange).toHaveBeenCalledWith(0);
  });

  it("shows empty state copy when total is zero", () => {
    const { getByText } = render(
      <Pagination limit={10} onSkipChange={jest.fn()} skip={0} total={0} />,
    );

    expect(getByText("Sin resultados")).toBeVisible();
  });

  it("renders embedded variant without card chrome", () => {
    const { getByRole } = render(
      <Pagination limit={10} onSkipChange={jest.fn()} skip={0} total={25} variant="embedded" />,
    );

    expect(getByRole("navigation")).not.toHaveClass("border");
    expect(getByRole("navigation")).not.toHaveClass("shadow-sm");
  });

  describe("ancho de móvil (390 px)", () => {
    function renderStitch() {
      return render(
        <Pagination
          entityLabel="productos"
          limit={10}
          onSkipChange={jest.fn()}
          skip={90}
          total={250}
          variant="stitch"
        />,
      );
    }

    it("stitch: el contenedor envuelve línea en lugar de desbordar", () => {
      const { getByRole } = renderStitch();
      const nav = getByRole("navigation");

      expect(nav).toHaveClass("flex-wrap", "max-w-full", "min-w-0");
      // El resumen ya no impone su ancho: puede partir línea.
      expect(nav.querySelector("p")).not.toHaveClass("shrink-0");
    });

    it("stitch: Anterior y Siguiente son flechas en móvil y conservan su nombre accesible", () => {
      const { getByRole } = renderStitch();

      for (const name of ["Anterior", "Siguiente"]) {
        const button = getByRole("button", { name });

        expect(button.querySelector("span")).toHaveClass("sr-only", "sm:not-sr-only");
        expect(button.querySelector("svg")).toHaveClass("sm:hidden");
        expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      }
    });

    it("stitch: los números de página solo se muestran desde sm; en móvil queda «Página X de Y»", () => {
      const { container, getByRole } = renderStitch();
      const pages = container.querySelector("[data-pagination-pages]");
      const label = container.querySelector("[data-pagination-page-label]");

      expect(pages).toHaveClass("hidden", "sm:flex");
      expect(pages).toContainElement(getByRole("button", { name: /ir a página 10/i }));
      expect(label).toHaveClass("sm:hidden", "whitespace-nowrap");
      expect(label).toHaveTextContent("Página 10 de 25");
    });

    it("stitch: Siguiente sigue navegando", () => {
      const onSkipChange = jest.fn();
      const { getByRole } = render(
        <Pagination limit={10} onSkipChange={onSkipChange} skip={90} total={250} variant="stitch" />,
      );

      fireEvent.click(getByRole("button", { name: "Siguiente" }));
      expect(onSkipChange).toHaveBeenCalledWith(100);

      fireEvent.click(getByRole("button", { name: "Anterior" }));
      expect(onSkipChange).toHaveBeenCalledWith(80);
    });

    it.each(["default", "embedded"] as const)(
      "%s: oculta los números en móvil y no duplica el texto de página",
      (variant) => {
        const { container, getAllByText } = render(
          <Pagination
            limit={10}
            onLimitChange={jest.fn()}
            onSkipChange={jest.fn()}
            skip={90}
            total={250}
            variant={variant}
          />,
        );

        expect(container.querySelector("[data-pagination-pages]")).toHaveClass("hidden", "sm:flex");
        expect(container.querySelector("[data-pagination-page-label]")).toBeNull();
        expect(getAllByText(/^Página/)).toHaveLength(1);
        expect(container.querySelector("[data-pagination-controls]")).toHaveClass("flex-wrap", "min-w-0");
      },
    );
  });

  it("renders compact variant without numbered page buttons", () => {
    const { getByRole, queryByRole } = render(
      <Pagination
        limit={10}
        onLimitChange={jest.fn()}
        onSkipChange={jest.fn()}
        skip={0}
        total={59}
        variant="compact"
      />,
    );

    expect(getByRole("navigation")).toHaveTextContent("Página 1 de 6");
    expect(queryByRole("button", { name: /ir a página 2/i })).not.toBeInTheDocument();
    expect(getByRole("button", { name: /página siguiente/i })).toBeEnabled();
  });
});
