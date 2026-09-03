/**
 * Auditoria de cuadre de una tienda: baul, cajas, ventas y compras.
 * Lee Supabase con la service-role key del .env (solo lectura).
 *
 *   node scripts/qa-audit.mjs <storeId|slug>
 *
 * Sale con codigo 1 si encuentra al menos un descuadre.
 */
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);

const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
};

const get = async (path) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(v * 100) / 100;
const bs = (v) => `Bs ${r2(v).toLocaleString("es-VE", { minimumFractionDigits: 2 })}`;
const usd = (v) => `$${r2(v).toFixed(2)}`;

const problems = [];
const check = (label, expected, actual, fmt = bs, tol = 0.02) => {
  const diff = r2(n(actual) - n(expected));
  const ok = Math.abs(diff) <= tol;
  if (!ok) problems.push(`${label}: esperado ${fmt(expected)}, actual ${fmt(actual)}, delta ${fmt(diff)}`);
  console.log(`  ${ok ? "OK " : "XX "} ${label.padEnd(46)} esperado ${fmt(expected).padStart(18)}  actual ${fmt(actual).padStart(18)}`);
};

const arg = process.argv[2];
if (!arg) throw new Error("uso: node scripts/qa-audit.mjs <storeId|slug>");
const stores = await get(`stores?select=id,name,slug`);
const store = stores.find((s) => s.id === arg || s.slug === arg);
if (!store) throw new Error(`tienda no encontrada: ${arg}\ndisponibles: ${stores.map((s) => s.slug).join(", ")}`);
const S = store.id;

console.log(`\n=== ${store.name} (${store.slug}) ===\n`);

// ---------------------------------------------------------------- BAUL
const [vault] = await get(`store_vaults?store_id=eq.${S}&select=*`);
const vmoves = await get(`vault_movements?store_id=eq.${S}&select=type,bucket,amount_ves,amount_ref`);

const IN_VAULT = new Set(["deposit", "sale_in", "transfer_in"]);
const OUT_VAULT = new Set(["purchase_out", "withdrawal"]);
const vaultExpected = { cuentaVes: 0, efectivoRef: 0, efectivoVes: 0 };
for (const m of vmoves) {
  const sign = IN_VAULT.has(m.type) ? 1 : OUT_VAULT.has(m.type) ? -1 : m.type === "adjustment" ? 1 : 0;
  if (m.bucket === "efectivo") {
    vaultExpected.efectivoVes += sign * n(m.amount_ves);
    vaultExpected.efectivoRef += sign * n(m.amount_ref);
  } else {
    vaultExpected.cuentaVes += sign * n(m.amount_ves);
  }
}

console.log("BAUL (store_vaults vs suma de vault_movements)");
if (!vault) {
  console.log("  -- sin baul --");
} else {
  check("baul efectivo Bs", vaultExpected.efectivoVes, vault.balance_efectivo_ves);
  check("baul cuenta Bs", vaultExpected.cuentaVes, vault.balance_ves);
  check("baul REF", vaultExpected.efectivoRef, vault.balance_ref, usd);
}

// ---------------------------------------------------------------- CAJAS
const sessions = await get(
  `cash_sessions?store_id=eq.${S}&select=id,status,opening_ves,opening_ref,closing_ves,closing_ref,` +
    `theoretical_closing_ves,theoretical_closing_ref,vault_transferred_at,absorbed_by_session_id,closed_reason,opened_at,closed_at` +
    `&order=opened_at`,
);
const cmoves = await get(`cash_movements?store_id=eq.${S}&select=session_id,type,amount_ves,amount_ref,notes`);

/**
 * Desde `20260904b` el cierre asienta la diferencia contado-teorico como un
 * movimiento propio, asi que los movimientos suman lo CONTADO. El teorico que
 * guarda `cash_sessions` es el de antes de ese asiento: para compararlos hay
 * que dejar el movimiento de cuadre fuera.
 */
const isCloseAdjustment = (m) => (m.notes ?? "").startsWith("Cuadre de cierre");

const PHYS_IN = new Set(["sale_in", "adjustment"]);
const PHYS_OUT = new Set(["transfer_out", "refund_out", "change_out"]);

console.log("\nCAJAS (teorico de cada sesion vs cash_movements)");
for (const s of sessions) {
  const mine = cmoves.filter((m) => m.session_id === s.id);
  let ves = n(s.opening_ves);
  let ref = n(s.opening_ref);
  let accountVes = 0;
  let settledVes = 0;
  let settledRef = 0;
  for (const m of mine) {
    if (m.type === "opening") continue;
    if (isCloseAdjustment(m)) {
      const sign = PHYS_IN.has(m.type) ? 1 : -1;
      settledVes += sign * n(m.amount_ves);
      settledRef += sign * n(m.amount_ref);
      continue;
    }
    if (PHYS_IN.has(m.type)) {
      ves += n(m.amount_ves);
      ref += n(m.amount_ref);
    } else if (PHYS_OUT.has(m.type)) {
      ves -= n(m.amount_ves);
      ref -= n(m.amount_ref);
    } else if (m.type === "account_in") accountVes += n(m.amount_ves);
    else if (m.type === "account_out") accountVes -= n(m.amount_ves);
  }
  const tag = `${s.status}${s.closed_reason ? `/${s.closed_reason}` : ""}${s.absorbed_by_session_id ? " ABSORBIDA" : ""}${s.vault_transferred_at ? " transferida" : ""}`;
  const label = `sesion ${s.id.slice(0, 8)}`;
  console.log(`  ${label} [${tag}] cuenta ${bs(accountVes)}`);

  // Plausibilidad: la gaveta nunca puede quedar en negativo. Un teorico bajo
  // cero significa que se entrego dinero que la caja no tenia (vuelto, retiro).
  if (r2(ves) < -0.02 || r2(ref) < -0.02) {
    problems.push(`${label}: efectivo negativo en gaveta (${bs(ves)} / ${usd(ref)})`);
    console.log(`  XX  ${label} efectivo NEGATIVO en gaveta: ${bs(ves)} / ${usd(ref)}`);
  }

  if (s.status === "closed") {
    check("   teorico Bs", ves, s.theoretical_closing_ves);
    check("   teorico REF", ref, s.theoretical_closing_ref, usd);

    // Faltante/sobrante: hoy no se asienta en ningun lado, asi que aqui es el
    // unico lugar donde se ve. Un delta grande es dinero creado o destruido.
    const diffVes = r2(n(s.closing_ves) - n(s.theoretical_closing_ves));
    const diffRef = r2(n(s.closing_ref) - n(s.theoretical_closing_ref));
    if (diffVes || diffRef) {
      const asentado = Math.abs(r2(settledVes - diffVes)) <= 0.02 && Math.abs(r2(settledRef - diffRef)) <= 0.02;
      const severe = !asentado && (Math.abs(diffVes) > 100 || Math.abs(diffRef) > 1);
      console.log(
        `   ${severe ? "XX" : "~~"} diferencia contado-teorico: ${bs(diffVes)} / ${usd(diffRef)}` +
          (asentado ? " (asentada)" : " (SIN asentar)"),
      );
      if (severe) {
        problems.push(`${label}: contado difiere del teorico en ${bs(diffVes)} / ${usd(diffRef)} sin asiento de cuadre`);
      }
    }

    if (s.absorbed_by_session_id && !s.vault_transferred_at) {
      problems.push(`${label}: cierre absorbido y nunca transferido — el efectivo del turno no llego al baul`);
      console.log(`  XX  ${label} absorbido sin transferir: efectivo perdido para el baul`);
    }
  } else {
    console.log(`       en gaveta ahora: ${bs(ves)} / ${usd(ref)}`);
  }
}

// ---------------------------------------------------------------- VENTAS
const sales = await get(`sales?store_id=eq.${S}&select=id,invoice_number,total_ves,paid_ves,status,ref_rate_ves`);
const paymentCols =
  "id,sale_id,purchase_id,method,amount,amount_ves,amount_ref,status";
const payments = await get(`payments?store_id=eq.${S}&select=${paymentCols},change_method,change_amount,change_ves,change_ref`).catch(
  () => {
    console.log("  (aviso: el parche 20260903 aun no esta aplicado; se audita sin vuelto)");
    return get(`payments?store_id=eq.${S}&select=${paymentCols}`);
  },
);
const active = payments.filter((p) => p.status !== "anulado");

console.log("\nVENTAS (paid_ves vs neto de pagos)");
let salesBad = 0;
for (const sale of sales) {
  const mine = active.filter((p) => p.sale_id === sale.id);
  const net = r2(mine.reduce((a, p) => a + n(p.amount_ves) - n(p.change_ves), 0));
  const diff = r2(n(sale.paid_ves) - net);
  const overpay = r2(net - n(sale.total_ves));
  // Sobrante legitimo: el vuelto no siempre es representable en billetes, asi
  // que la gaveta se queda con hasta un billete chico. Mas que eso es cobro
  // duplicado o monto mal tecleado.
  const maxRounding = Math.max(10, r2(0.01 * n(sale.ref_rate_ves)));

  if (Math.abs(diff) > 0.02) {
    salesBad += 1;
    problems.push(`venta ${sale.invoice_number}: paid_ves ${bs(sale.paid_ves)} != neto pagos ${bs(net)}`);
    console.log(`  XX ${sale.invoice_number} paid ${bs(sale.paid_ves)} vs neto ${bs(net)} (${sale.status})`);
  } else if (overpay > maxRounding) {
    salesBad += 1;
    problems.push(
      `venta ${sale.invoice_number}: cobrada de mas por ${bs(overpay)} (total ${bs(sale.total_ves)}) — posible cobro duplicado`,
    );
    console.log(`  XX ${sale.invoice_number} total ${bs(sale.total_ves)} cobrado ${bs(net)} SOBRECOBRO ${bs(overpay)} (${sale.status})`);
  } else if (overpay > 0.02) {
    console.log(`  ~~ ${sale.invoice_number} total ${bs(sale.total_ves)} cobrado ${bs(net)} redondeo ${bs(overpay)} (${sale.status})`);
  }

  if (sale.status === "cancelada" && net > 0.02) {
    salesBad += 1;
    problems.push(`venta ${sale.invoice_number}: cancelada pero conserva ${bs(net)} en pagos activos`);
    console.log(`  XX ${sale.invoice_number} CANCELADA con ${bs(net)} en pagos activos`);
  }
}
console.log(`  ${sales.length} ventas revisadas, ${salesBad} con descuadre`);

// ---------------------------------------------------------------- COMPRAS
const purchases = await get(`purchases?store_id=eq.${S}&select=id,purchase_number,total_ves,paid_ves,status`);
console.log("\nCOMPRAS (paid_ves vs pagos)");
let purchasesBad = 0;
for (const p of purchases) {
  const mine = active.filter((x) => x.purchase_id === p.id);
  const paid = r2(mine.reduce((a, x) => a + n(x.amount_ves), 0));
  if (Math.abs(r2(n(p.paid_ves) - paid)) > 0.02) {
    purchasesBad += 1;
    problems.push(`compra ${p.purchase_number}: paid_ves ${bs(p.paid_ves)} != pagos ${bs(paid)}`);
    console.log(`  XX ${p.purchase_number} paid ${bs(p.paid_ves)} vs pagos ${bs(paid)}`);
  }

  // Pagar por encima del total saca dinero del baul contra una factura que ya
  // estaba saldada: es la fuga de efectivo mas directa del sistema.
  const overpaid = r2(paid - n(p.total_ves));
  if (overpaid > 0.02 && p.status !== "cancelado" && p.status !== "devuelto") {
    purchasesBad += 1;
    problems.push(`compra ${p.purchase_number}: pagada de mas por ${bs(overpaid)} (total ${bs(p.total_ves)})`);
    console.log(`  XX ${p.purchase_number} total ${bs(p.total_ves)} pagado ${bs(paid)} SOBREPAGO ${bs(overpaid)}`);
  }
}
console.log(`  ${purchases.length} compras revisadas, ${purchasesBad} con descuadre`);

// ---------------------------------------------------------------- RESUMEN
console.log("\n--- RESUMEN ---");
if (problems.length === 0) {
  console.log("Todo cuadra.");
} else {
  console.log(`${problems.length} descuadre(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}
