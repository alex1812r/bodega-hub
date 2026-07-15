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

/** Stitch tablas de ventas: "$120.50" */
export function formatRefUsd(value: number) {
  return `$${value.toFixed(2)}`;
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
