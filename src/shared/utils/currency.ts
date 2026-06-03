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

export function refToVes(valueRef: number, refRateVes: number) {
  return valueRef * refRateVes;
}
