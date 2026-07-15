const {
  buildProductSku,
  cleanProductName,
} = require('../chocomayor/product-name-utils');

/** Detecta empaques en descripciones Ferrera (24X900GRS, 12UNDX600cc, 1PAQX8, …) */
const FERRERA_PACK_REGEX =
  /(?:(\d+)\s*PAQX\s*(\d+))|(?:(\d+)\s*[xX*]\s*(?:\d+(?:[.,]\d+)?(?:\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CC|cc|litros?)?)?|\d+\s*CART\b))|(?:(\d+)\s*UND\s*[xX*]\s*(?:\d+(?:[.,]\d+)?(?:\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CC|cc|m)?)?))|(?:(\d+)UND\s*[xX*]\s*(?:\d+(?:[.,]\d+)?(?:\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CC|cc|m)?)?))|(?:(\d+)\s*(?:UND|UNID|UNDS|PAQ|PACK|und|TACO|TACOS|CART))\b/i;

function parseDecimalToken(token) {
  const normalized = token.replace(/\./g, '').replace(',', '.');
  return parseFloat(normalized);
}

function parseDataLine(line) {
  const trimmed = line.trim();
  if (!trimmed || /^item\s+codigo/i.test(trimmed)) return null;

  let body = trimmed;
  let existencia = null;
  let precioRef = null;

  const twoPrices = trimmed.match(
    /^(.+?)\s+(\d{1,3}(?:\.\d{3})*|\d+),\d{2}\s+(\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/,
  );
  if (twoPrices) {
    body = twoPrices[1];
    existencia = parseDecimalToken(twoPrices[2]);
    precioRef = parseDecimalToken(twoPrices[3]);
  } else {
    const onePrice = trimmed.match(/^(.+?)\s+(\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/);
    if (!onePrice) return null;
    body = onePrice[1];
    precioRef = parseDecimalToken(onePrice[2]);
  }

  const withCode = body.match(/^(\d{6})\s+(\d+)\s+(.+)$/);
  if (withCode) {
    return {
      codigo_proveedor: withCode[1],
      description: withCode[3].trim(),
      existencia,
      item: Number(withCode[2]),
      precio_ref: precioRef,
    };
  }

  const withoutCode = body.match(/^(\d+)\s+(.+)$/);
  if (withoutCode) {
    return {
      codigo_proveedor: null,
      description: withoutCode[2].trim(),
      existencia,
      item: Number(withoutCode[1]),
      precio_ref: precioRef,
    };
  }

  return null;
}

function detectPack(description) {
  const descLower = description.toLowerCase();

  const paqMatch = description.match(/(\d+)\s*PAQX\s*(\d+)/i);
  if (paqMatch) {
    const unitsPerPack = parseInt(paqMatch[2], 10);
    if (unitsPerPack > 1) {
      return { packageType: 'Paquete', purchaseMode: 'pack', unitsPerPack };
    }
  }

  const packMatch = description.match(FERRERA_PACK_REGEX);
  if (packMatch) {
    const unitsPerPack = parseInt(
      packMatch[2] || packMatch[3] || packMatch[4] || packMatch[5] || packMatch[6] || '1',
      10,
    );

    if (unitsPerPack > 1) {
      let packageType = 'Paquete';
      if (descLower.includes('bolsa')) packageType = 'Bolsa';
      else if (descLower.includes('display')) packageType = 'Display';
      else if (descLower.includes('ristra') || descLower.includes('tira')) packageType = 'Ristra';
      else if (descLower.includes('caja') || descLower.includes('cart')) packageType = 'Caja';

      return { packageType, purchaseMode: 'pack', unitsPerPack };
    }
  }

  return { packageType: 'Unidad', purchaseMode: 'unit', unitsPerPack: 1 };
}

function cleanFerreraProductName(description) {
  let name = description.trim();
  name = name.replace(/^\d+\s*UND\s+/i, '');
  name = name.replace(/\b\d+\s*PAQX\s*\d+\b/gi, ' ');
  name = name.replace(/\b1\s*UND\s*[xX*]\s*(?=\d)/gi, '');
  name = name.replace(
    /\b\d+\s*[xX*]\s*(?=\d+(?:[.,]\d+)?(?:\s*(?:GRS?|G|ML|LTS?|LT|KG|KGR|CM|CC|cc|litros?)?)?)/gi,
    '',
  );
  name = name.replace(/\b\d+\s*UND\s*[xX*]\s*(?=\d)/gi, '');
  name = name.replace(/\b\d+\s*UND\b/gi, ' ');
  return cleanProductName(name);
}

function buildPackLabel(packageType, unitsPerPack) {
  if (unitsPerPack <= 1) return 'Unidad';
  return `${packageType} ${unitsPerPack} und`;
}

module.exports = {
  buildPackLabel,
  buildProductSku,
  cleanFerreraProductName,
  detectPack,
  parseDataLine,
};
