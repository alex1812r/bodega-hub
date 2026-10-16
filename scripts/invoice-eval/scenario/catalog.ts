/**
 * Catálogo del escenario "Bodega Banco Facturas (eval)" (SCN-10f; plan
 * factura-escaneo-gtm §5.4 SCN-10).
 *
 * Es lo que la tienda tendría registrado ANTES de escanear las 32 facturas del
 * banco: productos con el nombre que teclearía el dueño (no el texto de la
 * factura), categorías con su alícuota, proveedores con el RIF como lo guarda
 * la tienda, vínculos proveedor-producto, empaques del proveedor y una receta.
 * El último costo y las tasas salen de las verdades (`plan.ts`).
 *
 * Reglas (ver `README.md`):
 * - toda `productKey` de `truth/*.json` está aquí, en catálogo o fuera
 *   (`inCatalog: false`, ~10 %, para medir "sin emparejar" correcto);
 * - toda `supplierKey` de las verdades tiene proveedor;
 * - SIN alias sembrados: el runner los simula en memoria.
 */

export const SCENARIO_STORE_SLUG = "eval-facturas";
export const SCENARIO_STORE_NAME = "Bodega Banco Facturas (eval)";

/** Usuario admin del escenario: la RPC de candidatos exige sesión con perfil activo (assert_store_context). */
export const SCENARIO_USER_EMAIL = "eval-facturas-admin@eval.local";
export const SCENARIO_USER_PASSWORD = "EvalFacturas2026!";
export const SCENARIO_USER_NAME = "Dueño Banco Facturas";

export type ScenarioTaxCode = "exento" | "general";

export type ScenarioCategory = { key: string; name: string; taxCode: ScenarioTaxCode; pct: 0 | 16 };

export const SCENARIO_CATEGORIES: readonly ScenarioCategory[] = [
  { key: "bebidas", name: "Refrescos y bebidas", taxCode: "general", pct: 16 },
  { key: "licores", name: "Licores y cervezas", taxCode: "general", pct: 16 },
  { key: "viveres", name: "Víveres", taxCode: "exento", pct: 0 },
  { key: "enlatados", name: "Enlatados, salsas y aliños", taxCode: "general", pct: 16 },
  { key: "chucherias", name: "Chucherías y galletas", taxCode: "general", pct: 16 },
  { key: "limpieza", name: "Limpieza", taxCode: "general", pct: 16 },
  { key: "cuidado", name: "Cuidado personal", taxCode: "general", pct: 16 },
  { key: "insumos", name: "Insumos del negocio", taxCode: "general", pct: 16 },
];

export type ScenarioProduct = {
  /** productKey de las verdades. */
  key: string;
  /** Nombre como lo teclearía el dueño. */
  name: string;
  categoryKey: string;
  inCatalog: boolean;
  /** EAN guardado en `products.barcode` (los de Mayorista Los Andes). */
  barcode?: string;
  /**
   * Las facturas no dicen cuántas unidades trae el empaque (f04 "sin tamaño
   * impreso"): no hay costo por unidad fiable y no se siembra compra.
   */
  costUnknown?: boolean;
};

const P = (
  key: string,
  name: string,
  categoryKey: string,
  extra: Partial<Omit<ScenarioProduct, "key" | "name" | "categoryKey">> = {},
): ScenarioProduct => ({ key, name, categoryKey, inCatalog: true, ...extra });

const OUT = (key: string, name: string, categoryKey: string): ScenarioProduct => ({
  key,
  name,
  categoryKey,
  inCatalog: false,
});

export const SCENARIO_PRODUCTS: readonly ScenarioProduct[] = [
  // Refrescos y bebidas (gravados 16 %)
  P("glup-cola-2l", "Glup Cola 2 Lt", "bebidas", { barcode: "7593102001011" }),
  P("glup-sabores-2l", "Glup Sabores 2 Lt", "bebidas"),
  P("glup-cola-1l", "Glup Cola 1 Lt", "bebidas"),
  P("glup-sabores-1l", "Glup Sabores 1 Lt", "bebidas"),
  P("coca-cola-2l", "Coca Cola 2L", "bebidas", { barcode: "7592711002044" }),
  P("coca-cola-1l", "Coca Cola 1L", "bebidas"),
  P("justy-1.5l", "Justy 1,5 Lt", "bebidas", { barcode: "7593102004159" }),
  P("justy-400ml", "Justy pequeño 400 ml", "bebidas"),
  P("power-max-400ml", "Power Max 400 ml", "bebidas"),
  P("agua-heleal-1.5l", "Agua Heleal 1,5 L", "bebidas", { barcode: "7598456001502" }),
  P("malta-polar-1.5l", "Malta Polar 1.5L", "bebidas"),
  P("fanta-2l", "Fanta Naranja 2L", "bebidas"),
  OUT("gatorade", "Gatorade", "bebidas"),
  // Licores y cervezas
  P("anis-cartujo", "Anís Cartujo", "licores"),
  P("gran-reserva-0.70l", "Ron Gran Reserva 0,70", "licores"),
  P("malport-t-1.75l", "Malport 1.75 L", "licores"),
  P("polar-pilsen-222ml", "Polar Pilsen 222ml", "licores"),
  P("solera-azul-light-222ml", "Solera Light 222ml", "licores"),
  OUT("char-dula-demi", "Char Dula demi", "licores"),
  OUT("tobo-14-promo", "Tobo 14 promo", "licores"),
  // Víveres exentos (las facturas los marcan (E) / exento)
  P("harina-pan-1kg", "Harina P.A.N. 1 Kg", "viveres", { barcode: "7591002100018" }),
  P("harina-maiz-mary-900g", "Harina Mary 900g", "viveres"),
  P("pasta-horizonte-corta-1kg", "Pasta Horizonte corta 1 Kg", "viveres"),
  P("azucar-mimasa-900g", "Azúcar Mimasa 900g", "viveres", { barcode: "7594127009006" }),
  P("azucar-montalban-refinada-1kg", "Azúcar Montalbán 1 Kg", "viveres"),
  P("arroz-primor-1kg", "Arroz Primor 1 Kg", "viveres", { barcode: "7591002300104" }),
  P("arroz-mary-premium-900g", "Arroz Mary Premium 900g", "viveres"),
  P("mantequilla-mavesa-250g", "Mantequilla Mavesa 250g", "viveres"),
  P("mantequilla-mavesa-500g", "Mantequilla Mavesa 500g", "viveres"),
  P("aceite-soya-pampa-500ml", "Aceite La Pampa 500 ml", "viveres"),
  P("aceite-soya-pampa-700ml", "Aceite La Pampa 700 ml", "viveres"),
  P("leche-condensada-cremor-395g", "Leche condensada Cremor", "viveres"),
  P("leche-dobon-200g", "Leche en polvo Dobon 200g", "viveres"),
  P("sardina-willinger-155g", "Sardina Willinger 155g", "viveres"),
  P("cafe-san-domingo-200g", "Café San Domingo 200g", "viveres"),
  P("cafe-fama-de-america-200g", "Café Fama de América 200g", "viveres"),
  P("avena-hojuelas-maizalito-400g", "Avena El Maizalito 400g", "viveres"),
  P("mayonesa-mavesa-445g", "Mayonesa Mavesa 445 gr", "viveres", { costUnknown: true }),
  // Enlatados, salsas y aliños (gravados)
  P("atun-margarita-140g", "Atún Margarita 140g", "enlatados", { barcode: "7596220014086" }),
  P("atun-willinger-aceite-170g", "Atún Willinger 170g", "enlatados"),
  P("sardina-marbonita-170g", "Sardina Marbonita 170g", "enlatados"),
  P("sardinas-la-gaviota-170g", "Sardinas La Gaviota 170g", "enlatados", { barcode: "7596803017053" }),
  P("guisantes-verdes-laila-400g", "Guisantes Laila 400g", "enlatados"),
  P("diablito-underwood-54g", "Diablito Underwood 54g", "enlatados"),
  P("pampero-ketchup-397g", "Salsa de tomate Pampero 397 gr", "enlatados", { costUnknown: true }),
  P("salsa-espaguetis-gut-34g", "Salsa espagueti Gut", "enlatados"),
  P("colorante-amparito-gut-20g", "Colorante Amparito", "enlatados"),
  P("adobo-completo-gut-24g", "Adobo Gut completo", "enlatados"),
  // Chucherías y galletas
  P("doritos-flamin-hot-140g", "Doritos Flamin Hot 140g", "chucherias", { costUnknown: true }),
  P("doritos-150g", "Doritos queso 150g", "chucherias"),
  P("doritos-dinamita-flamin-40g", "Doritos Dinamita 40g", "chucherias"),
  P("doritos-cool-ranch-42g", "Doritos Cool Ranch 42g", "chucherias"),
  P("cheese-tris-50g", "Cheese Tris pequeño 50g", "chucherias"),
  P("cheese-tris-150g", "Cheese Tris 150g", "chucherias"),
  P("flips-chocolate-120g", "Flips chocolate 120g", "chucherias"),
  P("flips-dulce-leche-120g", "Flips dulce de leche 120g", "chucherias"),
  P("flips-chocolate-28g", "Flips lonchera chocolate", "chucherias"),
  P("flips-dulce-leche-28g", "Flips lonchera dulce de leche", "chucherias"),
  P("palitos-choco", "Palitos Choco", "chucherias"),
  P("caramelo-menta-helada-super", "Caramelo menta helada", "chucherias"),
  P("papas-rizadas-yupi-pollo-130g", "Yupi papas rizadas pollo", "chucherias"),
  P("ruffles-crema-cebolla-122g", "Ruffles cebolla 122g", "chucherias"),
  P("ruffles-queso-125g", "Ruffles queso 125g", "chucherias"),
  P("toston-tom-80g", "Tostón Tom 80g", "chucherias"),
  P("papa-rayada-bbq-105g", "Papas Rayadas BBQ", "chucherias"),
  P("papa-rayada-pollo-105g", "Papas Rayadas pollo", "chucherias"),
  P("galleta-maxcoco-460g", "Galletas Maxcoco 460g", "chucherias"),
  P("galletas-coqui-luna-limon-150g", "Galleta Coquí Luna limón", "chucherias"),
  P("galletas-crakenas-192g", "Crakenas 192g", "chucherias"),
  P("munchy-ringos-62g", "Ringos 62g", "chucherias"),
  P("samy-11g", "Samy", "chucherias"),
  P("samba-fresa-16g", "Samba mini fresa", "chucherias"),
  P("samba-fresa-32g", "Samba fresa 32g", "chucherias"),
  P("mini-savoy-leche-150g", "Savoy mini bolsa 150g", "chucherias"),
  P("tortillitas-jacks-queso-picante-190g", "Tortillitas Jacks 190g", "chucherias"),
  OUT("de-todito-resuelto-110g", "De Todito Resuelto 110g", "chucherias"),
  OUT("chimo-tigrito-amarillo", "Chimó Tigrito", "chucherias"),
  // Limpieza
  P("detergente-alive-floral-500g", "Detergente Alive Floral 500g", "limpieza"),
  P("detergente-alive-suavizante-rosado-500g", "Detergente Alive rosado 500g", "limpieza"),
  P("desinfectante-oso-blanco-1l", "Desinfectante Oso Blanco 1L", "limpieza"),
  P("cloro-oso-blanco-1l", "Cloro Oso Blanco 1L", "limpieza"),
  P("lavaplatos-axion-crema-235g", "Axion crema 235g", "limpieza"),
  P("suavizante-alive-lavanda-200ml", "Suavizante Alive lavanda 200ml", "limpieza"),
  OUT("aromax-lavanda-10g", "Aromax lavanda", "limpieza"),
  OUT("jabon-azul-las-llaves-300g", "Jabón azul Las Llaves", "limpieza"),
  // Cuidado personal
  P("toallas-humedas-baby-finger-50und", "Toallitas húmedas Baby Finger", "cuidado"),
  P("crema-dental-colgate-triple-accion-60ml", "Colgate Triple Acción 60ml", "cuidado"),
  P("protector-diario-alive-20und", "Protectores Alive x20", "cuidado"),
  // Insumos del negocio: no son mercancía de venta, fuera de catálogo.
  OUT("insumo-bolsa-maracay-5kg", "Bolsa 5 kg", "insumos"),
  OUT("insumo-bolsa-maracay-10kg", "Bolsa 10 kg", "insumos"),
  OUT("insumo-cinta-embalar", "Cinta de embalar", "insumos"),
];

export type ScenarioPackUnit = { label: string; unitsPerPack: number };

export type ScenarioLink = {
  productKey: string;
  supplierSku?: string;
  isPreferred?: boolean;
  packUnit?: ScenarioPackUnit;
};

export type ScenarioSupplier = {
  /** supplierKey de las verdades. */
  key: string;
  /** Nombre como lo guardaría la tienda. */
  name: string;
  /** RIF con el formato de la tienda; mismos dígitos que la verdad. null si la verdad no lo trae. */
  taxId: string | null;
  /** Vínculos supplier_products sembrados (vacío = proveedor sin catálogo). */
  links: readonly ScenarioLink[];
  /** Las compras históricas de sus productos se le atribuyen a él (sus vínculos ya existen). */
  purchasesFromHere: boolean;
};

const BULTO6: ScenarioPackUnit = { label: "BULTO X 6", unitsPerPack: 6 };
const BULTO12: ScenarioPackUnit = { label: "BULTO X 12", unitsPerPack: 12 };
const BULTO15: ScenarioPackUnit = { label: "BULTO X 15", unitsPerPack: 15 };
const CAJA15: ScenarioPackUnit = { label: "CAJA X 15", unitsPerPack: 15 };

export const SCENARIO_SUPPLIERS: readonly ScenarioSupplier[] = [
  {
    key: "chevere-depot",
    name: "Chevere Depot",
    taxId: "J-50835761-2",
    purchasesFromHere: true,
    // Habitual de sus refrescos. Unos empaques registrados, otros no; glup-cola-2l
    // va por receta (bulto x6) y no por empaque del proveedor.
    links: [
      { productKey: "glup-cola-2l", isPreferred: true },
      { productKey: "glup-sabores-2l", isPreferred: true, packUnit: BULTO6 },
      { productKey: "glup-cola-1l", isPreferred: true },
      { productKey: "glup-sabores-1l", isPreferred: true },
      { productKey: "coca-cola-2l", isPreferred: true, packUnit: BULTO6 },
      { productKey: "coca-cola-1l", isPreferred: true },
      { productKey: "justy-1.5l", isPreferred: true, packUnit: BULTO12 },
      { productKey: "justy-400ml", isPreferred: true, packUnit: BULTO15 },
      { productKey: "power-max-400ml", isPreferred: true, packUnit: CAJA15 },
      { productKey: "agua-heleal-1.5l", isPreferred: true },
      { productKey: "malta-polar-1.5l", isPreferred: true },
      { productKey: "fanta-2l", isPreferred: true },
    ],
  },
  {
    key: "mercaseu-2030",
    name: "Mercaseu 2030",
    taxId: "J-50604031-0",
    purchasesFromHere: true,
    links: [
      { productKey: "glup-sabores-2l" },
      { productKey: "harina-pan-1kg" },
      { productKey: "harina-maiz-mary-900g" },
      { productKey: "pasta-horizonte-corta-1kg" },
      { productKey: "azucar-mimasa-900g" },
      { productKey: "mantequilla-mavesa-250g" },
      { productKey: "aceite-soya-pampa-500ml" },
      { productKey: "galletas-coqui-luna-limon-150g" },
      { productKey: "guisantes-verdes-laila-400g" },
      { productKey: "diablito-underwood-54g" },
      { productKey: "cafe-san-domingo-200g" },
      { productKey: "sardina-marbonita-170g" },
      { productKey: "salsa-espaguetis-gut-34g" },
      { productKey: "colorante-amparito-gut-20g" },
      { productKey: "adobo-completo-gut-24g" },
      { productKey: "avena-hojuelas-maizalito-400g" },
      { productKey: "toallas-humedas-baby-finger-50und" },
      { productKey: "suavizante-alive-lavanda-200ml" },
      { productKey: "crema-dental-colgate-triple-accion-60ml" },
      { productKey: "protector-diario-alive-20und" },
    ],
  },
  { key: "hiperconfi-66", name: "Hiperconfi 66", taxId: "J-50529551-9", purchasesFromHere: false, links: [] },
  { key: "cocktail-express-247", name: "Cocktail Express 247", taxId: "J-41310615-9", purchasesFromHere: false, links: [] },
  { key: "market-catia", name: "Market Catia", taxId: "J-50024415-0", purchasesFromHere: false, links: [] },
  { key: "las-acacias", name: "Abastos Las Acacias", taxId: "J-00265811-8", purchasesFromHere: false, links: [] },
  { key: "cosas-principales", name: "Cosas Principales", taxId: "J-50249531-2", purchasesFromHere: false, links: [] },
  { key: "farmatodo", name: "Farmatodo", taxId: null, purchasesFromHere: false, links: [] },
  { key: "confiplast-jld", name: "Confiplast JLD", taxId: "J-50241072-4", purchasesFromHere: false, links: [] },
  {
    key: "sint-dist-el-saman",
    name: "Distribuidora El Samán",
    taxId: "J-41258736-0",
    purchasesFromHere: true,
    // Vinculado con el código SM-xxxxx que imprime en sus facturas.
    links: [
      { productKey: "glup-cola-2l", supplierSku: "SM-01045" },
      { productKey: "glup-sabores-2l", supplierSku: "SM-01046" },
      { productKey: "coca-cola-2l", supplierSku: "SM-01120" },
      { productKey: "coca-cola-1l", supplierSku: "SM-01121" },
      { productKey: "malta-polar-1.5l", supplierSku: "SM-01210" },
      { productKey: "justy-1.5l", supplierSku: "SM-01305" },
      { productKey: "harina-pan-1kg", supplierSku: "SM-02001" },
      { productKey: "harina-maiz-mary-900g", supplierSku: "SM-02003" },
      { productKey: "arroz-primor-1kg", supplierSku: "SM-02210" },
      { productKey: "pasta-horizonte-corta-1kg", supplierSku: "SM-02305" },
      { productKey: "azucar-mimasa-900g", supplierSku: "SM-02402" },
      { productKey: "aceite-soya-pampa-500ml", supplierSku: "SM-02510" },
      { productKey: "mantequilla-mavesa-250g", supplierSku: "SM-02620" },
      { productKey: "cafe-fama-de-america-200g", supplierSku: "SM-02750" },
      { productKey: "atun-margarita-140g", supplierSku: "SM-03410" },
      { productKey: "sardinas-la-gaviota-170g", supplierSku: "SM-03415" },
    ],
  },
  // Reconocible por el EAN de sus líneas (products.barcode), sin catálogo propio.
  { key: "sint-mayorista-los-andes", name: "Mayorista Los Andes", taxId: "J-50473921-6", purchasesFromHere: false, links: [] },
  { key: "sint-viveres-la-ceiba", name: "Víveres La Ceiba", taxId: "J-31765420-9", purchasesFromHere: false, links: [] },
];

/**
 * Proveedor de las compras históricas de productos que la tienda nunca le
 * compró por la app a un proveedor del banco. No es supplierKey de ninguna
 * verdad; nombre elegido para no parecerse (trigram) a ninguno del banco.
 */
export const HISTORY_SUPPLIER = { name: "Compras varias (histórico)", taxId: null } as const;

export type ScenarioRecipe = {
  /** SKU y nombre del producto EMPAQUE (no es productKey de ninguna verdad). */
  packSku: string;
  packName: string;
  unitKey: string;
  unitsPerPack: number;
};

/** Receta empaque -> unidad: el bulto de Glup Cola 2 Lt se vende abierto. */
export const SCENARIO_RECIPES: readonly ScenarioRecipe[] = [
  { packSku: "EVF-PACK-001", packName: "Glup Cola 2 Lt bulto x6", unitKey: "glup-cola-2l", unitsPerPack: 6 },
];

/** SKU interno de la tienda para un producto del catálogo (orden de SCENARIO_PRODUCTS). */
export function scenarioSku(index: number): string {
  return `EVF-${String(index + 1).padStart(3, "0")}`;
}

export function inCatalogProducts(): ScenarioProduct[] {
  return SCENARIO_PRODUCTS.filter((product) => product.inCatalog);
}
