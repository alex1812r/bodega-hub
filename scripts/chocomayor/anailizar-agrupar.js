const fs = require('fs');
const path = require('path');

const { categorizeProduct } = require('./category-utils');
const {
  PACK_DETECTION_REGEX,
  buildProductSku,
  cleanProductName,
} = require('./product-name-utils');

// Configuración del sistema
const CONFIG = {
  currency: 'REF',
  providerName: 'Chocomayor',
  providerAddress: 'Quinta Crespo. Calle Del Loro. Diagonal al Páramo',
  documentDate: '2026-06-03',
};

const OUTPUT_FILE = path.join(__dirname, 'catalogo_packs.json');

function loadOmitirFlags() {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return new Map();
  }

  try {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    const flags = new Map();

    for (const item of existing.items ?? []) {
      if (item.omitir && item.linea_original) {
        flags.set(item.linea_original, true);
      }
    }

    return flags;
  } catch {
    return new Map();
  }
}

function parseCatalogData(filePath) {
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const lines = rawContent.split(/\r?\n/);
  const omitirFlags = loadOmitirFlags();

  const outputData = {
    proveedor: {
      nombre: CONFIG.providerName,
      direccion: CONFIG.providerAddress,
      notas: 'Precios susceptibles a cambio sin previo aviso.',
    },
    documento: {
      fecha_lista: CONFIG.documentDate,
      moneda: CONFIG.currency,
      archivo: 'raw_data.txt',
      filtro_aplicado: 'SOLO EMPAQUES MULTIPLES (PACK)',
    },
    resumen_por_categoria: {
      'Alimentos Básicos': 0,
      Bebidas: 0,
      'Chucherías': 0,
      'Higiene Personal': 0,
      'Limpieza del Hogar': 0,
    },
    total_items_multiples_extraidos: 0,
    items: [],
    items_incompletos: [],
  };

  const lineRegex = /^(\d+,\d{2})\s+(.+)$/;
  let pendingLine = '';

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\\s*/g, '').trim();
    if (!line) return;

    if (!line.match(/^\d+,\d{2}/)) {
      pendingLine += ` ${line}`;
      return;
    }

    if (pendingLine) {
      processLine(pendingLine, outputData, lineRegex, omitirFlags);
    }
    pendingLine = line;
  });

  if (pendingLine) {
    processLine(pendingLine, outputData, lineRegex, omitirFlags);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(
    `¡Éxito! Se filtraron y procesaron ${outputData.total_items_multiples_extraidos} productos (SOLO EMPAQUES MÚLTIPLES). Archivo guardado como catalogo_packs.json`,
  );
}

function processLine(line, outputData, lineRegex, omitirFlags) {
  const match = line.match(lineRegex);
  if (!match) return;

  const rawPrice = match[1].replace(',', '.');
  const packPriceRef = parseFloat(rawPrice);
  const description = match[2].trim();

  let purchaseMode = 'unit';
  let unitsPerPack = 1;
  let unitPriceRef = packPriceRef;
  let packageType = 'Unidad';

  const packMatch = description.match(PACK_DETECTION_REGEX);
  if (packMatch) {
    unitsPerPack = parseInt(packMatch[1] || packMatch[2], 10);

    if (unitsPerPack > 1) {
      purchaseMode = 'pack';
      unitPriceRef = parseFloat((packPriceRef / unitsPerPack).toFixed(2));

      const descLower = description.toLowerCase();
      if (descLower.includes('bolsa')) packageType = 'Bolsa';
      else if (descLower.includes('display')) packageType = 'Display';
      else if (descLower.includes('ristra') || descLower.includes('tira')) packageType = 'Ristra';
      else if (descLower.includes('caja')) packageType = 'Caja';
      else packageType = 'Paquete';
    }
  }

  if (purchaseMode !== 'pack') {
    return;
  }

  if (packPriceRef === 0) {
    outputData.items_incompletos.push(description);
    return;
  }

  const { category, confidence: categoryConfidence } = categorizeProduct(description);

  const productName = cleanProductName(description);
  const proposedSku = buildProductSku(productName);

  const itemRecord = {
    linea_original: line,
    nombre_producto: productName,
    categoria: category,
    confianza_categoria: categoryConfidence,
    sku_propuesto: proposedSku,
    tipo_empaque: packageType,
    unidades_por_empaque: unitsPerPack,
    precio_empaque_mayor_ref: packPriceRef,
    costo_unitario_detal_ref: unitPriceRef,
    datos_faltantes: [],
  };

  if (omitirFlags.get(line)) {
    itemRecord.omitir = true;
  }

  outputData.items.push(itemRecord);
  outputData.resumen_por_categoria[category]++;
  outputData.total_items_multiples_extraidos++;
}

parseCatalogData(path.join(__dirname, 'raw_data.txt'));
