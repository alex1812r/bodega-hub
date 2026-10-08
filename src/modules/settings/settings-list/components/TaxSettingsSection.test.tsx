/**
 * PRO-09 · Configuración → Impuestos: catálogo de alícuotas (añadir, activar,
 * desactivar) y alícuota por defecto para categorías nuevas. El IVA por defecto
 * ya no se teclea: se elige del catálogo.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TaxRate } from "@/shared/hooks/useTaxRates";

import {
  apiData,
  apiError,
  buildRate,
  buildSettings,
  createSettingsWrapper,
  installApi,
} from "../settingsApi.testUtils";
import { TaxSettingsSection } from "./TaxSettingsSection";

const IN_USE_MESSAGE =
  'No se puede desactivar la alicuota "Reducida": la usan 2 categorias activas. Reasignalas a otra alicuota antes de desactivarla.';

function seedRates(): TaxRate[] {
  return [
    buildRate({ code: "exento", label: "Exento", pct: 0 }),
    buildRate({ code: "reducida", label: "Reducida", pct: 8 }),
    buildRate({ code: "general", isDefault: true, label: "General", pct: 16 }),
    buildRate({ code: "lujo", isActive: false, isGlobal: false, label: "Lujo", pct: 31 }),
  ];
}

/** Servidor de prueba con estado: el catálogo y la alícuota por defecto cambian con cada escritura. */
function installServer({ rejectDeactivate = false } = {}) {
  const server = { defaultTaxRateId: "tax-general", rates: seedRates() };

  const api = installApi(({ body, method, url }) => {
    const input = (body ?? {}) as Partial<TaxRate> & { defaultTaxRateId?: string };

    if (url.startsWith("/api/tax-rates") && method === "GET") {
      return apiData({
        items: server.rates.map((rate) => ({
          ...rate,
          isDefault: rate.id === server.defaultTaxRateId,
        })),
      });
    }

    if (url === "/api/tax-rates" && method === "POST") {
      const rate = buildRate({
        code: "nueva",
        isGlobal: false,
        label: String(input.label),
        pct: Number(input.pct),
      });

      server.rates.push(rate);

      return apiData(rate, 201);
    }

    if (url.startsWith("/api/tax-rates/") && method === "PATCH") {
      const id = url.split("/").pop();
      const rate = server.rates.find((item) => item.id === id);

      if (!rate) {
        return apiError("Alicuota de IVA no encontrada.", 404);
      }

      if (input.isActive === false && rejectDeactivate) {
        return apiError(IN_USE_MESSAGE, 409);
      }

      Object.assign(rate, input);

      return apiData(rate);
    }

    if (url === "/api/settings" && method === "PATCH") {
      server.defaultTaxRateId = input.defaultTaxRateId ?? server.defaultTaxRateId;
    }

    return url === "/api/settings"
      ? apiData(buildSettings({ defaultTaxRateId: server.defaultTaxRateId }))
      : undefined;
  });

  return { ...api, server };
}

function renderSection(canEdit = true) {
  const user = userEvent.setup({ delay: null });

  render(<TaxSettingsSection canEdit={canEdit} />, { wrapper: createSettingsWrapper() });

  return user;
}

async function findRow(label: string) {
  const list = await screen.findByRole("list", { name: "Alícuotas de IVA" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(label));

  if (!row) {
    throw new Error(`Sin fila para ${label}`);
  }

  return row;
}

function findDefaultChip() {
  return screen.findByRole("button", {
    name: /^Alícuota por defecto para categorías nuevas: /,
  });
}

describe("TaxSettingsSection · Configuración → Impuestos (PRO-09)", () => {
  it("lista cada alícuota con su %, estado, origen y la marca de por defecto", async () => {
    installServer();
    renderSection();

    const general = await findRow("General");

    expect(general).toHaveTextContent("16 %");
    expect(general).toHaveTextContent("Activa");
    expect(general).toHaveTextContent("Global");
    expect(general).toHaveTextContent("Por defecto");

    const luxury = await findRow("Lujo");

    expect(luxury).toHaveTextContent("31 %");
    expect(luxury).toHaveTextContent("Inactiva");
    expect(luxury).toHaveTextContent("De la tienda");
    expect(luxury).not.toHaveTextContent("Por defecto");

    expect(await findRow("Exento")).toHaveTextContent("0 %");
  });

  it("no tiene ningún campo numérico de IVA por defecto: se elige del catálogo", async () => {
    installServer();
    renderSection();

    expect(await findDefaultChip()).toHaveAccessibleName(
      "Alícuota por defecto para categorías nuevas: IVA 16 %",
    );
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/IVA por defecto/)).not.toBeInTheDocument();
  });

  it("elegir otra alícuota por defecto guarda su id en defaultTaxRateId y avisa", async () => {
    const api = installServer();
    const user = renderSection();

    await user.click(await findDefaultChip());
    await user.click(screen.getByRole("radio", { name: /Reducida/ }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { defaultTaxRateId: "tax-reducida" },
      method: "PATCH",
      url: "/api/settings",
    });
    expect(await screen.findByText("Alícuota por defecto: Reducida (8 %)")).toBeInTheDocument();
    await waitFor(async () => expect(await findRow("Reducida")).toHaveTextContent("Por defecto"));
    expect(await findDefaultChip()).toHaveAccessibleName(
      "Alícuota por defecto para categorías nuevas: IVA 8 %",
    );
  });

  it("añadir alícuota: etiqueta y % con coma decimal, en un campo de texto", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("General");
    await user.click(screen.getByRole("button", { name: "Añadir alícuota" }));

    const dialog = within(screen.getByRole("dialog", { name: "Nueva alícuota de IVA" }));
    const pct = dialog.getByLabelText("Porcentaje (%)");

    expect(pct).toHaveAttribute("type", "text");
    expect(pct).toHaveAttribute("inputmode", "decimal");

    await user.type(dialog.getByLabelText("Etiqueta"), "  Licores ");
    await user.type(pct, "12,5");
    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { label: "Licores", pct: 12.5 },
      method: "POST",
      url: "/api/tax-rates",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Nueva alícuota de IVA" })).not.toBeInTheDocument(),
    );

    const created = await findRow("Licores");

    expect(created).toHaveTextContent("12,5 %");
    expect(created).toHaveTextContent("De la tienda");
  });

  it("añadir sin porcentaje no envía y avisa", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("General");
    await user.click(screen.getByRole("button", { name: "Añadir alícuota" }));

    const dialog = within(screen.getByRole("dialog", { name: "Nueva alícuota de IVA" }));

    await user.type(dialog.getByLabelText("Etiqueta"), "Licores");
    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    expect(dialog.getByText("Escribe el porcentaje de la alícuota.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);
  });

  // PRO-F13: con la etiqueta vacía solo salía el globo del navegador y el % no avisaba.
  it("añadir con los dos campos vacíos avisa en cada uno, enfoca la etiqueta y no envía", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("General");
    await user.click(screen.getByRole("button", { name: "Añadir alícuota" }));

    const dialog = within(screen.getByRole("dialog", { name: "Nueva alícuota de IVA" }));
    const label = dialog.getByLabelText("Etiqueta");

    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    expect(dialog.getByText("Escribe la etiqueta de la alícuota.")).toBeInTheDocument();
    expect(dialog.getByText("Escribe el porcentaje de la alícuota.")).toBeInTheDocument();
    expect(label).toBeInvalid();
    expect(label).toHaveFocus();
    expect(api.writes()).toHaveLength(0);

    // Solo espacios tampoco vale; al escribirla el aviso se va.
    await user.type(label, "   ");
    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    expect(dialog.getByText("Escribe la etiqueta de la alícuota.")).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);

    await user.type(label, "Licores");

    expect(dialog.queryByText("Escribe la etiqueta de la alícuota.")).not.toBeInTheDocument();
  });

  // PRO-F13: se podían crear dos alícuotas con el mismo % sin ningún aviso.
  it("un % que ya tiene una alícuota activa avisa cuál es, sin impedir añadirla", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("General");
    await user.click(screen.getByRole("button", { name: "Añadir alícuota" }));

    const dialog = within(screen.getByRole("dialog", { name: "Nueva alícuota de IVA" }));
    const pct = dialog.getByLabelText("Porcentaje (%)");

    await user.type(dialog.getByLabelText("Etiqueta"), "Otra general");
    // 31 % solo lo tiene una alícuota inactiva: no avisa.
    await user.type(pct, "31");

    expect(dialog.queryByText(/Ya hay una alícuota activa/)).not.toBeInTheDocument();

    await user.clear(pct);
    await user.type(pct, "16");

    expect(
      dialog.getByText(
        "Ya hay una alícuota activa con ese porcentaje: General (16 %). Puedes añadirla igual.",
      ),
    ).toBeInTheDocument();
    expect(pct).toBeValid();

    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({ body: { label: "Otra general", pct: 16 } });
  });

  // PRO-F6: 150 no se recorta a 100 en silencio: se avisa y no se envía.
  it("añadir con un porcentaje mayor que 100 no envía y avisa, sin cambiar lo escrito", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("General");
    await user.click(screen.getByRole("button", { name: "Añadir alícuota" }));

    const dialog = within(screen.getByRole("dialog", { name: "Nueva alícuota de IVA" }));
    const pct = dialog.getByLabelText("Porcentaje (%)");

    await user.type(dialog.getByLabelText("Etiqueta"), "Licores");
    await user.type(pct, "150");
    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    expect(dialog.getByText("El porcentaje debe estar entre 0 y 100.")).toBeInTheDocument();
    expect(pct).toHaveValue("150");
    expect(pct).toBeInvalid();
    expect(api.writes()).toHaveLength(0);

    await user.clear(pct);
    await user.type(pct, "100");
    await user.click(dialog.getByRole("button", { name: "Añadir alícuota" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({ body: { label: "Licores", pct: 100 } });
  });

  it("desactivar pide confirmación nombrando el efecto y solo entonces escribe", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("Reducida");
    await user.click(screen.getByRole("button", { name: "Desactivar Reducida (8 %)" }));

    const dialog = within(screen.getByRole("dialog", { name: "¿Desactivar esta alícuota?" }));

    expect(
      dialog.getByText(
        "Vas a desactivar Reducida (8 %). Las categorías que la usan la conservan; no se podrá elegir en nuevas.",
      ),
    ).toBeInTheDocument();
    expect(api.writes()).toHaveLength(0);

    await user.click(dialog.getByRole("button", { name: "Desactivar alícuota" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { isActive: false },
      method: "PATCH",
      url: "/api/tax-rates/tax-reducida",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "¿Desactivar esta alícuota?" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(async () => expect(await findRow("Reducida")).toHaveTextContent("Inactiva"));
  });

  it("cancelar la confirmación no escribe nada", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("Reducida");
    await user.click(screen.getByRole("button", { name: "Desactivar Reducida (8 %)" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "¿Desactivar esta alícuota?" }),
      ).not.toBeInTheDocument(),
    );
    expect(api.writes()).toHaveLength(0);
  });

  it("si el servidor no deja desactivarla (en uso), muestra su motivo y no cierra", async () => {
    const api = installServer({ rejectDeactivate: true });
    const user = renderSection();

    await findRow("Reducida");
    await user.click(screen.getByRole("button", { name: "Desactivar Reducida (8 %)" }));

    const dialog = within(screen.getByRole("dialog", { name: "¿Desactivar esta alícuota?" }));

    await user.click(dialog.getByRole("button", { name: "Desactivar alícuota" }));

    expect(await dialog.findByText(IN_USE_MESSAGE)).toBeInTheDocument();
    expect(api.writes()).toHaveLength(1);

    await user.click(dialog.getByRole("button", { name: "Cancelar" }));

    expect(await findRow("Reducida")).toHaveTextContent("Activa");
    // El rechazo ya se leyó en el diálogo: no queda colgado sobre la lista.
    expect(screen.queryByText(IN_USE_MESSAGE)).not.toBeInTheDocument();
  });

  it("activar una alícuota inactiva escribe sin pedir confirmación", async () => {
    const api = installServer();
    const user = renderSection();

    await findRow("Lujo");
    await user.click(screen.getByRole("button", { name: "Activar Lujo (31 %)" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { isActive: true },
      method: "PATCH",
      url: "/api/tax-rates/tax-lujo",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(async () => expect(await findRow("Lujo")).toHaveTextContent("Activa"));
  });

  it("sin permiso de edición solo se lee: sin añadir, sin activar ni desactivar, chip bloqueado", async () => {
    installServer();
    renderSection(false);

    await findRow("General");

    expect(screen.queryByRole("button", { name: "Añadir alícuota" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Desactivar|Activar) / })).not.toBeInTheDocument();
    expect(await findDefaultChip()).toBeDisabled();
    expect(
      screen.getByText("Solo un administrador puede añadir, activar o desactivar alícuotas."),
    ).toBeInTheDocument();
  });

  it("si el catálogo no carga, muestra el motivo del servidor y deja reintentar", async () => {
    installApi(({ url }) =>
      url.startsWith("/api/tax-rates")
        ? apiError("No tienes permiso para ver las alícuotas.", 403)
        : apiData(buildSettings()),
    );
    renderSection();

    expect(await screen.findByText("No pudimos cargar las alícuotas")).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver las alícuotas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
