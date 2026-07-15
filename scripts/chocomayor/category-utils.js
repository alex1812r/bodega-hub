/**
 * Clasificación de productos Chocomayor según categorías del ERP.
 * Prioridad: Limpieza → Higiene → Chucherías → Bebidas → Alimentos Básicos → Chucherías (default).
 */

function normalizeForCategory(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const CHUCHERIA_PATTERN =
  /caramelo|car\.|\bcar toffee\b|toffee|chicle|chocolate|\bchoco\b|bombon|bon bon|bon-o-bon|galleta|galletas|saltin|crakena|salserito|doritos|cheetos|cheese tris|\bpapas\b|\bpapi\b|chicharron|detodito|marshmallow|barquillo|bocadillo|gomita|paleta|chupeta|\bnunu\b|cafe gurme|goxua|biagi|fruna|oreo|block tableta|block balls|bubbaloo|mentos|trident|sugus|barrilete|barryton|bastones|flips|kesito|chiskesito|puffy|pringles|savoy|bridge|\btableta\b|barquillo|biscolata|belvita|\bbj galleta\b|barkilate|barquillo|bon bon|bombazo|bombonera|car\.|caramele|chao |charmy|chesito|chesitos|chiskesito|coco bay|coco sette|cri cri|detodito|fluff|fruna|gayeton|go xua|goxumel|kinder|lollipop|m&m|mms|nutella|paleton|pirulin|platanitos|pops|ricato|samba|snickers|sparkies|super coco|trio|trululu|turron|turron|yummi|yummy|yogur natural \(pequeno\)/i;

const BEBIDA_PATTERN =
  /\b(agua|jugo|bebida|malta|refresco|gatorade|yogur|yogurt|nectar|nektar|achocolatada)\b|\blipton\b|\bnestea\b|\bschweppes\b|\barizona\b|\bfrescolita\b|\bpepsi\b|\bcoca\b|\bfanta\b|\bmalta\b|\bclight\b|\btang\b|\bsprite\b|\b7up\b|\bred bull\b|\bmonster\b/i;

const TEA_PATTERN = /(?:^|\s)(?:te|té)(?:\s|$)/i;

const ALIMENTO_BASICO_PATTERN =
  /\b(arroz|azucar|avena|harina|levadura|maizina|mayonesa|atun|atún)\b|\baceite\b|\bcafe\s+(?:amanecer|flor|madrid|molido)\b|\bcafe\s+madrid\b|\bcafe\s+flor\b|\bcafe\s+amanecer\b|\bleche\s+(?:entera|descremada|condensada|evaporada|en polvo|upaca|carabobo|natulac|nestle|carnation|maita|tigo|wynco|kaldini|condylac|semidescremada|deslactosada|mi vaca|descremada|condensada)/i;

const LIMPIEZA_PATTERN =
  /\bpila\b|\bvelas\b|\byesquero\b|\bajax\b|\bariel\b|\baxion\b|\bdetergente\b|\bcloro\b|\blavaplat|\bdesinfect|\bbleach\b|\bsuavizante\b|\besponja\b|\bguantes\b|\bbolsa de basura\b|\bbolsa plastica\b/i;

const HIGIENE_PATTERN =
  /\balways\b|\btoalla\s+(?:sanit|suave)|\bpapel hig|\btampax\b|\bjabon\b|\bjabo de\b|\bshampoo\b|\bchampu\b|\bacond\b|\bacondic|\bcondicionador\b|\bpasta dental\b|\bcrema dental\b|\bdesodorante\b|\bprotector\b|\bexhibidor capilar\b|\bcepillo dental\b|\benjuague\b|\bpalmolive\b|\brexona\b|\bcolgate\b|\boral-b\b/i;

function isHigienePersonal(normalized) {
  return HIGIENE_PATTERN.test(normalized);
}

function isChucheria(normalized) {
  return CHUCHERIA_PATTERN.test(normalized);
}

function isBebida(normalized) {
  if (/chocolate|chocolat|\bchoco\b/.test(normalized)) {
    return false;
  }

  return BEBIDA_PATTERN.test(normalized) || TEA_PATTERN.test(normalized);
}

function isAlimentoBasico(normalized) {
  if (isChucheria(normalized)) {
    return false;
  }

  return ALIMENTO_BASICO_PATTERN.test(normalized);
}

function categorizeProduct(description) {
  const normalized = normalizeForCategory(description);

  if (LIMPIEZA_PATTERN.test(normalized)) {
    return { category: 'Limpieza del Hogar', confidence: 'alta' };
  }

  if (isHigienePersonal(normalized)) {
    return { category: 'Higiene Personal', confidence: 'alta' };
  }

  if (isChucheria(normalized)) {
    return { category: 'Chucherías', confidence: 'alta' };
  }

  if (isBebida(normalized)) {
    return { category: 'Bebidas', confidence: 'alta' };
  }

  if (isAlimentoBasico(normalized)) {
    return { category: 'Alimentos Básicos', confidence: 'alta' };
  }

  return { category: 'Chucherías', confidence: 'alta' };
}

module.exports = {
  categorizeProduct,
  normalizeForCategory,
};
