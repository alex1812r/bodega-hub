/**
 * COM-F4 · el aviso de «Pedido» es fijo: al desplazar el detalle se queda arriba
 * del área de contenido, con su acción «Recibir mercancía» a la vista.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PurchasePendingReceiptBanner } from "./PurchasePendingReceiptBanner";

describe("PurchasePendingReceiptBanner", () => {
  it("queda pegado arriba del contenido, opaco, sobre las tablas y bajo cabecera y modales", () => {
    render(<PurchasePendingReceiptBanner canReceive onReceive={jest.fn()} />);

    const banner = screen.getByRole("region", { name: "Pedido sin recibir" });

    // `main` es quien se desplaza y la cabecera del shell queda fuera de él: top-0.
    expect(banner).toHaveClass("sticky", "top-0");
    // Sobre lo pegado dentro de las tablas (z-10); bajo la cabecera (z-40) y los modales (z-50).
    expect(banner).toHaveClass("z-20");
    expect(banner).toHaveClass("bg-surface-container-lowest", "dark:bg-slate-900");
    expect(banner.className).not.toMatch(/bg-[\w-]+\/\d/);
  });

  it("es compacto: el aviso y el botón, sin el relleno amplio de la tarjeta", () => {
    render(<PurchasePendingReceiptBanner canReceive onReceive={jest.fn()} />);

    const banner = screen.getByRole("region", { name: "Pedido sin recibir" });

    expect(banner).toHaveClass("p-3", "sm:p-4");
    expect(banner).not.toHaveClass("p-4", "sm:p-6");
    expect(screen.getByRole("status")).toHaveTextContent("El inventario no ha cambiado.");
  });

  it("el botón sigue recibiendo y sin permiso no se pinta", async () => {
    const onReceive = jest.fn();
    const { rerender } = render(<PurchasePendingReceiptBanner canReceive onReceive={onReceive} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Recibir mercancía" }));
    expect(onReceive).toHaveBeenCalledTimes(1);

    rerender(<PurchasePendingReceiptBanner canReceive={false} onReceive={onReceive} />);
    expect(screen.queryByRole("button", { name: "Recibir mercancía" })).not.toBeInTheDocument();
  });
});
