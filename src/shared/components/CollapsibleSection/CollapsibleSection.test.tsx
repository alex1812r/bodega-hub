import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { CollapsibleSection } from "./CollapsibleSection";

const STORAGE_KEY = "test:collapsible-section";

function renderSection(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return render(
    <>
      <CollapsibleSection summary="3 contactos" title="Proveedor" {...props}>
        <a href="#detalle">Ver detalle</a>
      </CollapsibleSection>
      <button type="button">Siguiente</button>
    </>,
  );
}

function getTrigger() {
  return screen.getByRole("button", { name: /proveedor/i });
}

describe("CollapsibleSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("abrir y cerrar", () => {
    it("cerrado muestra el summary y oculta el contenido", () => {
      renderSection();

      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("3 contactos")).toBeVisible();
      expect(screen.getByText("Ver detalle")).not.toBeVisible();
    });

    it("abierto muestra el contenido y no el summary", () => {
      renderSection({ defaultOpen: true });

      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
      expect(screen.queryByText("3 contactos")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Ver detalle" })).toBeVisible();
    });

    it("el disparador es un button que controla la región de contenido", () => {
      renderSection({ defaultOpen: true });

      const trigger = getTrigger();
      const region = document.getElementById(trigger.getAttribute("aria-controls") ?? "");

      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger).toHaveAttribute("type", "button");
      expect(region).toContainElement(screen.getByText("Ver detalle"));
    });

    it("alterna con clic", async () => {
      const user = userEvent.setup();
      renderSection();

      await user.click(getTrigger());
      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Ver detalle")).toBeVisible();

      await user.click(getTrigger());
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("3 contactos")).toBeVisible();
    });

    it("se opera con Enter y Espacio", async () => {
      const user = userEvent.setup();
      renderSection();

      await user.tab();
      expect(getTrigger()).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");

      await user.keyboard(" ");
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("el contenido cerrado no se alcanza con Tab; abierto sí", async () => {
      const user = userEvent.setup();
      renderSection();

      await user.tab();
      await user.tab();
      expect(screen.getByRole("button", { name: "Siguiente" })).toHaveFocus();

      await user.click(getTrigger());
      await user.tab();
      expect(screen.getByRole("link", { name: "Ver detalle" })).toHaveFocus();
    });

    it("aplica className al contenedor", () => {
      const { container } = renderSection({ className: "mt-4" });

      expect(container.querySelector("section")).toHaveClass("mt-4");
    });
  });

  describe("modo controlado", () => {
    it("respeta open y avisa por onOpenChange sin cambiar por su cuenta", async () => {
      const user = userEvent.setup();
      const onOpenChange = jest.fn();
      renderSection({ onOpenChange, open: false });

      await user.click(getTrigger());

      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("sigue al estado del padre", async () => {
      const user = userEvent.setup();

      function Controlled() {
        const [open, setOpen] = useState(true);

        return (
          <CollapsibleSection onOpenChange={setOpen} open={open} title="Proveedor">
            <p>Contenido</p>
          </CollapsibleSection>
        );
      }

      render(<Controlled />);

      await user.click(getTrigger());
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");

      await user.click(getTrigger());
      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("storageKey", () => {
    it("persiste el cambio y lo restaura al volver a montar", async () => {
      const user = userEvent.setup();
      const first = renderSection({ storageKey: STORAGE_KEY });

      await user.click(getTrigger());
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("open");

      first.unmount();
      renderSection({ storageKey: STORAGE_KEY });

      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
    });

    it("restaura cerrado aunque defaultOpen sea true", () => {
      window.localStorage.setItem(STORAGE_KEY, "closed");

      renderSection({ defaultOpen: true, storageKey: STORAGE_KEY });

      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("sin storageKey no escribe en localStorage", async () => {
      const user = userEvent.setup();
      renderSection();

      await user.click(getTrigger());

      expect(window.localStorage).toHaveLength(0);
    });

    it.each(["true", "1", "", "{}", "OPEN"])(
      "valor corrupto %p usa defaultOpen",
      (corrupt) => {
        window.localStorage.setItem(STORAGE_KEY, corrupt);

        renderSection({ defaultOpen: true, storageKey: STORAGE_KEY });

        expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
      },
    );

    it("si localStorage lanza al leer usa defaultOpen y no revienta", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      renderSection({ defaultOpen: true, storageKey: STORAGE_KEY });
      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");
    });

    it("si localStorage lanza al leer y defaultOpen es false queda cerrado", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      renderSection({ storageKey: STORAGE_KEY });
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("si localStorage lanza al escribir sigue alternando en memoria", async () => {
      const user = userEvent.setup();
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      renderSection({ storageKey: STORAGE_KEY });

      await user.click(getTrigger());
      expect(getTrigger()).toHaveAttribute("aria-expanded", "true");

      await user.click(getTrigger());
      expect(getTrigger()).toHaveAttribute("aria-expanded", "false");
    });
  });

  describe("hidratación", () => {
    it("el HTML de servidor usa defaultOpen y el valor guardado se aplica tras hidratar, sin warnings", async () => {
      window.localStorage.setItem(STORAGE_KEY, "open");
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
      const element = (
        <CollapsibleSection storageKey={STORAGE_KEY} summary="3 contactos" title="Proveedor">
          <p>Contenido</p>
        </CollapsibleSection>
      );
      const container = document.createElement("div");
      document.body.appendChild(container);

      container.innerHTML = renderToString(element);
      expect(container.querySelector("button")).toHaveAttribute("aria-expanded", "false");
      expect(container).toHaveTextContent("3 contactos");

      const root = await act(async () => hydrateRoot(container, element));

      expect(container.querySelector("button")).toHaveAttribute("aria-expanded", "true");
      expect(container).not.toHaveTextContent("3 contactos");
      expect(consoleError).not.toHaveBeenCalled();

      await act(async () => root.unmount());
      container.remove();
    });
  });
});
