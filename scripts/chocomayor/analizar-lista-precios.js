const fs = require('fs');
const path = require('path');

const { categorizeProduct } = require('./category-utils');
// Configuración del sistema
const CONFIG = {
    currency: 'REF',
    providerName: 'Chocomayor',
    providerAddress: 'Quinta Crespo. Calle Del Loro. Diagonal al Páramo',
    documentDate: '2026-06-03'
};

function parseCatalogData(filePath) {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    // Separar por saltos de línea y limpiar
    const lines = rawContent.split(/\r?\n/);
    
    const outputData = {
        proveedor: {
            nombre: CONFIG.providerName,
            direccion: CONFIG.providerAddress,
            notas: "Precios susceptibles a cambio sin previo aviso."
        },
        documento: {
            fecha_lista: CONFIG.documentDate,
            moneda: CONFIG.currency,
            archivo: "raw_data.txt"
        },
        resumen_por_categoria: { "Alimentos Básicos": 0, "Bebidas": 0, "Chucherías": 0, "Higiene Personal": 0, "Limpieza del Hogar": 0 },
        resumen_por_modo_compra: { unit: 0, pack: 0 },
        items: [],
        items_incompletos: [],
        duplicados_sospechosos: []
    };

    // NUEVA REGEX: Busca números con coma (ej. 10,89), un espacio, y luego el resto del texto
    const lineRegex = /^(\d+,\d{2})\s+(.+)$/;
    // Regex para detectar empaques múltiples (ej. 12X30, 24U, 50UNID, 200SOBRES)
    const packRegex = /(?:(\d+)\s*[xX]\s*\d+)|(?:(\d+)\s*(?:U|UNID|UNDS|SOBRES|PAQUETICOS|UND))\b/i;

    // Variable para ir uniendo líneas rotas si las hay
    let pendingLine = "";

    lines.forEach(rawLine => {
        // Limpiar etiquetas si se copiaron por error y quitar espacios extra
        let line = rawLine.replace(/\\s*/g, '').trim();
        if (!line) return;

        // Si la línea no empieza con un número (precio), probablemente sea la continuación de la línea anterior
        if (!line.match(/^\d+,\d{2}/)) {
            pendingLine += " " + line;
            return;
        } else {
            // Si hay una línea pendiente, la procesamos antes de empezar la nueva
            if (pendingLine) {
                processLine(pendingLine, outputData, lineRegex, packRegex);
            }
            pendingLine = line; // Guardar la nueva línea
        }
    });

    // Procesar la última línea que quedó pendiente
    if (pendingLine) {
        processLine(pendingLine, outputData, lineRegex, packRegex);
    }

    fs.writeFileSync('catalogo.json', JSON.stringify(outputData, null, 2), 'utf-8');
    console.log(`¡Éxito! Se procesaron ${outputData.items.length} productos. Archivo guardado como catalogo.json`);
}

function processLine(line, outputData, lineRegex, packRegex) {
    const match = line.match(lineRegex);
    if (!match) return; // Si no cumple el patrón, se omite

    const rawPrice = match[1].replace(',', '.');
    const packPriceRef = parseFloat(rawPrice);
    const description = match[2].trim();

    if (packPriceRef === 0) {
        outputData.items_incompletos.push(description);
        return;
    }

    let purchaseMode = 'unit';
    let unitsPerPack = 1;
    let unitPriceRef = packPriceRef;
    let packageType = 'Unidad';

    // Verificar si es un empaque múltiple
    const packMatch = description.match(packRegex);
    if (packMatch) {
        purchaseMode = 'pack';
        unitsPerPack = parseInt(packMatch[1] || packMatch[2], 10);
        
        if (unitsPerPack > 1) {
            unitPriceRef = parseFloat((packPriceRef / unitsPerPack).toFixed(2));
            // Determinar tipo de empaque por heurística
            if (description.toLowerCase().includes('bolsa')) packageType = 'Bolsa';
            else if (description.toLowerCase().includes('display')) packageType = 'Display';
            else if (description.toLowerCase().includes('ristra')) packageType = 'Ristra';
            else packageType = 'Caja/Paquete';
        } else {
            purchaseMode = 'unit';
        }
    }

    const { category, confidence: categoryConfidence } = categorizeProduct(description);

    // Generar SKU propuesto (slug)
    const proposedSku = description.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    const itemRecord = {
        linea_original: line,
        nombre_producto: description,
        categoria: category,
        confianza_categoria: categoryConfidence,
        sku_propuesto: proposedSku,
        modo_compra: purchaseMode,
        tipo_empaque: packageType,
        unidades_por_empaque: unitsPerPack,
        precio_por_empaque_ref: packPriceRef,
        precio_unitario_ref: unitPriceRef,
        datos_faltantes: []
    };

    outputData.items.push(itemRecord);
    outputData.resumen_por_categoria[category]++;
    outputData.resumen_por_modo_compra[purchaseMode]++;
}

// Ejecutar
parseCatalogData(path.join(__dirname, 'raw_data.txt'));