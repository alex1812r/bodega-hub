/**
 * PRO-09 · Configuración → Precios: umbrales del semáforo de ganancia y % de
 * ganancia recomendados. Guardado explícito de `pricing` completo.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MARGIN_BADGE_TITLE } from "@/shared/components/MarginBadge";
import type { PricingSettingsMock } from "@/shared/mocks/erp-data";

import {
  PRICING_CHIP_RANGE_MESSAGE,
  PRICING_CHIPS_DUPLICATED_MESSAGE,
  PRICING_THRESHOLD_RANGE_MESSAGE,
  PRICING_THRESHOLDS_ORDER_MESSAGE,
} from "../../services/pricingSettings.schemas";
import {
  apiData,
  apiError,
  buildSettings,
  createSettingsWrapper,
  installApi,
} from "../settingsApi.testUtils";
import {
  PRICING_CHIPS_LIMIT_MESSAGE,
  PRICING_CHIPS_MIN_MESSAGE,
  PricingSettingsSection,
} from "./PricingSettingsSection";

type UserSession = ReturnType<typeof userEvent.setup>;

/** Servidor de prueba: `PATCH /api/settings` guarda `pricing` salvo que se le pida fallar. */
function installServer(pricing?: PricingSettingsMock) {
  const server = {
    patchError: null as string | null,
    settings: buildSettings(pricing ? { pricing } : {}),
  };

  const api = installApi(({ body, method, url }) => {
    if (url !== "/api/settings") {
      return undefined;
    }

    if (method === "PATCH") {
      if (server.patchError) {
        return apiError(server.patchError);
      }

      server.settings = { ...server.settings, ...(body as Partial<typeof server.settings>) };
    }

    return apiData(server.settings);
  });

  return { ...api, server };
}

function renderSection(canEdit = true) {
  const user = userEvent.setup({ delay: null });

  render(<PricingSettingsSection canEdit={canEdit} />, { wrapper: createSettingsWrapper() });

  return user;
}

function redField() {
  return screen.findByLabelText("Rojo por debajo de (%)");
}

function greenField() {
  return screen.getByLabelText("Verde desde (%)");
}

function saveButton() {
  return screen.getByRole("button", { name: "Guardar precios" });
}

function chipTexts() {
  return within(screen.getByRole("list", { name: "Porcentajes recomendados" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

function previewBands() {
  return within(screen.getByRole("group", { name: "Vista previa del semáforo" }))
    .getAllByTitle(MARGIN_BADGE_TITLE)
    // El badge antepone su banda para lectores de pantalla ("Ganancia baja:4 %").
    .map((badge) => [badge.textContent?.split(":").pop(), badge.getAttribute("data-band")]);
}

async function setField(user: UserSession, field: HTMLElement, text: string) {
  await user.clear(field);

  if (text) {
    await user.type(field, text);
  }
}

async function addChip(user: UserSession, text: string) {
  await setField(user, screen.getByLabelText("Nuevo porcentaje (%)"), text);
  await user.click(screen.getByRole("button", { name: "Añadir" }));
}

describe("PricingSettingsSection · Configuración → Precios (PRO-09)", () => {
  it("carga los umbrales y los chips de la tienda, con vista previa y la ayuda", async () => {
    installServer({ chipsPct: [10, 18], greenFromPct: 18, yellowFromPct: 8 });
    renderSection();

    expect(await redField()).toHaveValue("8");
    expect(greenField()).toHaveValue("18");
    expect(chipTexts()).toEqual(["10 %", "18 %"]);
    expect(previewBands()).toEqual([
      ["4 %", "low"],
      ["13 %", "mid"],
      ["18 %", "high"],
    ]);
    expect(
      screen.getByText(/La ganancia se calcula sobre el costo, que ya incluye el IVA/),
    ).toHaveTextContent("El semáforo es solo una alerta");
    // Nada que guardar hasta que se cambia algo.
    expect(saveButton()).toBeDisabled();
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("umbrales invertidos o iguales: avisa en pantalla y no envía", async () => {
    const api = installServer();
    const user = renderSection();

    await setField(user, await redField(), "30");

    expect(screen.getByText(PRICING_THRESHOLDS_ORDER_MESSAGE)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(
      screen.queryByRole("group", { name: "Vista previa del semáforo" }),
    ).not.toBeInTheDocument();

    await setField(user, await redField(), "25");

    expect(screen.getByText(PRICING_THRESHOLDS_ORDER_MESSAGE)).toBeInTheDocument();

    // Ni con Enter (envío implícito del formulario).
    fireEvent.submit(saveButton().closest("form") as HTMLFormElement);

    expect(api.writes()).toHaveLength(0);

    await setField(user, await redField(), "24");

    expect(screen.queryByText(PRICING_THRESHOLDS_ORDER_MESSAGE)).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("umbral fuera de rango o vacío: avisa y no deja guardar", async () => {
    installServer();
    const user = renderSection();

    await redField();
    await setField(user, greenField(), "2000");

    expect(screen.getByText(PRICING_THRESHOLD_RANGE_MESSAGE)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await setField(user, greenField(), "");

    expect(screen.getByText("Escribe los dos porcentajes del semáforo.")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("chips: añadir ordena, un duplicado o un 0 se rechazan y se puede quitar", async () => {
    installServer();
    const user = renderSection();

    await redField();
    expect(chipTexts()).toEqual(["12 %", "20 %", "30 %"]);

    await addChip(user, "18,5");

    expect(chipTexts()).toEqual(["12 %", "18,5 %", "20 %", "30 %"]);
    expect(screen.getByLabelText("Nuevo porcentaje (%)")).toHaveValue("");

    await addChip(user, "20");

    expect(screen.getByText(PRICING_CHIPS_DUPLICATED_MESSAGE)).toBeInTheDocument();
    expect(chipTexts()).toHaveLength(4);

    await addChip(user, "0");

    expect(screen.getByText(PRICING_CHIP_RANGE_MESSAGE)).toBeInTheDocument();
    expect(chipTexts()).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Quitar 12 %" }));

    expect(chipTexts()).toEqual(["18,5 %", "20 %", "30 %"]);
    expect(screen.queryByText(PRICING_CHIP_RANGE_MESSAGE)).not.toBeInTheDocument();
  });

  it("chips: Enter en el campo añade el chip y no guarda el formulario", async () => {
    const api = installServer();
    const user = renderSection();

    await redField();
    await user.type(screen.getByLabelText("Nuevo porcentaje (%)"), "45{Enter}");

    expect(chipTexts()).toEqual(["12 %", "20 %", "30 %", "45 %"]);
    expect(api.writes()).toHaveLength(0);
  });

  it("chips: como máximo 6 y como mínimo 1", async () => {
    installServer({ chipsPct: [5, 10, 15, 20, 25], greenFromPct: 25, yellowFromPct: 15 });
    const user = renderSection();

    await redField();
    await addChip(user, "30");

    expect(chipTexts()).toHaveLength(6);
    expect(screen.getByText(PRICING_CHIPS_LIMIT_MESSAGE)).toBeInTheDocument();

    await addChip(user, "35");

    expect(chipTexts()).toHaveLength(6);
    expect(screen.getByText(PRICING_CHIPS_LIMIT_MESSAGE)).toBeInTheDocument();

    for (const pct of [5, 10, 15, 20, 25]) {
      await user.click(screen.getByRole("button", { name: `Quitar ${pct} %` }));
    }

    expect(chipTexts()).toEqual(["30 %"]);

    await user.click(screen.getByRole("button", { name: "Quitar 30 %" }));

    expect(chipTexts()).toEqual(["30 %"]);
    expect(screen.getByText(PRICING_CHIPS_MIN_MESSAGE)).toBeInTheDocument();
  });

  it("guardar envía pricing completo, avisa con un toast y deja el formulario al día", async () => {
    const api = installServer();
    const user = renderSection();

    await setField(user, await redField(), "10");
    await setField(user, greenField(), "18");
    await addChip(user, "45");

    // Un 20 % ya es verde con el verde en 18 %.
    expect(previewBands()).toEqual([
      ["5 %", "low"],
      ["14 %", "mid"],
      ["18 %", "high"],
    ]);
    expect(screen.getByText("Hay cambios sin guardar.")).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      body: { pricing: { chipsPct: [12, 20, 30, 45], greenFromPct: 18, yellowFromPct: 10 } },
      method: "PATCH",
      url: "/api/settings",
    });
    expect(await screen.findByText("Ajustes de precios guardados")).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(screen.queryByText("Hay cambios sin guardar.")).not.toBeInTheDocument();
    expect(await redField()).toHaveValue("10");
    expect(chipTexts()).toEqual(["12 %", "20 %", "30 %", "45 %"]);
  });

  it("restablecer rellena los valores por defecto y solo se aplican al guardar", async () => {
    const api = installServer({ chipsPct: [5, 50], greenFromPct: 40, yellowFromPct: 10 });
    const user = renderSection();

    await redField();
    await user.click(screen.getByRole("button", { name: "Restablecer valores por defecto" }));

    expect(await redField()).toHaveValue("15");
    expect(greenField()).toHaveValue("25");
    expect(chipTexts()).toEqual(["12 %", "20 %", "30 %"]);
    expect(api.writes()).toHaveLength(0);

    await user.click(saveButton());

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0].body).toEqual({
      pricing: { chipsPct: [12, 20, 30], greenFromPct: 25, yellowFromPct: 15 },
    });
  });

  it("si el servidor rechaza el guardado muestra su motivo y conserva lo escrito", async () => {
    const api = installServer();
    const user = renderSection();

    api.server.patchError = "Los porcentajes recomendados no pueden repetirse.";
    await setField(user, await redField(), "10");
    await user.click(saveButton());

    expect(
      await screen.findByText("Los porcentajes recomendados no pueden repetirse."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ajustes de precios guardados")).not.toBeInTheDocument();
    expect(await redField()).toHaveValue("10");
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });

  it("dos envíos en el mismo tick: una sola petición", async () => {
    const api = installServer();
    const user = renderSection();

    await setField(user, await redField(), "10");

    const form = saveButton().closest("form") as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    await screen.findByText("Ajustes de precios guardados");
    expect(api.writes()).toHaveLength(1);
  });

  it("sin permiso de edición solo se lee: campos bloqueados y sin acciones", async () => {
    installServer();
    renderSection(false);

    expect(await redField()).toBeDisabled();
    expect(greenField()).toBeDisabled();
    expect(chipTexts()).toEqual(["12 %", "20 %", "30 %"]);
    expect(screen.queryByRole("button", { name: "Guardar precios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Quitar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restablecer valores por defecto" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Solo un administrador puede cambiar estos valores."),
    ).toBeInTheDocument();
  });

  it("si los ajustes no cargan (403) muestra el motivo del servidor y deja reintentar", async () => {
    installApi(() => apiError("No tienes permiso para ver la configuración.", 403));
    renderSection();

    expect(
      await screen.findByText("No pudimos cargar los ajustes de precios"),
    ).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver la configuración.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
