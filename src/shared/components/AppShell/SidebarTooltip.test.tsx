import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import { SidebarTooltip } from "./SidebarTooltip";

const anchorRect = {
  bottom: 739,
  height: 44,
  left: 8,
  right: 72,
  top: 695,
  width: 64,
  x: 8,
  y: 695,
  toJSON: () => ({}),
};

function renderInScrollingRail(placement?: "bottom" | "right") {
  return render(
    <div className="overflow-x-hidden overflow-y-auto" data-testid="rail">
      <SidebarTooltip label="Configuración" placement={placement} show>
        <a aria-label="Configuración" href="/settings">
          icono
        </a>
      </SidebarTooltip>
    </div>,
  );
}

describe("SidebarTooltip", () => {
  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(anchorRect);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders only the children when it is not shown", () => {
    render(
      <SidebarTooltip label="Configuración" show={false}>
        <a href="/settings">Configuración</a>
      </SidebarTooltip>,
    );

    fireEvent.mouseEnter(screen.getByRole("link"));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("paints the right tooltip outside the scrolling rail, fixed next to the icon", () => {
    renderInScrollingRail("right");
    const link = screen.getByRole("link", { name: "Configuración" });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(link);

    const tooltip = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("Configuración");
    expect(screen.getByTestId("rail")).not.toContainElement(tooltip);
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip).toHaveClass("fixed");
    expect(tooltip).toHaveStyle({ left: "80px", top: "717px" });
  });

  it("keeps the tooltip inside the viewport when the icon touches an edge", () => {
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ ...anchorRect, bottom: 790, top: 778, height: 12, y: 778 });
    renderInScrollingRail("right");

    fireEvent.mouseEnter(screen.getByRole("link", { name: "Configuración" }));

    expect(screen.getByRole("tooltip")).toHaveStyle({ top: `${window.innerHeight - 20}px` });
  });

  it("shows on keyboard focus and hides on blur", () => {
    renderInScrollingRail("right");
    const link = screen.getByRole("link", { name: "Configuración" });

    fireEvent.focus(link);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(link);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides when the pointer leaves", () => {
    renderInScrollingRail("right");
    const link = screen.getByRole("link", { name: "Configuración" });

    fireEvent.mouseEnter(link);
    fireEvent.mouseLeave(link);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides when the rail scrolls or the window is resized, so it never drifts from its icon", () => {
    renderInScrollingRail("right");
    const link = screen.getByRole("link", { name: "Configuración" });

    fireEvent.mouseEnter(link);
    fireEvent.scroll(screen.getByTestId("rail"));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(link);
    fireEvent(window, new Event("resize"));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps the bottom placement in flow under its anchor", () => {
    renderInScrollingRail("bottom");

    const tooltip = screen.getByRole("tooltip");

    expect(screen.getByTestId("rail")).toContainElement(tooltip);
    expect(tooltip).toHaveClass("absolute", "top-full");
  });
});
