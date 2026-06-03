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
    expect(getByRole("button", { name: /ir a pagina 3/i })).toHaveAttribute("aria-current", "page");
    expect(getByText(/pagina/i)).toHaveTextContent("Pagina 3 de 10");
  });

  it("navigates to previous and next pages", () => {
    const onSkipChange = jest.fn();

    const { getByRole } = render(
      <Pagination limit={10} onSkipChange={onSkipChange} skip={20} total={95} />,
    );

    fireEvent.click(getByRole("button", { name: /pagina anterior/i }));
    expect(onSkipChange).toHaveBeenCalledWith(10);

    fireEvent.click(getByRole("button", { name: /pagina siguiente/i }));
    expect(onSkipChange).toHaveBeenCalledWith(30);
  });

  it("disables boundary navigation buttons", () => {
    const { getByRole, rerender } = render(
      <Pagination limit={10} onSkipChange={jest.fn()} skip={0} total={95} />,
    );

    expect(getByRole("button", { name: /pagina anterior/i })).toBeDisabled();

    rerender(<Pagination limit={10} onSkipChange={jest.fn()} skip={90} total={95} />);

    expect(getByRole("button", { name: /pagina siguiente/i })).toBeDisabled();
  });

  it("changes page when clicking a page button", () => {
    const onSkipChange = jest.fn();

    const { getByRole } = render(
      <Pagination limit={10} onSkipChange={onSkipChange} skip={0} total={95} />,
    );

    fireEvent.click(getByRole("button", { name: /ir a pagina 4/i }));

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

    fireEvent.change(getByLabelText(/resultados por pagina/i), { target: { value: "25" } });

    expect(onLimitChange).toHaveBeenCalledWith(25);
    expect(onSkipChange).toHaveBeenCalledWith(0);
  });

  it("shows empty state copy when total is zero", () => {
    const { getByText } = render(
      <Pagination limit={10} onSkipChange={jest.fn()} skip={0} total={0} />,
    );

    expect(getByText("Sin resultados")).toBeVisible();
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

    expect(getByRole("navigation")).toHaveTextContent("Pagina 1 de 6");
    expect(queryByRole("button", { name: /ir a pagina 2/i })).not.toBeInTheDocument();
    expect(getByRole("button", { name: /pagina siguiente/i })).toBeEnabled();
  });
});
