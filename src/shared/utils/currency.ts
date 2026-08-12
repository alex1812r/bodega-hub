const vesFormatter = new Intl.NumberFormat("es-VE", {
  style: "currency",
  currency: "VES",
  minimumFractionDigits: 2,
});

export function formatVes(value: number) {
  return vesFormatter.format(value);
}

export function formatRef(value: number) {
  return `ref ${value.toFixed(2)}`;
}

/** Tablas / montos REF: "ref 120.50" (evita el simbolo $). */
export function formatRefUsd(value: number) {
  return `ref ${value.toFixed(2)}`;
}

/** Stitch tablas de ventas: "Bs. 4,398.25" */
export function formatVesBs(value: number) {
  return `Bs. ${value.toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function refToVes(valueRef: number, refRateVes: number) {
  return valueRef * refRateVes;
}

/** Convert VES → REF using the official rate (1 REF = refRateVes VES). */
export function vesToRef(valueVes: number, refRateVes: number) {
  if (refRateVes <= 0) {
    return 0;
  }

  return valueVes / refRateVes;
}

/** Round money amounts to 2 decimal places. */
export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/** Apply a tax rate (%) on top of a net REF/VES amount (e.g. cost sin impuesto → con impuesto). */
export function amountWithTax(netAmount: number, taxRatePercent: number) {
  const rate = Math.max(0, taxRatePercent);
  return roundMoney(netAmount * (1 + rate / 100));
}
