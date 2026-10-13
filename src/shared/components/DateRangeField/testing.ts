import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

type Queries = Pick<typeof screen, "getByRole" | "getByTestId">;

/** Chip de preset de un `DateRangeField` ("Mes pasado", "Personalizado"…). */
export function dateRangeChip(name: string, container?: HTMLElement) {
  const queries: Queries = container ? within(container) : screen;

  return queries.getByRole("button", { name });
}

/**
 * Elige un rango personalizado en el calendario de un `DateRangeField`: abre
 * «Personalizado» y pulsa el día de inicio y el de fin. Los días se nombran como
 * los lee el calendario (`"5 de octubre de 2026"`) y deben estar en el mes que
 * abre (el del fin del rango actual o, sin rango, el de hoy).
 */
export async function pickCustomDateRange(
  user: UserEvent,
  fromDay: string,
  toDay: string,
  container?: HTMLElement,
) {
  await user.click(dateRangeChip("Personalizado", container));

  const calendar = within(screen.getByRole("dialog", { name: "Elegir rango personalizado" }));

  await user.click(calendar.getByRole("button", { name: new RegExp(`, ${fromDay}(, hoy)?$`) }));
  await user.click(calendar.getByRole("button", { name: new RegExp(`, ${toDay}(, hoy)?$`) }));
}

/** Texto del rango que muestra un `DateRangeField` ("1–30 sep 2026", "Todas las fechas"). */
export function dateRangeLabel(container?: HTMLElement) {
  const queries: Queries = container ? within(container) : screen;

  return queries.getByTestId("date-range-label");
}
