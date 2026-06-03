export const E2E_PASSWORD = process.env.SMOKE_API_PASSWORD ?? "Admin123!";

export function e2eSuffix() {
  const s = process.env.E2E_RUN_SUFFIX;
  return s ? `-${s}` : "";
}

export function sku(base: string) {
  return `${base}${e2eSuffix()}`;
}

export const USERS = {
  admin: { email: process.env.SMOKE_API_EMAIL ?? "admin@example.com", password: E2E_PASSWORD },
  vendedor: { email: "vendedor@example.com", password: E2E_PASSWORD },
  almacen: { email: "almacen@example.com", password: E2E_PASSWORD },
  contador: { email: "contador@example.com", password: E2E_PASSWORD },
} as const;

export type CategorySeed = { key: string; name: string; description: string };
export type ProductSeed = {
  key: string;
  sku: string;
  name: string;
  categoryKey: string;
  salePriceRef: number;
  currentCostRef: number;
  minStock: number;
};
export type ContactSeed = {
  key: string;
  name: string;
  type: "cliente" | "proveedor" | "ambos";
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
};

export const CATEGORIES: CategorySeed[] = [
  { key: "chucherias", name: "Chucherías", description: "Dulces, chicles y chocolates" },
  { key: "refrescos", name: "Refrescos", description: "Gaseosas, jugos y malta" },
  { key: "helados", name: "Helados", description: "Paletas y helados de pote" },
  { key: "snacks", name: "Snacks", description: "Papas, galletas saladas" },
  { key: "despensa_granos", name: "Despensa — Granos", description: "Arroz, pasta, legumbres" },
  {
    key: "despensa_harinas",
    name: "Despensa — Harinas y aceites",
    description: "Harina PAN, aceites, condimentos",
  },
  { key: "lacteos", name: "Lácteos y huevos", description: "Leche, queso, huevos" },
  { key: "limpieza", name: "Limpieza básica", description: "Detergente, jabón, cloro" },
  { key: "prueba_dup", name: "Categoría prueba duplicado", description: "Para test 409" },
];

export const PRODUCTS: ProductSeed[] = [
  { key: "chicle", sku: "BOD-CHU-001", name: "Chicle Trident menta", categoryKey: "chucherias", salePriceRef: 1.2, currentCostRef: 0.7, minStock: 20 },
  { key: "oreo", sku: "BOD-CHU-002", name: "Galletas Oreo 12u", categoryKey: "chucherias", salePriceRef: 3.5, currentCostRef: 2.4, minStock: 15 },
  { key: "mms", sku: "BOD-CHU-003", name: "M&M chocolate 45g", categoryKey: "chucherias", salePriceRef: 2.8, currentCostRef: 1.9, minStock: 18 },
  { key: "golitas", sku: "BOD-CHU-004", name: "Golitas surtidas 80g", categoryKey: "chucherias", salePriceRef: 1.5, currentCostRef: 0.9, minStock: 25 },
  { key: "choc_nestle", sku: "BOD-CHU-005", name: "Chocolate Nestlé 25g", categoryKey: "chucherias", salePriceRef: 1.8, currentCostRef: 1.1, minStock: 30 },
  { key: "coca", sku: "BOD-REF-001", name: "Coca-Cola 1.5L", categoryKey: "refrescos", salePriceRef: 2.5, currentCostRef: 1.6, minStock: 24 },
  { key: "pepsi_lata", sku: "BOD-REF-002", name: "Pepsi lata 355ml", categoryKey: "refrescos", salePriceRef: 1.2, currentCostRef: 0.75, minStock: 48 },
  { key: "sprite", sku: "BOD-REF-003", name: "Sprite 2L", categoryKey: "refrescos", salePriceRef: 2.3, currentCostRef: 1.5, minStock: 20 },
  { key: "malta", sku: "BOD-REF-004", name: "Malta Polar 1.5L", categoryKey: "refrescos", salePriceRef: 2.0, currentCostRef: 1.3, minStock: 18 },
  { key: "nestea", sku: "BOD-REF-005", name: "Jugo Nestea durazno 1L", categoryKey: "refrescos", salePriceRef: 2.1, currentCostRef: 1.4, minStock: 16 },
  { key: "paleta", sku: "BOD-HEL-001", name: "Paleta Frutix", categoryKey: "helados", salePriceRef: 0.8, currentCostRef: 0.45, minStock: 40 },
  { key: "helado_pote", sku: "BOD-HEL-002", name: "Helado Nestlé pote 1L", categoryKey: "helados", salePriceRef: 5.5, currentCostRef: 3.8, minStock: 12 },
  { key: "bombon", sku: "BOD-HEL-003", name: "Bombón chocolate", categoryKey: "helados", salePriceRef: 1.0, currentCostRef: 0.55, minStock: 35 },
  { key: "papas", sku: "BOD-SNK-001", name: "Papas Lay's clásicas", categoryKey: "snacks", salePriceRef: 2.2, currentCostRef: 1.5, minStock: 20 },
  { key: "doritos", sku: "BOD-SNK-002", name: "Doritos nacho 150g", categoryKey: "snacks", salePriceRef: 2.8, currentCostRef: 1.9, minStock: 18 },
  { key: "ritz", sku: "BOD-SNK-003", name: "Galletas Ritz 200g", categoryKey: "snacks", salePriceRef: 2.5, currentCostRef: 1.7, minStock: 15 },
  { key: "arroz", sku: "BOD-DGR-001", name: "Arroz Mary 1kg", categoryKey: "despensa_granos", salePriceRef: 1.8, currentCostRef: 1.2, minStock: 30 },
  { key: "pasta", sku: "BOD-DGR-002", name: "Pasta Primor 500g", categoryKey: "despensa_granos", salePriceRef: 1.2, currentCostRef: 0.8, minStock: 35 },
  { key: "lentejas", sku: "BOD-DGR-003", name: "Lentejas 500g", categoryKey: "despensa_granos", salePriceRef: 1.5, currentCostRef: 1.0, minStock: 20 },
  { key: "harina", sku: "BOD-DHA-001", name: "Harina PAN 1kg", categoryKey: "despensa_harinas", salePriceRef: 1.6, currentCostRef: 1.1, minStock: 40 },
  { key: "aceite", sku: "BOD-DHA-002", name: "Aceite Mazeite 900ml", categoryKey: "despensa_harinas", salePriceRef: 4.5, currentCostRef: 3.2, minStock: 25 },
  { key: "azucar", sku: "BOD-DHA-003", name: "Azúcar Montalban 1kg", categoryKey: "despensa_harinas", salePriceRef: 1.4, currentCostRef: 0.95, minStock: 28 },
  { key: "sal", sku: "BOD-DHA-004", name: "Sal Refisal 1kg", categoryKey: "despensa_harinas", salePriceRef: 0.9, currentCostRef: 0.5, minStock: 30 },
  { key: "leche", sku: "BOD-LAC-001", name: "Leche entera 1L", categoryKey: "lacteos", salePriceRef: 1.9, currentCostRef: 1.3, minStock: 24 },
  { key: "queso", sku: "BOD-LAC-002", name: "Queso rallado 200g", categoryKey: "lacteos", salePriceRef: 3.2, currentCostRef: 2.2, minStock: 15 },
  { key: "huevos", sku: "BOD-LAC-003", name: "Huevos cartón 30u", categoryKey: "lacteos", salePriceRef: 6.5, currentCostRef: 5.0, minStock: 10 },
  { key: "detergente", sku: "BOD-LIM-001", name: "Detergente Ace 1kg", categoryKey: "limpieza", salePriceRef: 3.8, currentCostRef: 2.6, minStock: 12 },
  { key: "jabon", sku: "BOD-LIM-002", name: "Jabón Protex 110g", categoryKey: "limpieza", salePriceRef: 1.5, currentCostRef: 1.0, minStock: 20 },
  { key: "cloro", sku: "BOD-LIM-003", name: "Cloro Blanquita 1L", categoryKey: "limpieza", salePriceRef: 1.8, currentCostRef: 1.2, minStock: 18 },
  { key: "discard", sku: "BOD-DISC-001", name: "Producto descarte E2E", categoryKey: "limpieza", salePriceRef: 0.5, currentCostRef: 0.3, minStock: 5 },
];

export const SUPPLIERS: ContactSeed[] = [
  { key: "prov_snacks", name: "Distribuidora Snacks C.A.", type: "proveedor", phone: "04141234567", taxId: "J-30123456-1" },
  { key: "prov_refrescos", name: "Refrescos del Valle", type: "proveedor", phone: "04142345678", taxId: "J-30234567-2" },
  { key: "prov_despensa", name: "Despensa Mayorista", type: "proveedor", phone: "04143456789", taxId: "J-30345678-3" },
  { key: "prov_helados", name: "Helados Frío", type: "proveedor", phone: "04144567890", taxId: "J-30456789-4" },
  { key: "prov_mix", name: "Mix Bodegón", type: "proveedor", phone: "04145678901", taxId: "J-30567890-5" },
];

export const CUSTOMERS: ContactSeed[] = [
  { key: "cli_maria", name: "María González", type: "cliente", phone: "04241234567" },
  { key: "cli_jose", name: "José Pérez", type: "cliente", phone: "04242345678" },
  { key: "cli_ana", name: "Ana Rodríguez", type: "cliente", phone: "04243456789", taxId: "V-12345678" },
  { key: "cli_luis", name: "Luis Martínez", type: "cliente", phone: "04244567890" },
  { key: "cli_carmen", name: "Carmen López", type: "cliente", phone: "04245678901", taxId: "V-87654321" },
  { key: "cli_pedro", name: "Pedro Sánchez", type: "cliente", phone: "04246789012" },
  { key: "cli_laura", name: "Laura Díaz", type: "cliente", phone: "04247890123" },
  { key: "cli_roberto", name: "Roberto Herrera", type: "cliente", phone: "04248901234" },
];

export const CONTACT_BOTH: ContactSeed = {
  key: "cli_prov_ambos",
  name: "Mini Market La Esquina",
  type: "ambos",
  phone: "04249012345",
  taxId: "J-39999999-9",
};

/** Product keys to load initial stock (subset). */
export const INVENTORY_INITIAL_KEYS = [
  "chicle",
  "oreo",
  "coca",
  "pepsi_lata",
  "paleta",
  "papas",
  "arroz",
  "pasta",
  "harina",
  "aceite",
  "leche",
  "detergente",
  "mms",
  "sprite",
  "helado_pote",
  "doritos",
  "azucar",
  "queso",
];

export const INVENTORY_INITIAL_QTY: Record<string, number> = {
  chicle: 100,
  oreo: 40,
  coca: 48,
  pepsi_lata: 96,
  paleta: 120,
  papas: 36,
  arroz: 80,
  pasta: 60,
  harina: 100,
  aceite: 50,
  leche: 48,
  detergente: 24,
  mms: 60,
  sprite: 30,
  helado_pote: 20,
  doritos: 28,
  azucar: 45,
  queso: 22,
};

export const SUPPLIER_PRODUCT_LINKS: Array<{
  productKey: string;
  supplierKey: string;
  supplierSku: string;
  lastCostRef: number;
}> = [
  { productKey: "oreo", supplierKey: "prov_snacks", supplierSku: "SNK-OREO", lastCostRef: 2.4 },
  { productKey: "papas", supplierKey: "prov_snacks", supplierSku: "SNK-PAPAS", lastCostRef: 1.5 },
  { productKey: "coca", supplierKey: "prov_refrescos", supplierSku: "REF-COCA15", lastCostRef: 1.6 },
  { productKey: "pepsi_lata", supplierKey: "prov_refrescos", supplierSku: "REF-PEPSI355", lastCostRef: 0.75 },
  { productKey: "arroz", supplierKey: "prov_despensa", supplierSku: "DES-ARROZ1K", lastCostRef: 1.2 },
  { productKey: "pasta", supplierKey: "prov_despensa", supplierSku: "DES-PASTA500", lastCostRef: 0.8 },
  { productKey: "harina", supplierKey: "prov_despensa", supplierSku: "DES-HARINA1K", lastCostRef: 1.1 },
  { productKey: "aceite", supplierKey: "prov_despensa", supplierSku: "DES-ACEITE900", lastCostRef: 3.2 },
  { productKey: "paleta", supplierKey: "prov_helados", supplierSku: "HEL-PALETA", lastCostRef: 0.45 },
  { productKey: "helado_pote", supplierKey: "prov_helados", supplierSku: "HEL-POTE1L", lastCostRef: 3.8 },
  { productKey: "leche", supplierKey: "prov_mix", supplierSku: "MIX-LECHE1L", lastCostRef: 1.3 },
  { productKey: "detergente", supplierKey: "prov_mix", supplierSku: "MIX-DETER1K", lastCostRef: 2.6 },
  { productKey: "chicle", supplierKey: "prov_snacks", supplierSku: "SNK-CHICLE", lastCostRef: 0.7 },
  { productKey: "mms", supplierKey: "prov_snacks", supplierSku: "SNK-MMS", lastCostRef: 1.9 },
  { productKey: "malta", supplierKey: "prov_refrescos", supplierSku: "REF-MALTA15", lastCostRef: 1.3 },
];
