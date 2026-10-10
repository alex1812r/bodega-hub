import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { getRolePermissions, type UserRole } from "@/shared/auth/permissions";

import { AppNavLinks } from "./AppNavLinks";
import { buildAppNavGroups, getAppNavGroupStorageKey } from "./appShellNav";

function renderNav(role: UserRole, currentPath: string, collapsed = false) {
  const groups = buildAppNavGroups({ permissions: getRolePermissions(role), role });

  return render(<AppNavLinks collapsed={collapsed} currentPath={currentPath} groups={groups} />);
}

function groupHeader(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("AppNavLinks", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders one header button per visible group in the role order", () => {
    renderNav("contador", "/dashboard");

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Dinero",
      "Análisis",
      "Operación",
    ]);
    expect(screen.queryByRole("button", { name: /configuración/i })).not.toBeInTheDocument();
  });

  it("opens the default groups of the role and keeps the rest closed", () => {
    renderNav("admin", "/dashboard");

    expect(groupHeader(/operación/i)).toHaveAttribute("aria-expanded", "true");
    expect(groupHeader(/dinero/i)).toHaveAttribute("aria-expanded", "true");
    expect(groupHeader(/análisis/i)).toHaveAttribute("aria-expanded", "false");
    expect(groupHeader(/configuración/i)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Baúl" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Reportes" })).not.toBeInTheDocument();
  });

  it("collapses and expands a group and remembers it", () => {
    const { unmount } = renderNav("admin", "/dashboard");
    const header = groupHeader(/dinero/i);

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Baúl" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(getAppNavGroupStorageKey("money"))).toBe("closed");

    unmount();
    renderNav("admin", "/dashboard");

    expect(groupHeader(/dinero/i)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(groupHeader(/dinero/i));

    expect(groupHeader(/dinero/i)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Baúl" })).toBeVisible();
  });

  it("always opens the group of the active route on load, even if it was stored closed", () => {
    window.localStorage.setItem(getAppNavGroupStorageKey("settings"), "closed");

    renderNav("admin", "/settings");

    expect(groupHeader(/configuración/i)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the group of a nested active route", () => {
    renderNav("admin", "/reports/sales");

    expect(groupHeader(/análisis/i)).toHaveAttribute("aria-expanded", "true");
  });

  it("lets the user collapse the active group", () => {
    renderNav("admin", "/settings");

    fireEvent.click(groupHeader(/configuración/i));

    expect(groupHeader(/configuración/i)).toHaveAttribute("aria-expanded", "false");
  });

  it("links each header button to the content it controls", () => {
    renderNav("vendedor", "/sales");
    const header = groupHeader(/operación/i);
    const content = document.getElementById(header.getAttribute("aria-controls") ?? "");

    expect(header.tagName).toBe("BUTTON");
    expect(content).not.toBeNull();
    expect(
      within(content as HTMLElement)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/sales", "/cash", "/dashboard", "/products", "/contacts"]);
  });

  it("falls back to the default state when localStorage throws", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    renderNav("admin", "/dashboard");

    expect(groupHeader(/operación/i)).toHaveAttribute("aria-expanded", "true");
    expect(groupHeader(/análisis/i)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(groupHeader(/análisis/i));

    expect(groupHeader(/análisis/i)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Reportes" })).toBeVisible();
  });

  it("shows every icon link with group separators and no headers when collapsed", () => {
    renderNav("admin", "/vault", true);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual(
      ["Operación", "Dinero", "Análisis", "Configuración"],
    );
    expect(screen.getAllByRole("link")).toHaveLength(13);
    expect(screen.getByRole("link", { name: "Baúl" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the tooltip of every collapsed link outside the scrolling rail, even the last one", () => {
    const groups = buildAppNavGroups({ permissions: getRolePermissions("admin"), role: "admin" });

    render(
      <div className="overflow-x-hidden overflow-y-auto" data-testid="rail">
        <AppNavLinks collapsed currentPath="/vault" groups={groups} />
      </div>,
    );
    const rail = screen.getByTestId("rail");

    for (const link of screen.getAllByRole("link")) {
      fireEvent.mouseEnter(link);

      const tooltip = screen.getByRole("tooltip");

      expect(tooltip).toHaveTextContent(link.getAttribute("aria-label") ?? "");
      expect(rail).not.toContainElement(tooltip);
      expect(tooltip).toHaveClass("fixed");
      expect(tooltip).not.toHaveClass("top-full");

      fireEvent.mouseLeave(link);
    }

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("calls onNavigate when a link is followed", () => {
    const onNavigate = jest.fn();
    const groups = buildAppNavGroups({
      permissions: getRolePermissions("vendedor"),
      role: "vendedor",
    });

    render(<AppNavLinks currentPath="/sales" groups={groups} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Mi caja" }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
