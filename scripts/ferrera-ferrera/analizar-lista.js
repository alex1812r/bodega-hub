const path = require('path');

const { parseCatalogFromFile, writeCatalog } = require('./build-catalog');

const INPUT_FILE = path.join(__dirname, 'raw-data.txt');
const OUTPUT_FILE = path.join(__dirname, 'catalogo.json');

const catalog = parseCatalogFromFile(INPUT_FILE);
writeCatalog(catalog, OUTPUT_FILE);

console.log(`Catálogo completo: ${catalog.total_items} productos`);
console.log(`  Unidad: ${catalog.resumen_por_modo_compra.unit}`);
console.log(`  Empaque: ${catalog.resumen_por_modo_compra.pack}`);
console.log(`  Incompletos: ${catalog.items_incompletos.length}`);
console.log(`Archivo: catalogo.json`);
