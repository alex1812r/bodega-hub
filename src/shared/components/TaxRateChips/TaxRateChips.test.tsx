import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";

import type { TaxRate } from "@/shared/hooks/useTaxRates";

import { Modal } from "../Modal";
import { TaxRateChips, type TaxRateChipsProps } from "./TaxRateChips";

function buildRate(overrides: Partial<TaxRate> & Pick<TaxRate, "code" | "pct">): TaxRate {
  return {
    id: `id-${overrides.code}`,
    isActive: true,
    isDefault: false,
    isGlobal: true,
    label: overrides.code,
    sortOrder: 0,
    ...overrides,
  };
}

const exempt = buildRate({ code: "exento", label: "Exento", pct: 0 });
const reduced = buildRate({ code: "reducida", label: "Reducida", pct: 8 });
const general = buildRate({ code: "general", isDefault: true, label: "General", pct: 16 });
const luxury = buildRate({ code: "lujo", isActive: false, label: "Lujo", pct: 31 });
const catalog = [exempt, reduced, general, luxury];

function renderChips(props: Partial<TaxRateChipsProps> = {}) {
  const onChange = jest.fn();
  const utils = render(
    <TaxRateChips onChange={onChange} rates={catalog} value="general" {...props} />,
  );

  return { onChange, ...utils };
}

function Controlled(props: Partial<TaxRateChipsProps> & { initialValue: string | null }) {
  const { initialValue, ...rest } = props;
  const [value, setValue] = useState(initialValue);

  return <TaxRateChips rates={catalog} {...rest} onChange={setValue} value={value} />;
}

function getTrigger() {
  return screen.getByRole("button", { name: /Alícuota de IVA/ });
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function QueryWrapper({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("TaxRateChips", () => {
  it("muestra la alícuota del value", () => {
    const { rerender, onChange } = renderChips();

    expect(getTrigger()).toHaveTextContent("IVA 16 %");
    expect(getTrigger()).toHaveAccessibleName("Alícuota de IVA: IVA 16 %");

    rerender(<TaxRateChips onChange={onChange} rates={catalog} value="exento" />);
    expect(getTrigger()).toHaveTextContent("Exento");

    rerender(
      <TaxRateChips
        onChange={onChange}
        rates={[buildRate({ code: "medio", pct: 12.5 })]}
        value="medio"
      />,
    );
    expect(getTrigger()).toHaveTextContent("IVA 12,5 %");

    rerender(<TaxRateChips onChange={onChange} rates={catalog} value={null} />);
    expect(getTrigger()).toHaveTextContent("Elegir IVA");
  });

  it("abre y cierra con clic y anuncia el estado en el disparador", async () => {
    const user = userEvent.setup();
    renderChips();

    const trigger = getTrigger();

    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radiogroup", { name: "Alícuota de IVA" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("dialog").id);

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("lista solo las activas, con etiqueta y %, y marca la seleccionada", async () => {
    const user = userEvent.setup();
    renderChips();

    await user.click(getTrigger());

    const radios = screen.getAllByRole("radio");

    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Exento 0 %",
      "Reducida 8 %",
      "General 16 %por defecto",
    ]);
    expect(screen.queryByRole("radio", { name: /Lujo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /General/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Exento/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Reducida/ })).not.toBeChecked();
  });

  it('marca "por defecto" la alícuota de la categoría en vez de la de la tienda', async () => {
    const user = userEvent.setup();
    renderChips({ categoryDefaultCode: "reducida" });

    await user.click(getTrigger());

    expect(screen.getByRole("radio", { name: /Reducida/ })).toHaveTextContent("por defecto");
    expect(screen.getByRole("radio", { name: /General/ })).not.toHaveTextContent("por defecto");
    expect(screen.getAllByText("por defecto")).toHaveLength(1);
  });

  it("seleccionar llama onChange(code, rate) una vez, cierra y devuelve el foco", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips();

    await user.click(getTrigger());
    await user.click(screen.getByRole("radio", { name: /Reducida/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("reducida", reduced);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(getTrigger()).toHaveFocus();
  });

  it("elegir la que ya estaba seleccionada cierra sin llamar onChange", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips();

    await user.click(getTrigger());
    await user.click(screen.getByRole("radio", { name: /General/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("se maneja con teclado: Enter abre, flechas mueven, Espacio y Enter eligen", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips();

    await user.tab();
    expect(getTrigger()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("radio", { name: /General/ })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /Exento/ })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Reducida/ })).toHaveFocus();

    await user.keyboard("{ArrowUp}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: /General/ })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: /Exento/ })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("exento", exempt);
    expect(getTrigger()).toHaveFocus();

    await user.keyboard("{ArrowDown}{End}{ArrowLeft}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("reducida", reduced);
  });

  it("solo el radio activo entra en el orden de tabulación", async () => {
    const user = userEvent.setup();
    renderChips();

    await user.click(getTrigger());

    expect(screen.getAllByRole("radio").map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);

    await user.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("radio").map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it("Esc cierra y devuelve el foco al chip sin cambiar el valor", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips();

    await user.click(getTrigger());
    await user.keyboard("{ArrowDown}{Escape}");

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(getTrigger()).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Tab cierra el popover, deja el foco en el chip y el siguiente Tab continúa", async () => {
    const user = userEvent.setup();
    render(
      <>
        <TaxRateChips onChange={jest.fn()} rates={catalog} value="general" />
        <button type="button">Siguiente</button>
      </>,
    );

    await user.click(getTrigger());
    await user.tab();

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(getTrigger()).toHaveFocus();

    await user.tab();

    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveFocus();
  });

  it("un clic fuera cierra el popover", async () => {
    const user = userEvent.setup();
    render(
      <>
        <TaxRateChips onChange={jest.fn()} rates={catalog} value="general" />
        <p>Fuera</p>
      </>,
    );

    await user.click(getTrigger());
    await user.click(screen.getByText("Fuera"));

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("no contiene ningún input: es imposible teclear un porcentaje", async () => {
    const user = userEvent.setup();
    renderChips();

    await user.click(getTrigger());

    expect(document.querySelectorAll("input, textarea, select, [contenteditable]")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("muestra un value inactivo con su % y la marca de inactiva", async () => {
    const user = userEvent.setup();
    renderChips({ value: "lujo" });

    expect(getTrigger()).toHaveTextContent("IVA 31 %· inactiva");
    expect(getTrigger()).toHaveAccessibleName("Alícuota de IVA: IVA 31 % (inactiva)");

    await user.click(getTrigger());

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    screen.getAllByRole("radio").forEach((radio) => expect(radio).not.toBeChecked());
  });

  it("resuelve el % de un código otro-<pct> o del snapshot de la línea", () => {
    const { rerender, onChange } = renderChips({ value: "otro-12.5" });

    expect(getTrigger()).toHaveTextContent("IVA 12,5 %· inactiva");

    rerender(
      <TaxRateChips onChange={onChange} rates={catalog} value="eliminada" valuePct={9} />,
    );
    expect(getTrigger()).toHaveTextContent("IVA 9 %· inactiva");

    rerender(<TaxRateChips onChange={onChange} rates={catalog} value="eliminada" />);
    expect(getTrigger()).toHaveTextContent("eliminada· inactiva");
  });

  it("una alícuota inactiva no se puede volver a elegir una vez cambiada", async () => {
    const user = userEvent.setup();
    render(<Controlled initialValue="lujo" />);

    await user.click(getTrigger());
    await user.click(screen.getByRole("radio", { name: /Reducida/ }));

    expect(getTrigger()).toHaveTextContent("IVA 8 %");
    expect(getTrigger()).not.toHaveTextContent("inactiva");

    await user.click(getTrigger());

    expect(screen.queryByRole("radio", { name: /Lujo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Reducida/ })).toBeChecked();
  });

  it("deshabilitado no abre el popover", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips({ disabled: true });

    expect(getTrigger()).toBeDisabled();

    await user.click(getTrigger());

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("se cierra si pasa a deshabilitado estando abierto", async () => {
    const user = userEvent.setup();
    const { rerender, onChange } = renderChips();

    await user.click(getTrigger());
    rerender(<TaxRateChips disabled onChange={onChange} rates={catalog} value="general" />);

    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("usa el label como nombre accesible", async () => {
    const user = userEvent.setup();
    renderChips({ label: "IVA de Harina PAN" });

    const trigger = screen.getByRole("button", { name: "IVA de Harina PAN: IVA 16 %" });

    await user.click(trigger);

    expect(screen.getByRole("radiogroup", { name: "IVA de Harina PAN" })).toBeInTheDocument();
  });

  it("cargando muestra un esqueleto en lugar del chip", () => {
    renderChips({ isLoading: true, rates: [] });

    expect(screen.getByRole("status", { name: "Cargando Alícuota de IVA" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("con error muestra el mensaje tal cual y reintenta", async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    renderChips({ error: new Error("No tienes permiso."), onRetry, rates: [] });

    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso.");
    expect(screen.queryByRole("button", { name: /Alícuota de IVA/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("con el catálogo vacío lo avisa y no ofrece opciones", async () => {
    const user = userEvent.setup();
    renderChips({ rates: [luxury], value: null });

    await user.click(getTrigger());

    expect(screen.getByText("No hay alícuotas activas.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("No hay alícuotas activas.")).not.toBeInTheDocument();
  });

  it("fuera de un diálogo monta el popover en body para que no lo recorte una tabla", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div style={{ overflow: "hidden" }}>
        <TaxRateChips onChange={jest.fn()} rates={catalog} value="general" />
      </div>,
    );

    await user.click(getTrigger());

    const popover = screen.getByRole("dialog");

    expect(container).not.toContainElement(popover);
    expect(popover.parentElement).toBe(document.body);
    expect(popover).toHaveClass("fixed");
  });

  describe("dentro de un Modal", () => {
    function renderInModal() {
      const onChange = jest.fn();
      const onOpenChange = jest.fn();

      render(
        <Modal
          description="Datos de la categoría."
          onOpenChange={onOpenChange}
          open
          title="Nueva categoría"
        >
          <TaxRateChips onChange={onChange} rates={catalog} value="general" />
        </Modal>,
      );

      return { onChange, onOpenChange };
    }

    it("monta el popover dentro del diálogo y deja elegir sin cerrarlo", async () => {
      const user = userEvent.setup();
      const { onChange, onOpenChange } = renderInModal();
      const modal = screen.getByRole("dialog", { name: "Nueva categoría" });

      await user.click(getTrigger());

      const reducedRadio = screen.getByRole("radio", { name: /Reducida/ });

      expect(modal).toContainElement(reducedRadio);
      expect(screen.getByRole("radio", { name: /General/ })).toHaveFocus();

      await user.click(reducedRadio);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onChange).toHaveBeenCalledWith("reducida", reduced);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(within(modal).getByRole("button", { name: /Alícuota de IVA/ })).toHaveFocus();
    });

    it("Esc cierra solo el popover", async () => {
      const user = userEvent.setup();
      const { onOpenChange } = renderInModal();

      await user.click(getTrigger());
      await user.keyboard("{Escape}");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Nueva categoría" })).toBeInTheDocument();
    });
  });

  describe("sin rates inyectadas (useTaxRates)", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      global.fetch = fetchMock;
    });

    it("carga el catálogo completo una sola vez para todos los chips", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: { items: catalog } }));
      const user = userEvent.setup();

      render(
        <QueryWrapper>
          <TaxRateChips label="IVA línea 1" onChange={jest.fn()} value="general" />
          <TaxRateChips label="IVA línea 2" onChange={jest.fn()} value="lujo" />
        </QueryWrapper>,
      );

      expect(screen.getAllByRole("status")).toHaveLength(2);

      const first = await screen.findByRole("button", { name: "IVA línea 1: IVA 16 %" });

      expect(
        screen.getByRole("button", { name: "IVA línea 2: IVA 31 % (inactiva)" }),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe("/api/tax-rates");

      await user.click(first);

      expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    it("muestra el error de la API y reintenta la carga", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "FORBIDDEN", message: "No tienes permiso." } }, 403),
        )
        .mockResolvedValueOnce(jsonResponse({ data: { items: catalog } }));
      const user = userEvent.setup();

      render(
        <QueryWrapper>
          <TaxRateChips onChange={jest.fn()} value="general" />
        </QueryWrapper>,
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso.");

      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      await waitFor(() => expect(getTrigger()).toHaveTextContent("IVA 16 %"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
