/**
 * DET-06d · "Volver" de la compra nueva regresa a la lista de origen (`returnTo`)
 * con sus filtros; sin `returnTo` válido, a `/purchases`. No gana atajos de teclado.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

const mockPush = jest.fn();
let mockSearch = "";

jest.mock("next/navigation", () => ({
  usePathname: () => "/purchases/create",
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { PurchaseCreateHeader } from "./PurchaseCreateHeader";

describe("PurchaseCreateHeader · Volver", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearch = "";
  });

  it("sin returnTo vuelve a /purchases", () => {
    render(<PurchaseCreateHeader />);

    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/purchases");
  });

  it("con returnTo vuelve a la lista con sus filtros y conserva duplicate/restock de la URL aparte", () => {
    const listUrl = "/purchases?status=recibido&pendingBalance=1&page=2";

    mockSearch = `duplicate=p-1&returnTo=${encodeURIComponent(listUrl)}`;
    render(<PurchaseCreateHeader />);

    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", listUrl);
  });

  it.each(["returnTo=%2F%2Fevil.com", "returnTo=https%3A%2F%2Fevil.com", "returnTo=%2Fapi%2Fx"])(
    "un returnTo inseguro cae a /purchases (%s)",
    (search) => {
      mockSearch = search;
      render(<PurchaseCreateHeader />);

      expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/purchases");
    },
  );

  it("no añade atajos de teclado: Esc y Alt+← no navegan", () => {
    mockSearch = `returnTo=${encodeURIComponent("/purchases?page=2")}`;
    render(<PurchaseCreateHeader />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { altKey: true, key: "ArrowLeft" });

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Volver" })).not.toHaveAttribute("aria-keyshortcuts");
  });
});
