/** REP-01 · filas, alineación del periodo anterior, etiquetas de fecha y resumen. */
import {
  buildRows,
  formatMoney,
  formatPointLabel,
  formatPointTitle,
  hasPreviousPeriod,
  hasVesValues,
  pointValue,
  summarizeChart,
  type TimeSeriesSeries,
} from "./chartData";

const SALES: TimeSeriesSeries = {
  id: "sales",
  name: "Ventas",
  points: [
    { count: 4, key: "2026-10-06", valueRef: 100, valueVes: 4000 },
    { count: 9, key: "2026-10-07", valueRef: 250.5, valueVes: 10020 },
    { count: 2, key: "2026-10-08", valueRef: 80, valueVes: 3200 },
  ],
  previousPoints: [
    { key: "2026-09-29", valueRef: 90, valueVes: 3500 },
    { key: "2026-09-30", valueRef: 110, valueVes: 4300 },
    { key: "2026-10-01", valueRef: 70, valueVes: 2700 },
    { key: "2026-10-02", valueRef: 999, valueVes: 9999 },
  ],
};

describe("formatPointLabel / formatPointTitle", () => {
  it("una clave de día se muestra tal cual es, sin desplazarla de zona horaria", () => {
    expect(formatPointLabel({ key: "2026-10-08" })).toBe("08/10");
    expect(formatPointTitle({ key: "2026-10-08" })).toBe("jueves, 8 de octubre de 2026");
    // Primer y último día del año: un desfase de zona los movería de año.
    expect(formatPointTitle({ key: "2026-01-01" })).toBe("jueves, 1 de enero de 2026");
    expect(formatPointTitle({ key: "2026-12-31" })).toBe("jueves, 31 de diciembre de 2026");
  });

  it("respeta la etiqueta y el título que traiga el punto (semana, mes)", () => {
    const week = { key: "2026-W41", label: "Sem 41", title: "Semana del 5 al 11 de octubre" };

    expect(formatPointLabel(week)).toBe("Sem 41");
    expect(formatPointTitle(week)).toBe("Semana del 5 al 11 de octubre");
    expect(formatPointTitle({ key: "2026-10", label: "Oct 2026" })).toBe("Oct 2026");
  });

  it("con año: `dd/mm/aa`, para rangos que cruzan de año", () => {
    expect(formatPointLabel({ key: "2025-03-09" }, { withYear: true })).toBe("09/03/25");
    expect(formatPointLabel({ key: "2026-W41", label: "Sem 41" }, { withYear: true })).toBe(
      "Sem 41",
    );
    expect(formatPointLabel({ key: "2026-10" }, { withYear: true })).toBe("2026-10");
  });

  it("una clave que no es un día real se muestra como llega", () => {
    expect(formatPointLabel({ key: "2026-02-31" })).toBe("2026-02-31");
    expect(formatPointTitle({ key: "2026-02-31" })).toBe("2026-02-31");
    expect(formatPointLabel({ key: "2026-10" })).toBe("2026-10");
  });
});

describe("pointValue / formatMoney / hasVesValues", () => {
  it("lee el valor de la moneda pedida y devuelve null si falta o no es finito", () => {
    expect(pointValue({ key: "a", valueRef: 5, valueVes: 200 }, "ref")).toBe(5);
    expect(pointValue({ key: "a", valueRef: 5, valueVes: 200 }, "ves")).toBe(200);
    expect(pointValue({ key: "a", valueRef: 5 }, "ves")).toBeNull();
    expect(pointValue({ key: "a", valueRef: 5, valueVes: null }, "ves")).toBeNull();
    expect(pointValue({ key: "a", valueRef: Number.NaN }, "ref")).toBeNull();
    expect(pointValue(null, "ref")).toBeNull();
    expect(pointValue(undefined, "ref")).toBeNull();
  });

  it("formatea con los helpers de moneda del proyecto", () => {
    expect(formatMoney(120.5, "ref")).toBe("ref 120.50");
    expect(formatMoney(4398.25, "ves")).toMatch(/^Bs\. 4\.398,25$/);
  });

  it("solo ofrece Bs si algún punto lo trae", () => {
    expect(hasVesValues([SALES])).toBe(true);
    expect(hasVesValues([{ id: "a", name: "A", points: [{ key: "x", valueRef: 1 }] }])).toBe(false);
    expect(hasVesValues([])).toBe(false);
  });
});

describe("buildRows", () => {
  it("alinea el periodo anterior por posición y descarta lo que sobra", () => {
    const rows = buildRows([SALES]);

    expect(rows.map((row) => row.key)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(rows.map((row) => row.cells.get("sales")?.previous?.key)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
    expect(rows[1].label).toBe("07/10");
    expect(rows[1].title).toBe("miércoles, 7 de octubre de 2026");
  });

  it("si los días cruzan de año, la etiqueta del eje lleva el año (REP-F1)", () => {
    const rows = buildRows([
      {
        id: "sales",
        name: "Ventas",
        points: [
          { key: "2025-12-31", valueRef: 1 },
          { key: "2026-01-01", valueRef: 2 },
          { key: "2026-W01", label: "Sem 1", valueRef: 3 },
        ],
      },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["31/12/25", "01/01/26", "Sem 1"]);
  });

  it("el periodo anterior de otro año no pone año en el eje", () => {
    const rows = buildRows([
      {
        id: "sales",
        name: "Ventas",
        points: [{ key: "2026-01-01", valueRef: 2 }],
        previousPoints: [{ key: "2025-12-31", valueRef: 1 }],
      },
    ]);

    expect(rows[0].label).toBe("01/01");
  });

  it("un periodo anterior más corto deja sin comparar los últimos puntos", () => {
    const rows = buildRows([{ ...SALES, previousPoints: SALES.previousPoints?.slice(0, 1) }]);

    expect(rows.map((row) => row.cells.get("sales")?.previous?.valueRef ?? null)).toEqual([
      90,
      null,
      null,
    ]);
  });

  it("periodo anterior vacío o ausente: no hay nada que dibujar", () => {
    expect(hasPreviousPeriod(buildRows([{ ...SALES, previousPoints: [] }]), "sales")).toBe(false);
    expect(
      hasPreviousPeriod(buildRows([{ ...SALES, previousPoints: undefined }]), "sales"),
    ).toBe(false);
    expect(hasPreviousPeriod(buildRows([SALES]), "sales")).toBe(true);
    expect(hasPreviousPeriod(buildRows([SALES]), "otra")).toBe(false);
  });

  it("une varias series por clave y añade al final las claves que solo trae otra", () => {
    const rows = buildRows([
      SALES,
      {
        id: "purchases",
        name: "Compras",
        points: [
          { key: "2026-10-07", valueRef: 40 },
          { key: "2026-10-09", valueRef: 15 },
        ],
      },
    ]);

    expect(rows.map((row) => row.key)).toEqual([
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(rows[1].cells.get("purchases")?.current?.valueRef).toBe(40);
    expect(rows[0].cells.has("purchases")).toBe(false);
    expect(rows[3].cells.has("sales")).toBe(false);
  });

  it("sin series o sin puntos no hay filas", () => {
    expect(buildRows([])).toEqual([]);
    expect(buildRows([{ id: "a", name: "A", points: [] }])).toEqual([]);
  });
});

describe("summarizeChart", () => {
  const series = [{ id: "sales", name: "Ventas" }];

  it("resume rango, total y máximo en la moneda activa", () => {
    const rows = buildRows([SALES]);

    expect(summarizeChart({ ariaLabel: "Ventas diarias", currency: "ref", rows, series })).toBe(
      "Ventas diarias: 3 puntos, del martes, 6 de octubre de 2026 al jueves, 8 de octubre de 2026. " +
        "Ventas: total ref 430.50, máximo ref 250.50 (miércoles, 7 de octubre de 2026).",
    );
    expect(
      summarizeChart({ ariaLabel: "Ventas diarias", currency: "ves", rows, series }),
    ).toContain("máximo Bs. 10.020,00");
  });

  it("mode=last: último valor en vez de la suma, para un acumulado", () => {
    const rows = buildRows([
      {
        id: "running",
        name: "Diferencia acumulada",
        points: [
          { key: "a", title: "cierre 1", valueRef: null, valueVes: 5 },
          { key: "b", title: "cierre 2", valueRef: null, valueVes: -7.5 },
          { key: "c", title: "cierre 3", valueRef: null, valueVes: -5 },
        ],
      },
    ]);
    const running = [{ id: "running", name: "Diferencia acumulada" }];
    const last = summarizeChart({
      ariaLabel: "Cierres",
      currency: "ves",
      mode: "last",
      rows,
      series: running,
    });

    expect(last).toMatch(
      /^Cierres: 3 puntos, del cierre 1 al cierre 3\. Diferencia acumulada: último valor .*5,00 \(cierre 3\), máximo Bs\. 5,00 \(cierre 1\)\.$/,
    );
    expect(last).not.toContain("total");
    // Sin `mode` sigue sumando, como siempre.
    expect(summarizeChart({ ariaLabel: "Cierres", currency: "ves", rows, series: running })).toMatch(
      /Diferencia acumulada: total .*7,50, máximo/,
    );
    // Los puntos solo en Bs no tienen cifra en REF: no se inventa ninguna.
    expect(
      summarizeChart({ ariaLabel: "Cierres", currency: "ref", mode: "last", rows, series: running }),
    ).toBe("Cierres: 3 puntos, del cierre 1 al cierre 3.");
  });

  it("mode=none: solo el rango", () => {
    const rows = buildRows([SALES]);

    expect(summarizeChart({ ariaLabel: "Ventas", currency: "ref", mode: "none", rows, series })).toBe(
      "Ventas: 3 puntos, del martes, 6 de octubre de 2026 al jueves, 8 de octubre de 2026.",
    );
  });

  it("un solo punto y sin datos", () => {
    const rows = buildRows([{ ...SALES, points: SALES.points.slice(0, 1) }]);

    expect(summarizeChart({ ariaLabel: "Ventas", currency: "ref", rows, series })).toBe(
      "Ventas: 1 punto, martes, 6 de octubre de 2026. " +
        "Ventas: total ref 100.00, máximo ref 100.00 (martes, 6 de octubre de 2026).",
    );
    expect(summarizeChart({ ariaLabel: "Ventas", currency: "ref", rows: [], series })).toBe(
      "Ventas: sin datos.",
    );
  });

  it("no acumula el arrastre de decimales al sumar", () => {
    const rows = buildRows([
      {
        id: "sales",
        name: "Ventas",
        points: [
          { key: "a", valueRef: 0.1 },
          { key: "b", valueRef: 0.2 },
        ],
      },
    ]);

    expect(summarizeChart({ ariaLabel: "X", currency: "ref", rows, series })).toContain(
      "total ref 0.30",
    );
  });
});
