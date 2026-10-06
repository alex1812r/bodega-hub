/**
 * @jest-environment node
 *
 * Catálogo y lógica pura de la suite `oneshots` (STK-403). Sin red ni base:
 * solo comprueba contra el repo que cada fila apunta a un parche que existe.
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { ONESHOT_CASES, ONESHOT_ROWS, nonZeroViews, residueProblems, uiSkipReason } from "./oneshots";

const PATCHES_DIR = resolve(__dirname, "../../../supabase/patches");

describe("filas de one-shots", () => {
  it("son las 11 de oneshots-to-scenarios.md, con clave única", () => {
    expect(ONESHOT_ROWS).toHaveLength(11);
    expect(new Set(ONESHOT_ROWS.map((row) => row.key)).size).toBe(11);
  });

  it("cada fila apunta a un parche one-shot que existe en supabase/patches", () => {
    for (const row of ONESHOT_ROWS) {
      expect(row.patch).toContain("one-shot");
      expect(row.patch.startsWith(row.key.replace(/_.*$/, ""))).toBe(true);
      expect(existsSync(resolve(PATCHES_DIR, row.patch))).toBe(true);
    }
  });

  it("no deja fuera ningún one-shot que toque stock", () => {
    const stockOneShots = readdirSync(PATCHES_DIR).filter((name) => /^(20260813[def]|20260815c|20260818|20260821-|20260830)/.test(name) && name.includes("one-shot"));
    expect(stockOneShots.sort()).toEqual(ONESHOT_ROWS.map((row) => row.patch).sort());
  });
});

describe("catálogo de casos", () => {
  const ids = ONESHOT_CASES.map((c) => c.id);

  it("tiene ids únicos os.<parche>.<parte>", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^os\.2026\d{4}[a-z]?(_[a-z]+)?\.(symptom|fix_by_api|sql_replica)$/);
  });

  it("cada fila tiene su corrección por API", () => {
    for (const row of ONESHOT_ROWS) expect(ids).toContain(`os.${row.key}.fix_by_api`);
  });

  it("los parches que fijaron stock_after a mano o reasignaron movimientos tienen réplica SQL etiquetada H7", () => {
    for (const row of ONESHOT_ROWS) {
      const replica = ONESHOT_CASES.find((c) => c.id === `os.${row.key}.sql_replica`);
      expect(Boolean(replica)).toBe(row.replica);
      if (replica) expect(replica.hypothesis).toEqual(["H7"]);
    }
    const replicated = ONESHOT_ROWS.filter((row) => row.replica).map((row) => row.key);
    for (const key of ["20260813d", "20260813f", "20260815c", "20260821", "20260830", "20260830b_add", "20260830c", "20260830d"]) {
      expect(replicated).toContain(key);
    }
  });

  it("las correcciones por API no etiquetan hipótesis (no contaminan el agregado)", () => {
    for (const c of ONESHOT_CASES.filter((item) => item.id.endsWith(".fix_by_api"))) expect(c.hypothesis).toEqual([]);
  });

  it("toda fila con síntoma de captura tiene un caso .symptom; el split (sin síntoma de UI) no", () => {
    for (const row of ONESHOT_ROWS) {
      expect(ids.includes(`os.${row.key}.symptom`)).toBe(row.uiFlows.length > 0);
    }
  });

  it("los síntomas de captura en UI se devuelven como skip con el flujo de la ola 8.3, sin tocar la base", async () => {
    const uiOnly = ONESHOT_ROWS.filter((row) => row.uiFlows.length > 0 && row.key !== "20260830");
    expect(uiOnly).toHaveLength(9);
    for (const row of uiOnly) {
      const symptom = ONESHOT_CASES.find((c) => c.id === `os.${row.key}.symptom`);
      if (!symptom) throw new Error(`falta os.${row.key}.symptom`);
      // Un skip no usa `lab` ni el contexto: si los tocara, esto reventaría.
      const out = await symptom.run(undefined as never, undefined as never);
      expect(out.verdict).toBe("skip");
      expect(out.detail).toMatch(/requiere UI → ola 8\.3, flujos? \d/);
    }
  });
});

describe("helpers", () => {
  it("uiSkipReason nombra uno o varios flujos", () => {
    expect(uiSkipReason({ uiFlows: [4] }, "pack_count mal capturado")).toBe("pack_count mal capturado: requiere UI → ola 8.3, flujo 4");
    expect(uiSkipReason({ uiFlows: [1, 2] }, "cantidad duplicada")).toBe("cantidad duplicada: requiere UI → ola 8.3, flujos 1 y 2");
  });

  it("nonZeroViews lista solo las vistas con filas", () => {
    expect(nonZeroViews({ stock_reconciliation: 0, stock_chain_breaks: 3, negative_stock: 1 })).toEqual(["stock_chain_breaks=3", "negative_stock=1"]);
    expect(nonZeroViews({ stock_reconciliation: 0 })).toEqual([]);
  });
});

describe("residuo esperado de las réplicas (STK-603)", () => {
  const sale = "11111111-1111-4111-8111-111111111111";
  const dura = "22222222-2222-4222-8222-222222222222";
  const expected830c = [
    { view: "movements_without_document" as const, label: "venta original de dura sin línea", where: { issue: "missing_document_line", product_id: dura, sale_id: sale, type: "venta" } },
    { view: "reversal_mismatches" as const, label: "ajuste_entrada sobre venta viva", where: { issue: "reversal_on_live_document", document_id: sale, product_id: dura } },
  ];
  const rows830c = {
    movements_without_document: [{ movement_id: "m1", issue: "missing_document_line", product_id: dura, sale_id: sale, type: "venta" }],
    reversal_mismatches: [{ document_type: "sale", issue: "reversal_on_live_document", document_id: sale, product_id: dura, original_delta: -1, reversal_delta: 1 }],
  };

  it("sin residuo esperado, cualquier fila en cualquier vista es un problema", () => {
    expect(residueProblems({}, [])).toEqual([]);
    expect(residueProblems({ stock_chain_breaks: [] }, [])).toEqual([]);
    const problems = residueProblems({ negative_stock: [{ product_id: dura }] }, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("negative_stock");
  });

  it("el residuo exacto del one-shot no es un problema", () => {
    expect(residueProblems(rows830c, expected830c)).toEqual([]);
  });

  it("una fila de más, una razón distinta o una fila esperada ausente sí lo son", () => {
    const extra = residueProblems({ ...rows830c, stock_chain_breaks: [{ movement_id: "m9", product_id: dura }] }, expected830c);
    expect(extra).toHaveLength(1);
    expect(extra[0]).toContain("stock_chain_breaks");
    const otherIssue = residueProblems(
      { ...rows830c, movements_without_document: [{ movement_id: "m1", issue: "null_document", product_id: dura, sale_id: sale, type: "venta" }] },
      expected830c,
    );
    expect(otherIssue.join(" | ")).toContain("no esperada");
    expect(otherIssue.join(" | ")).toContain("venta original de dura sin línea");
    const missing = residueProblems({ reversal_mismatches: rows830c.reversal_mismatches }, expected830c);
    expect(missing).toEqual([expect.stringContaining("venta original de dura sin línea")]);
    const twice = residueProblems({ ...rows830c, reversal_mismatches: [...rows830c.reversal_mismatches, ...rows830c.reversal_mismatches] }, expected830c);
    expect(twice).toHaveLength(1);
  });

  it("stock_reconciliation nunca puede formar parte del residuo aceptado", () => {
    const rows = { stock_reconciliation: [{ product_id: dura, diff: 1 }] };
    const problems = residueProblems(rows, [{ view: "stock_reconciliation", label: "diff", where: { product_id: dura } }]);
    expect(problems.join(" | ")).toContain("stock_reconciliation");
  });
});
