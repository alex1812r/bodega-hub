const path = require('path');

const { parseCatalogFromFile, writeCatalog } = require('./build-catalog');

const INPUT_FILE = path.join(__dirname, 'raw-data.txt');
const OUTPUT_FILE = path.join(__dirname, 'catalogo_packs.json');

const catalog = parseCatalogFromFile(INPUT_FILE, { packOnly: true });
writeCatalog(catalog, OUTPUT_FILE);

console.log(
  `Catálogo mayorista (solo pack): ${catalog.total_items_multiples_extraidos} productos`,
);
console.log(`  Incompletos: ${catalog.items_incompletos.length}`);
console.log('Por categoría:', catalog.resumen_por_categoria);
console.log('Archivo: catalogo_packs.json');
