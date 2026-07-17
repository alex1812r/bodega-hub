export type VenezuelanBank = {
  code: string;
  label: string;
  name: string;
};

export function formatBankLabel(code: string, name: string) {
  return `${code} - ${name}`;
}

export const VENEZUELAN_BANKS: VenezuelanBank[] = [
  { code: "0102", name: "Banco de Venezuela" },
  { code: "0104", name: "Banco Venezolano de Credito" },
  { code: "0105", name: "Banco Mercantil" },
  { code: "0108", name: "BBVA Provincial" },
  { code: "0114", name: "Bancaribe" },
  { code: "0115", name: "Banco Exterior" },
  { code: "0128", name: "Banco Caroni" },
  { code: "0134", name: "Banesco" },
  { code: "0137", name: "Banco Sofitasa" },
  { code: "0138", name: "Banco Plaza" },
  { code: "0146", name: "Bangente" },
  { code: "0151", name: "BFC Banco Fondo Comun" },
  { code: "0156", name: "100% Banco" },
  { code: "0157", name: "Delsur" },
  { code: "0163", name: "Banco del Tesoro" },
  { code: "0166", name: "Banco Agricola de Venezuela" },
  { code: "0168", name: "Bancrecer" },
  { code: "0169", name: "Mi Banco" },
  { code: "0171", name: "Banco Activo" },
  { code: "0172", name: "Bancamiga" },
  { code: "0174", name: "Banplus" },
  { code: "0175", name: "BDT Banco Digital de los Trabajadores" },
  { code: "0177", name: "BANFANB" },
  { code: "0178", name: "N58 Banco Digital" },
  { code: "0191", name: "BNC Banco Nacional de Credito" },
  { code: "0601", name: "Instituto Municipal de Credito Popular" },
].map((bank) => ({
  ...bank,
  label: formatBankLabel(bank.code, bank.name),
}));

export function findBankByCode(code: string) {
  const normalized = code.trim();
  return VENEZUELAN_BANKS.find((bank) => bank.code === normalized);
}

export function findBankByLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return VENEZUELAN_BANKS.find(
    (bank) =>
      bank.label.toLowerCase() === normalized ||
      bank.code === normalized ||
      bank.name.toLowerCase() === normalized,
  );
}

export function isKnownBankLabel(value: string) {
  return Boolean(findBankByLabel(value));
}

export function filterBanks(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return VENEZUELAN_BANKS;
  }

  return VENEZUELAN_BANKS.filter(
    (bank) =>
      bank.code.includes(normalized) ||
      bank.name.toLowerCase().includes(normalized) ||
      bank.label.toLowerCase().includes(normalized),
  );
}
