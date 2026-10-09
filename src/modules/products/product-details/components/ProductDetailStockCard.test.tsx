import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { ProductDetailStockCard } from "./ProductDetailStockCard";

/** PRO-03 · "Ajustar stock" en la tarjeta de stock del detalle. */

const mockGrantedPermissions = new Set<string>();

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children, permission }: { children: React.ReactNode; permission: string }) =>
    mockGrantedPermissions.has(permission) ? children : null,
}));

const product = { id: "prod-1", name: "Caja Cola x6", sku: "caja-cola" };
const MOVEMENTS_HREF = "/inventory/movements?productId=prod-1&returnTo=%2Fproducts%2Fprod-1";

function renderCard(props: Partial<Parameters<typeof ProductDetailStockCard>[0]> = {}) {
  return render(
    <ProductDetailStockCard
      adjustableProduct={product}
      currentStock={7}
      minStock={2}
      movementsHref={MOVEMENTS_HREF}
      {...props}
    />,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  mockGrantedPermissions.clear();
  mockGrantedPermissions.add("inventory.manage");
});

describe("ProductDetailStockCard · Ajustar stock (PRO-03)", () => {
  it("con inventory.manage abre el ajuste con el producto bloqueado y registra el movimiento", async () => {
    const user = userEvent.setup({ delay: null });
    const gets: string[] = [];
    const api = installFetchStub((url) => {
      gets.push(url);

      return { items: [], limit: 100, skip: 0, total: 0 };
    });

    renderCard();
    await user.click(screen.getByRole("button", { name: "Ajustar stock" }));

    const dialog = within(screen.getByRole("dialog", { name: "Ajuste de stock" }));

    expect(dialog.getByLabelText("Producto")).toHaveValue("Caja Cola x6 (caja-cola)");
    expect(dialog.getByLabelText("Producto")).toBeDisabled();
    expect(dialog.getByText("Stock actual:")).toHaveTextContent("Stock actual: 7");
    expect(gets.some((url) => url.startsWith("/api/inventory"))).toBe(false);

    api.respondToNextPost({ data: { id: "mov-1" } });
    await user.click(dialog.getByLabelText("Cantidad"));
    await user.paste("4");
    await user.click(dialog.getByLabelText("Motivo"));
    await user.paste("Conteo físico");
    await user.click(dialog.getByRole("button", { name: "Continuar" }));

    // CNF-08: el ajuste se confirma con su efecto antes de registrarse.
    const confirmation = within(
      await screen.findByRole("dialog", { name: "Confirmar ajuste de stock" }),
    );

    expect(confirmation.getByRole("listitem")).toHaveTextContent(
      /\+4 Caja Cola x6\s*Stock 7\s*pasa a\s*11/,
    );
    expect(api.posts).toHaveLength(0);
    await user.click(confirmation.getByRole("button", { name: "Registrar movimiento" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Ajuste de stock" })).not.toBeInTheDocument(),
    );
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.body).toMatchObject({
      productId: "prod-1",
      quantityDelta: 4,
      reason: "Conteo físico",
    });
  });

  it("sin inventory.manage no muestra el botón", () => {
    mockGrantedPermissions.clear();
    renderCard();

    expect(screen.queryByRole("button", { name: "Ajustar stock" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver movimientos de inventario" })).toHaveAttribute(
      "href",
      MOVEMENTS_HREF,
    );
  });

  // DET-F1: sin `inventory.view` la página no pasa destino y no hay enlace que acabe en 403.
  it("sin destino de movimientos no pinta el enlace", () => {
    renderCard({ movementsHref: undefined });

    expect(
      screen.queryByRole("link", { name: "Ver movimientos de inventario" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustar stock" })).toBeInTheDocument();
  });

  it("sin producto la tarjeta queda como antes, sin botón", () => {
    renderCard({ adjustableProduct: undefined });

    expect(screen.queryByRole("button", { name: "Ajustar stock" })).not.toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
