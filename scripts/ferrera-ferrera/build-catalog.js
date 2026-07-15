const fs = require('fs');
const path = require('path');

const { categorizeProduct } = require('../chocomayor/category-utils');
const {
  buildProductSku,
  cleanFerreraProductName,
  detectPack,
  parseDataLine,
} = require('./parse-utils');

const CONFIG = {
  currency: 'REF',
  documentDate: '2026-06-03',
  providerAddress: 'AV. LOS CARMENES CON 3ERA TRANSVERSAL LOCAL 42 N° 1-2',
  providerName: 'COMERCIALIZADORA FERRERA FERRERA, C.A.',
  providerTaxId: 'J-30960611-5',
};

function createEmptyCatalog(extraDocument = {}) {
  return {
    proveedor: {
      direccion: CONFIG.providerAddress,
      nombre: CONFIG.providerName,
      notas: 'Lista mayorista Ferrera Ferrera — importación ERP.',
      rif: CONFIG.providerTaxId,
    },
    documento: {
      archivo: 'raw-data.txt',
      fecha_lista: CONFIG.documentDate,
      moneda: CONFIG.currency,
      ...extraDocument,
    },
    resumen_por_categoria: {
      'Alimentos Básicos': 0,
      Bebidas: 0,
      'Chucherías': 0,
      'Higiene Personal': 0,
      'Limpieza del Hogar': 0,
    },
    resumen_por_modo_compra: { pack: 0, unit: 0 },
    total_items: 0,
    items: [],
    items_incompletos: [],
  };
}

function buildItemRecord(rawLine, parsed, pack) {
  const unitPriceRef =
    pack.purchaseMode === 'pack'
      ? parseFloat((parsed.precio_ref / pack.unitsPerPack).toFixed(2))
      : parsed.precio_ref;

  const { category, confidence } = categorizeProduct(parsed.description);
  const productName = cleanFerreraProductName(parsed.description);
  const skuBase = buildProductSku(productName);
  const sku = parsed.codigo_proveedor ? `${skuBase}-${parsed.codigo_proveedor}` : skuBase;

  return {
    codigo_proveedor: parsed.codigo_proveedor,
    costo_unitario_detal_ref: unitPriceRef,
    categoria: category,
    confianza_categoria: confidence,
    existencia_proveedor: parsed.existencia,
    item: parsed.item,
    linea_original: rawLine.trim(),
    modo_compra: pack.purchaseMode,
    nombre_producto: productName,
    precio_lista_ref: parsed.precio_ref,
    sku_propuesto: sku,
    tipo_empaque: pack.packageType,
    unidades_por_empaque: pack.unitsPerPack,
  };
}

function parseCatalogFromFile(filePath, options = {}) {
  const { packOnly = false } = options;
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const outputData = createEmptyCatalog(
    packOnly ? { filtro_aplicado: 'SOLO EMPAQUES MULTIPLES (PACK)' } : {},
  );

  if (packOnly) {
    outputData.total_items_multiples_extraidos = 0;
  }

  for (const rawLine of lines) {
    const parsed = parseDataLine(rawLine);
    if (!parsed) continue;

    if (parsed.precio_ref == null || parsed.precio_ref <= 0) {
      outputData.items_incompletos.push(rawLine.trim());
      continue;
    }

    const pack = detectPack(parsed.description);
    if (packOnly && pack.purchaseMode !== 'pack') {
      continue;
    }

    const itemRecord = buildItemRecord(rawLine, parsed, pack);

    if (packOnly) {
      itemRecord.precio_empaque_mayor_ref = itemRecord.precio_lista_ref;
      delete itemRecord.precio_lista_ref;
      delete itemRecord.modo_compra;
    }

    outputData.items.push(itemRecord);
    outputData.resumen_por_categoria[itemRecord.categoria]++;
    outputData.resumen_por_modo_compra[pack.purchaseMode]++;
    outputData.total_items++;

    if (packOnly) {
      outputData.total_items_multiples_extraidos++;
    }
  }

  return outputData;
}

function writeCatalog(outputData, outputFile) {
  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf-8');
}

module.exports = {
  CONFIG,
  buildItemRecord,
  createEmptyCatalog,
  parseCatalogFromFile,
  writeCatalog,
};
