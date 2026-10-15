# Escenario "Bodega Banco Facturas (eval)" (SCN-10f)

Tienda propia del lab (`stores.slug = 'eval-facturas'`) contra la que el runner
empareja las 32 facturas del banco. Catálogo en `catalog.ts`, compras y tasas
derivadas de las verdades en `plan.ts`, siembra en `../seed-lab.ts`
(`npx tsx scripts/invoice-eval/seed-lab.ts`, solo lab local, idempotente).

## Reconciliación de claves

Se cruzaron las `productKey` de `truth/*.json` con `keys-SCN-10a/b/c.txt` y
`synthetic/keys-sint.txt`: 91 claves, las mismas en los cinco orígenes. No hizo
falta ninguna fusión (ninguna mercancía tenía dos claves); no se editó ninguna
verdad. Pares revisados y que siguen separados porque son otro producto o tamaño:
`cheese-tris-50g`/`cheese-tris-150g`, `doritos-flamin-hot-140g`/`doritos-dinamita-flamin-40g`,
`sardina-willinger-155g`/`sardina-marbonita-170g`/`sardinas-la-gaviota-170g`,
`samba-fresa-16g`/`samba-fresa-32g`, `mantequilla-mavesa-250g`/`-500g`,
`aceite-soya-pampa-500ml`/`-700ml`, `flips-*-120g`/`flips-*-28g`.

## Decisiones

- **Nombres**: como los teclearía el dueño ("Harina P.A.N. 1 Kg", "Justy pequeño
  400 ml", "Ringos 62g"), no el texto de la factura; un test lo vigila.
- **Alícuota**: por la marca de la factura. Víveres (E) exentos (incluida la
  mayonesa, que f04 marca exenta); el resto general 16 %. Atún, sardina
  Marbonita y guisantes van gravados (sus facturas no los marcan (E)).
- **Fuera de catálogo (10 de 91, 11 %)**: los 3 insumos (bolsas, cinta),
  `gatorade` (Chevere), `de-todito-resuelto-110g` (Hiperconfi), `char-dula-demi`
  (Las Acacias), `tobo-14-promo` (Cocktail), `chimo-tigrito-amarillo` (Market
  Catia), `aromax-lavanda-10g` (Mercaseu), `jabon-azul-las-llaves-300g` (Ceiba /
  Los Andes).
- **Proveedores**: RIF con formato de tienda (`J-50835761-2`) y los dígitos de la
  verdad; Farmatodo sin RIF (la verdad no lo trae).
- **Vínculos**: Chevere habitual de sus 12 refrescos, con empaque registrado en 5
  (BULTO X 6 ×2, BULTO X 12, BULTO X 15, CAJA X 15) y 7 sin registrar; Glup Cola
  2 Lt va por receta (bulto x6), no por empaque. El Samán vinculado con su código
  SM-xxxxx. Mercaseu vinculado sin empaques. Los Andes sin vínculos: se
  reconoce por `products.barcode` = EAN. El resto sin catálogo propio.
- **Aliases**: ninguno (`supplier_product_aliases` vacío); el runner los simula.
- **Último costo**: primera aparición del producto en el banco (sin duplicados),
  Bs por unidad suelta ÷ tasa de esa fecha (impresa o interpolada entre las
  impresas reales/sintéticas, fija en los extremos). Sin costo los 3 de f04 sin
  tamaño de empaque (mayonesa, ketchup, Doritos Flamin Hot).
- **Compras**: por el camino real, RPC `create_purchase` recibida con la sesión
  del admin del escenario (mueve stock, libro cuadrado: las vistas de integridad
  dan 0 para la tienda). Luego se fecha `purchases.created_at` al día de la
  factura de origen. Se compra al proveedor de esa factura si ya está vinculado
  (Chevere, El Samán, Mercaseu); si no, a "Compras varias (histórico)", que no es
  proveedor del banco. Así `create_purchase`, que vincula todo lo que compra
  (20261010a), no le crea catálogo a Market Catia, Los Andes, etc.
- **Tasas**: `exchange_rates` con las 10 tasas impresas en facturas reales; la
  última (875,65 del 2026-10-12) es la del día que lee `loadMatchContext`.
- **Sesión**: `invoice_match_candidates` exige perfil activo (`assert_store_context`):
  `loadMatchContext` con un cliente service-role falla; el runner debe iniciar
  sesión con `SCENARIO_USER_EMAIL` / `SCENARIO_USER_PASSWORD`.
