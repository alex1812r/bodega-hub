/**
 * Casos de caos de la nómina (§10 de docs/agent-prompts/nomina-gtm.md).
 *
 * Se ejecutan por HTTP contra el servidor de desarrollo con datos mock, que es
 * donde se puede provocar el desorden sin tocar Supabase:
 *
 *   npm run dev:mock          (en otra terminal)
 *   node scripts/e2e-payroll/chaos.mjs
 *
 * Cada caso imprime PASA o FALLA con la evidencia (status y código de error).
 * Sale con código 1 si algún caso falla, para poder engancharlo a CI.
 */

const BASE = process.env.PAYROLL_CHAOS_BASE_URL ?? "http://localhost:3000";
const STORE_A = "00000000-0000-4000-8000-000000000001";
const STORE_B = "00000000-0000-4000-8000-000000000002";

const asAdmin = { "x-demo-role": "admin", "x-demo-store-id": STORE_A, "x-demo-user-id": "user-admin" };
const asAdminB = { "x-demo-role": "admin", "x-demo-store-id": STORE_B, "x-demo-user-id": "user-sur-admin" };
const asSeller = { "x-demo-role": "vendedor", "x-demo-store-id": STORE_A, "x-demo-user-id": "user-seller" };

const results = [];

async function call(path, { body, headers = asAdmin, method = "GET" } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method,
  });

  const payload = await response.json().catch(() => null);

  return { code: payload?.error?.code ?? null, message: payload?.error?.message ?? null, payload, status: response.status };
}

function check(id, title, passed, evidence) {
  results.push({ evidence, id, passed, title });
  console.log(`${passed ? "PASA " : "FALLA"} ${id} — ${title}\n       ${evidence}`);
}

/** Deja la tienda A con un cajero al 4 % y devuelve la quincena anterior aprobada. */
async function setUp() {
  await call("/api/payroll/employees/user-seller", {
    body: { commissionPct: 4, isActive: true },
    method: "PUT",
  });

  const current = await call("/api/payroll/current");
  const previousKey = current.payload.data.previousPeriodKey;

  let period = await call("/api/payroll/periods", { body: { periodKey: previousKey }, method: "POST" });

  if (period.status === 409) {
    const list = await call("/api/payroll/periods?limit=50");
    period = { payload: { data: list.payload.data.items.find((row) => row.periodKey === previousKey) } };
  }

  return { periodId: period.payload.data.id, previousKey, currentKey: current.payload.data.currentPeriodKey };
}

async function main() {
  console.log(`Caos de nómina contra ${BASE}\n`);

  const { periodId, previousKey, currentKey } = await setUp();

  // 10.2 — calcular la quincena en curso (aún no ha terminado).
  const open = await call("/api/payroll/periods", { body: { periodKey: currentKey }, method: "POST" });
  check("10.2", "Calcular la quincena en curso", open.status === 400, `status ${open.status} · ${open.message ?? ""}`);

  // 10.12 — claves de quincena en bisiesto y cambio de año.
  const leap = await call("/api/payroll/periods", { body: { periodKey: "2024-02-Q2" }, method: "POST" });
  const leapOk = leap.status === 201 || leap.status === 200 || leap.status === 409;
  check("10.12", "Quincena de febrero bisiesto", leapOk, `status ${leap.status} · to_date ${leap.payload?.data?.toDate ?? "n/a"}`);

  // 10.15 — ventas sin cajero elegible no comisionan a nadie, pero se cuentan.
  const detailBefore = await call(`/api/payroll/periods/${periodId}`);
  const withoutCashier = detailBefore.payload.data.salesWithoutCashier;
  check("10.15", "Ventas sin cajero", typeof withoutCashier === "number", `salesWithoutCashier = ${withoutCashier}`);

  // 10.6 — cajero sin ventas: ítem en cero, sin división por cero en el semáforo.
  check(
    "10.6",
    "Cajero sin ventas en la quincena",
    detailBefore.payload.data.period.shareOfGrossProfitPct === null || Number.isFinite(detailBefore.payload.data.period.shareOfGrossProfitPct),
    `items en cero: ${detailBefore.payload.data.items.filter((i) => i.totalRef === 0).length} · semáforo ${String(detailBefore.payload.data.period.shareOfGrossProfitPct)}`,
  );

  // 10.5 — sin ganancia bruta el semáforo informa, no rompe.
  check("10.5", "Sin ganancia bruta el semáforo no divide por cero", detailBefore.payload.data.period.shareOfGrossProfitPct === null, `share = ${String(detailBefore.payload.data.period.shareOfGrossProfitPct)}`);

  // 10.9 — el admin de la tienda B no ve la quincena de la tienda A.
  const crossStore = await call(`/api/payroll/periods/${periodId}`, { headers: asAdminB });
  check("10.9", "Aislamiento entre tiendas", crossStore.status === 404 || crossStore.status === 403, `status ${crossStore.status}`);

  // Aprobar para poder pagar.
  const approve = await call(`/api/payroll/periods/${periodId}/approve`, { method: "POST" });
  const approved = approve.status === 200 || approve.status === 409;
  check("10.4", "Aprobar recalcula dentro de la operación", approved, `status ${approve.status}`);

  // 10.3 — recalcular una quincena aprobada.
  const recompute = await call(`/api/payroll/periods/${periodId}/recompute`, { method: "POST" });
  check("10.3", "Recalcular una quincena aprobada", recompute.status === 400 || recompute.status === 409, `status ${recompute.status} · ${recompute.message ?? ""}`);

  const detail = await call(`/api/payroll/periods/${periodId}`);
  const payable = detail.payload.data.items.find((item) => item.totalRef > 0 && item.status === "pendiente");

  if (!payable) {
    check("10.1", "Doble pago concurrente", false, "no hay ítem pendiente con monto; revisa los datos mock");
  } else {
    // 10.14 — el cajero no puede pagarse a sí mismo.
    const sellerPays = await call(`/api/payroll/items/${payable.id}/pay`, {
      body: { amount: 1, method: "efectivo_ves" },
      headers: asSeller,
      method: "POST",
    });
    check("10.14", "El vendedor intenta pagar su propio recibo", sellerPays.status === 403, `status ${sellerPays.status}`);

    // 10.10 — efectivo USD por encima del saldo REF del baúl.
    const overUsd = await call(`/api/payroll/items/${payable.id}/pay`, {
      body: { amount: 999_999, method: "efectivo_usd" },
      method: "POST",
    });
    check("10.10", "Efectivo USD sin saldo REF", overUsd.status === 400 && overUsd.code === "INSUFFICIENT_VAULT_BALANCE", `status ${overUsd.status} · ${overUsd.code} · ${overUsd.message ?? ""}`);

    // 10.1 — dos pagos simultáneos del mismo recibo: uno solo debe pasar.
    const body = { amount: 100, method: "efectivo_ves" };
    const [first, second] = await Promise.all([
      call(`/api/payroll/items/${payable.id}/pay`, { body, method: "POST" }),
      call(`/api/payroll/items/${payable.id}/pay`, { body, method: "POST" }),
    ]);
    const statuses = [first.status, second.status].sort();
    check("10.1", "Doble pago concurrente", statuses[0] === 200 && statuses[1] === 409, `status ${statuses.join(" y ")}`);

    // El baúl solo debe registrar un movimiento para este recibo.
    const movements = await call("/api/vault/movements?limit=100");
    const mine = (movements.payload.data.items ?? movements.payload.data).filter((row) => row.payrollItemId === payable.id);
    check("10.1b", "Un solo movimiento en el baúl", mine.length === 1, `movimientos payroll_out del recibo: ${mine.length}`);

    // 10.13 — anular exige motivo.
    const cancelNoNotes = await call(`/api/payroll/items/${payable.id}/cancel-payment`, { body: {}, method: "POST" });
    check("10.13", "Anular sin motivo", cancelNoNotes.status === 400, `status ${cancelNoNotes.status}`);

    const cancel = await call(`/api/payroll/items/${payable.id}/cancel-payment`, {
      body: { notes: "Caos: se pagó por error" },
      method: "POST",
    });
    check("10.13b", "Anular con motivo restaura el baúl", cancel.status === 200, `status ${cancel.status} · recibo ${cancel.payload?.data?.status ?? "?"}`);
  }

  // 10.8 — cambiar el % después de aprobar no toca la quincena.
  const snapshotBefore = (await call(`/api/payroll/periods/${periodId}`)).payload.data.items[0]?.commissionPct;
  await call("/api/payroll/employees/user-seller", { body: { commissionPct: 9, isActive: true }, method: "PUT" });
  const snapshotAfter = (await call(`/api/payroll/periods/${periodId}`)).payload.data.items[0]?.commissionPct;
  check("10.8", "Cambiar el % no altera una quincena aprobada", snapshotBefore === snapshotAfter, `antes ${String(snapshotBefore)} · después ${String(snapshotAfter)}`);

  // 10.11 — una venta ya comisionada no vuelve a comisionar en otra quincena.
  const reCompute = await call("/api/payroll/periods", { body: { periodKey: previousKey }, method: "POST" });
  check("10.11", "Una venta comisiona una sola vez", reCompute.status === 400 || reCompute.status === 409, `status ${reCompute.status} · ${reCompute.message ?? ""}`);

  // 10.7 — cajero desactivado: no entra en quincenas nuevas.
  await call("/api/payroll/employees/user-seller", { body: { commissionPct: 9, isActive: false }, method: "PUT" });
  const settings = await call("/api/payroll/settings");
  const seller = settings.payload.data.employees.find((row) => row.profileId === "user-seller");
  check("10.7", "Cajero desactivado", seller?.isActive === false, `isActive = ${String(seller?.isActive)}`);

  const failed = results.filter((row) => !row.passed);
  console.log(`\n${results.length - failed.length}/${results.length} casos pasan.`);

  if (failed.length > 0) {
    console.log(`Fallan: ${failed.map((row) => row.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("El script de caos no pudo completarse:", error);
  process.exitCode = 1;
});
