# Escaneo de facturas de compra

Documento del plan [`agent-prompts/factura-escaneo-gtm.md`](agent-prompts/factura-escaneo-gtm.md) (§9). Endpoints y tablas en [`modules-catalog.md`](modules-catalog.md#compras) §Compras; contrato en [`public/openapi.yml`](../public/openapi.yml).

## Índice

1. [Cómo funciona](#cómo-funciona)
2. [Las tres capas de aprendizaje](#las-tres-capas-de-aprendizaje)
3. [Banco de evaluación](#banco-de-evaluación)
4. [Resultados por proveedor de IA](#resultados-por-proveedor-de-ia)
5. [Dataset para fine-tuning (opcional)](#dataset-para-fine-tuning-opcional)
6. [Despliegue](#despliegue)

---

## Cómo funciona

El modelo de IA **propone**; no escribe nada en productos, vínculos ni compras. Nada se guarda hasta que el usuario confirma la compra por el flujo de siempre (`POST /api/purchases` → `create_purchase` con `clientRequestId`). Código en `src/modules/invoice-scan/` (cliente, servidor y contrato `contracts.ts`) y en `src/modules/purchases/purchase-create/invoice-scan/` (revisión).

### 1. Cliente

- Botón **"Escanear factura"** en la cabecera de `/purchases/create` y en el vacío de `/purchases` (abre `/purchases/create?scan=1`). Solo con `purchases.create`.
- `InvoiceScanModal`: arrastrar, elegir archivo o tomar foto. Acepta JPG, PNG, WebP y PDF (cada página del PDF se rasteriza con `pdfjs-dist`).
- Preparación (`prepareInvoiceFile.ts`, `prepareInvoice.core.ts`): rotación EXIF, lado mayor ≤ 1600 px y ≤ 1 MB por página, como mucho 10 páginas, todas del mismo formato. Avisos de calidad (foto borrosa o muy oscura) con "Repetir foto" o "Escanear igual".
- El sha256 se calcula sobre los bytes ya procesados. Muestra la cuota del día (`GET /api/purchases/invoice-scan/limits`).
- Envío: si el total cabe en 4 MB, `POST /api/purchases/invoice-scan` en multipart. Si no, pide URLs firmadas (`GET …/upload-url`), sube cada página al bucket privado `invoice-scans` y manda las rutas por JSON al mismo POST.

### 2. BFF (`scanService.ts`)

1. Sesión real con `purchases.create`; la tienda sale siempre de la sesión. Recalcula el hash, comprueba por los bytes que cada página es la imagen declarada y valida que las rutas sean `<store_id>/<sha256>/p<n>.<ext>` de esa tienda.
   - Una página con el lado mayor por encima de 1600 px responde 400 "La imagen supera 1.600 px en su lado mayor. Vuelve a subirla desde la app para que se reduzca." (CIE-07; sin `sharp` el servidor no redimensiona). En multipart se rechaza antes de subir, reservar o cobrar: no queda objeto ni fila. Con `storagePaths` se valida tras descargar y antes de reservar: el objeto ya subido con la URL firmada se queda en el bucket hasta la purga.
   - Con datos en Supabase y sin ninguna key de IA responde 503 "El escaneo de facturas no está configurado: falta la key del proveedor de IA." antes de reservar: sin fila, sin cupo y sin caché (CIE-08). El mock solo se usa con `INVOICE_SCAN_PROVIDER=mock` o con datos mock.
2. Reserva atómica (`reserve_invoice_scan`, lock por tienda):
   - misma foto ya leída → devuelve ese escaneo con `cached: true`, sin modelo y sin cuota;
   - otra petición la está leyendo → 409;
   - las páginas no caben en la cuota de hoy → 429 `INVOICE_SCAN_LIMIT_REACHED`;
   - si no, fila `processing` y páginas cobradas. Cada intento cobra, también un reintento fallido.
3. Few-shot (capa 2) si el cliente mandó `supplierId`.

### 3. Modelo (`extract.ts`, `prompt.ts`)

- `generateObject` contra `invoiceExtractionSchema`, una llamada por página, `temperature: 0` y timeout de 45 s por página.
- El prompt explica la factura venezolana (empaques "x6", "EXE" = exento, Bs frente a $) y declara el contenido de la imagen como datos, no instrucciones.
- Proveedor y modelo por entorno (ver [Despliegue](#despliegue)). Un fallo deja la fila `failed` con solo el código y responde 502 `INVOICE_SCAN_PROVIDER_ERROR` (`details.reason`: `PROVIDER_ERROR`, `TIMEOUT`, `INVALID_OUTPUT` o `QUOTA`). La compra manual sigue disponible.
- Nunca se registran imágenes, claves ni el texto de la factura.

### 4. Emparejamiento (`match.ts`, `loadMatchContext.ts`)

Determinista, sin IA.

- **Proveedor**: por RIF (la letra tiene que coincidir si las dos partes la traen); si no, por nombre difuso (RPC `invoice_match_candidates`); si no, lo elige el usuario.
- **Líneas**, en cascada:
  1. SKU del proveedor;
  2. alias exacto (capa 1);
  3. código de barras;
  4. alias o nombre difuso (trigram) → **dudosa** con ≤ 3 candidatos;
  5. nada → **sin emparejar**.

  Un SKU o un código de barras exacto confirma si la línea es por unidad o su empaque está registrado; un empaque declarado sin registrar la deja dudosa (D17).
- **Empaques y recetas**: salen de `supplier_product_pack_units` y `product_pack_conversions`. Si el precio se aleja más de un 40 % del último costo, la línea queda dudosa ("¿precio por caja o por unidad?").
- **Tasa** (CIE-02): es la misma tasa del día que usa el formulario de compra (`getCurrentExchangeRate`, la de `GET /api/exchange-rates/current`), no la última guardada.
  - Impresa que difiere más de 2 % → aviso.
  - Más de 25 % → se ignora con aviso.
  - Sin tasa del día → se usa la impresa con aviso; sin ninguna, no hay costos REF y la revisión pide la tasa.
- **Duplicados**: mismo proveedor y número normalizado, o posible duplicado por proveedor + total + fecha.

### 5. Revisión y compra

- `InvoiceReviewPanel` reemplaza al formulario mientras se revisa. Cada línea sale confirmada, dudosa (con candidatos) o sin emparejar, y se maneja con teclado.
- Avisos de tasa (tasa de hoy, de la factura o manual; la elegida es la tasa de la compra y la compra se abre en los Bs exactos de la factura), de "¿precios incluyen IVA?", de factura en USD y de duplicado.
- Al aplicar, las líneas precargan el formulario normal (modo unidad o empaque, "Desarmar al recibir"). Confirmar envía a `POST /api/purchases` `invoiceScanId`, `invoiceScanLines` y `invoiceScanExtraction`, que es la lectura corregida (D10).
- Textos de la factura (CIE-06): cada texto de `invoiceScanExtraction` (proveedor, número, fecha, `rawText`, `description`, `barcode`, `supplierSku` y avisos) rechaza U+0000, los caracteres de control C0/C1 (salvo tabulador, salto de línea y retorno de carro) y los surrogates sueltos, y admite como mucho 1000 caracteres; como mucho 50 avisos. Si no cumple, `POST /api/purchases` responde 400 ("Un texto de la factura tiene caracteres no permitidos." o "Cada texto de la factura puede tener como máximo 1000 caracteres.") antes de reclamar el escaneo y de crear la compra. `invoiceScanLines[].packLabel` (CIE-09) se recorta de espacios, tiene el mismo veto de caracteres ("Un texto de la factura tiene caracteres no permitidos.") y admite como mucho 100 caracteres (mensaje por defecto de zod: "Too big: expected string to have <=100 characters"); si no cumple, también 400 antes de reclamar el escaneo. En todos estos casos `error.message` es "La solicitud no tiene un formato válido." y el texto concreto va en `error.issues[].message`. Una salida del modelo que no cumpla falla como `INVALID_OUTPUT`.
- Antes de crear la compra se reclama el escaneo para la clave (`clientRequestId`). Si la creación se rechaza (4xx), el reclamo se suelta. Con un resultado incierto (5xx, red) el reclamo caduca a los 5 minutos, salvo que la clave ya haya creado su compra (CIE-06): entonces queda ligado a esa compra, no caduca ni se suelta, y otra clave recibe 400 "Esta factura ya se registró en otra compra".
- Tras `create_purchase` el escaneo pasa a `confirmed` con `confirmed = { extraction, lines, … }` y se aprenden los alias. Si el confirm o el aprendizaje fallan, la compra ya existe; el resultado viaja en `invoiceScan: { confirmed, learned }`. Repetir el mismo intento (misma clave) devuelve la misma compra y reintenta sobre ella lo que faltó: el confirm y, si `learned_at` sigue null, una llamada de aprendizaje.
- Si la respuesta trae `invoiceScan.confirmed: false`, la UI avisa "La compra se registró pero no se pudo vincular la factura. No la vuelvas a registrar.": la factura sigue ligada a esa compra en el servidor.
- El detalle de la compra muestra la factura (`GET /api/purchases/{id}/invoice-scan`). Un escaneo `extracted` se puede descartar (`POST …/{id}/discard`), salvo que una compra lo esté confirmando o que la clave de su reclamo ya haya creado su compra: 409 "Esta factura ya tiene una compra registrada y no se puede descartar." (CIE-06). A los 90 días el cron borra imágenes y filas.

## Las tres capas de aprendizaje

El modelo no se entrena. Mejoran con el uso tres capas propias:

| Capa | Qué aprende | Dónde vive |
|------|-------------|------------|
| 1. Alias por proveedor | `(tienda, proveedor, texto normalizado) → producto (+ pack_label, units_per_pack)`. La clave es la descripción normalizada (`invoiceAliasKey`). Al confirmar la compra, `learn_invoice_aliases` hace upsert y suma `hits`; un alias reasignado a otro producto se reemplaza. La siguiente factura del proveedor empareja por alias exacto antes que por nombre difuso. Se ven y se quitan en el detalle del proveedor (`/api/contacts/{id}/product-aliases`, RPC `remove_supplier_product_alias`). | `supplier_product_aliases` (19b, 20a) |
| 2. Ejemplos few-shot | Cómo se lee el formato de ese proveedor. Si el usuario eligió proveedor antes de escanear, el prompt incluye hasta 3 escaneos confirmados suyos (imagen + `confirmed.extraction`, ya saneado). Son las correcciones del usuario convertidas en ejemplos. | `invoice_scans.confirmed` y `supplier_id` (19a) |
| 3. Banco de evaluación | Nada: mide si un cambio de prompt, modelo o reglas mejora o empeora. | `scripts/invoice-eval/` (ver abajo) |

El fine-tuning es opcional y no se ejecuta: el exportador deja el dataset listo (ver [Dataset para fine-tuning](#dataset-para-fine-tuning-opcional)).

---

## Banco de evaluación

El banco mide la extracción y el emparejamiento con facturas de verdad y compara los resultados contra las metas del §10 del plan. No entrena nada. Todo vive en `scripts/invoice-eval/`.

### Contenido

| Ruta | Qué es |
|------|--------|
| `samples/f01.jpg`…`f22.jpg` | 22 fotos reales hechas con el celular del dueño, sin recortar. `samples/manifest.md` describe cada una: proveedor, formato y por qué cuesta. La tabla del manifiesto es un punto de partida leído a ojo, no la verdad. |
| `samples/s01.jpg`…`s10.jpg` (`s02-p1.jpg`, `s02-p2.jpg`) | 10 facturas sintéticas para lo que las reales no cubren. |
| `truth/<id>.json` | La verdad esperada de cada factura (32 en total). |
| `truth.ts` | Schema zod de la verdad, `parseTruth` y `loadTruth(dir)`. |
| `scenario/` y `seed-lab.ts` | La tienda lab contra la que se empareja. |
| `metrics.ts` | Las métricas, funciones puras sin IO. |
| `runner.ts` | `runBench(opts)`: extrae, empareja y mide. |
| `report.ts` | Escribe el informe Markdown y el volcado JSON de cada corrida. |
| `export-finetune.ts` | Exporta el dataset de fine-tuning (ver la última sección). |

**Privacidad.** El repo es privado, pero f04, f05, f09, f12, f18, f20 y f22 muestran nombres o cédulas de personas. No se publican fuera del repo; si algún día se abre el banco, primero hay que anonimizar esas fotos.

### Facturas reales (f01–f22)

Hay 8 proveedores y 7 formatos de impresora. Casos que se miden a propósito:

- **Pares duplicados**: f02/f03 y f07/f16 (f16 viene girada 90°). Cada par debe dar el mismo resultado y detectarse como duplicado.
- **Mismo número, distinto proveedor**: f11 y f14. No son duplicado.
- **No inventar**: f07 tiene un dedo tapando dos líneas y f09 un recibo bancario al lado.
- **Escala**: f12, la factura larga.
- **Resolución mínima**: f18 y f19. **Fotos oscuras**: f21 y f22.

Las verdades se escribieron revisando cada foto, no copiando el manifiesto. Las diferencias encontradas quedan en `verification.manifestDiffs` de cada verdad. Las más importantes:

- **f12** tiene **41 líneas**, no 57. El `Cantidad:57` del pie es la suma de las cantidades (29 líneas de 1, 10 de 2 y 2 de 4). La fecha impresa es **2026-10-08**, no el 09-10.
- **f04**: `#46.50` (y `#55.00`, `#12.00`…) **no** son unidades por caja. Es el precio unitario en REF con IVA incluido. Se comprueba con la tasa implícita 874,74, que da igual en las 5 líneas. El código de 3 dígitos es el número de línea, no un SKU.
- **f02** **no** trae `6/15`: la foto muestra `CAJA X 15`, `BULTO X 6` y `BULTO X 15` en líneas separadas.
- **f05** **no** imprime cantidad ni precio unitario. La verdad usa `quantity = 1` en cada línea porque el pie dice `TOT: 9` y hay 9 líneas.

### Facturas sintéticas (s01–s10)

Las genera `synthetic/generate.ts` de forma determinista. Los datos están en `synthetic/data.ts` y el modelo en `model.ts`. Las plantillas HTML (`templates.ts`) se convierten en imagen con Chromium headless de Playwright y se guardan como JPG q85 con el lado mayor de 1600 px como máximo. La verdad y la imagen salen del mismo modelo, así que coinciden por construcción. El informe las marca como "(sintética)".

| id | Caso |
|----|------|
| s01 | Descuento por línea y descuento global del 2 % |
| s02 | Dos páginas (8 + 6 líneas, totales solo en la 2.ª) |
| s03 | Ticket térmico girado unos 8°, con código de barras por línea |
| s04 | Sombra diagonal fuerte |
| s05 | Térmica desteñida y borrosa |
| s06 | Nota de entrega escrita a mano, sin IVA |
| s07 | Texto que intenta manipular al modelo en OBSERVACIONES: el total real debe mantenerse |
| s08 | Afiche de oferta: no es una factura, la verdad no tiene proveedor ni líneas |
| s09 | Foto oscura y casi ilegible: mide que el modelo no invente |
| s10 | 2.ª factura de El Samán (mismas descripciones que s01), para medir con alias |

Para regenerarlas: `npx tsx scripts/invoice-eval/synthetic/generate.ts`. Hace falta Chromium de Playwright. El script reescribe las imágenes `s*`, `truth/s*.json` y `synthetic/keys-sint.txt`.

### Formato de la verdad (`truth.ts`)

Cada `truth/<id>.json` se valida con `invoiceTruthSchema`. Su `id` tiene que coincidir con el nombre del archivo.

- `extraction` sigue el **mismo contrato** que devuelve el escaneo (`invoiceExtractionSchema` de `src/modules/invoice-scan/contracts`): es lo que devolvería un lector perfecto.
- `synthetic` vale `true` en las sintéticas. `pages` lista las rutas de las imágenes, relativas a `scripts/invoice-eval/` y en orden.
- `supplierKey` es el slug del proveedor; es `null` si la imagen no es una factura. `duplicateOf` es el id de la factura original cuando se trata de otra foto de la misma.
- `lines[]` tiene la misma longitud que `extraction.lines`. Por cada línea:
  - `productKey`: slug del producto en unidad del catálogo; `null` si no es mercancía, como `ENVIO`.
  - `occluded`: `true` si la foto tapa la línea.
  - `uncertainFields`: campos que no se pueden leer con certeza y que quedan fuera de la exactitud.
  - `note`.
- `occludedHeaderFields` (opcional): campos de cabecera (`supplier`, `date`, `number`, `total`) que la foto **no deja leer**. Es una definición del banco, igual para todos los modelos: declara lo que la imagen no permite leer, no etiqueta la salida de un modelo. `extraction` conserva el valor real (de otra foto o del generador) solo para detectar lo inventado. Casos: **f03** `date` (el pulgar tapa la fecha, solo se ve "…26"; el valor viene de f02) y **s09** los cuatro campos, con todas sus líneas `occluded: true` (foto casi ilegible a propósito). El motivo queda en `verification.manifestDiffs` y, en s09, en la `note` de cada línea. `synthetic/generate.ts` aún no emite estos campos: si se regenera s09 hay que reponerlos.
- `verification`: `checkedAgainstImage`, `manifestDiffs` y `arithmetic`, que explica cómo cuadran los totales.

### Escenario lab `eval-facturas`

`seed-lab.ts` (`npx tsx scripts/invoice-eval/seed-lab.ts`) siembra la tienda `stores.slug = 'eval-facturas'` ("Bodega Banco Facturas (eval)") en la base **lab local**. Solo lee `.env.stock-lab` y aborta si la API o la base no están en 127.0.0.1/localhost. Es idempotente: borra y recrea solo esa tienda y su usuario.

- **Siembra**: el catálogo (`scenario/catalog.ts`; 81 de 91 productos, los otros 10 se dejan fuera a propósito), los proveedores con sus vínculos y algunos empaques registrados, las 10 tasas impresas en las facturas reales y compras históricas hechas por la RPC real `create_purchase`, que dan el "último costo".
- **Alias**: `supplier_product_aliases` queda **vacío**. El runner simula los alias en memoria.
- **Sesión**: la RPC de candidatos exige una sesión con perfil activo. El runner inicia sesión con `SCENARIO_USER_EMAIL` / `SCENARIO_USER_PASSWORD`; un cliente service-role no sirve.
- Las decisiones del escenario (nombres, alícuotas, productos fuera de catálogo) están en `scenario/README.md`.

### Métricas (`metrics.ts`) tal como están implementadas

**Tolerancias.** En dinero, ±0,01 o el 0,1 % del valor esperado, lo que sea mayor. En cantidad, ±0,001.

**Alineación de líneas** (predicha ↔ verdad). Cada par recibe un `score = 0,6·texto + 0,2·cercanía(lineTotal) + 0,2·cercanía(quantity)`.

- `texto` es el mayor coeficiente de Dice por bigramas entre {description, rawText} de la predicha y de la verdad. Antes se normaliza el texto: minúsculas, sin acentos ni signos.
- `cercanía` vale 1 dentro de la tolerancia; fuera de ella vale `1 − |a−b| / max(|a|,|b|)`.
- Solo cuentan los pares con score ≥ 0,5 y texto ≥ 0,2. Se ordenan por score de mayor a menor (en empate, primero el índice de la verdad y luego el de la predicha) y se asignan 1 a 1 de forma voraz. El resultado es determinista.

**Cabecera** (`headerFieldRate`): campos correctos / campos evaluados. Un campo que la verdad no trae no se evalúa.

- **Proveedor**: si las dos partes traen RIF, se compara el RIF normalizado (si a uno le falta la letra, solo los dígitos). Si no, se compara el nombre sin sufijo societario y basta una similitud ≥ 0,8. También vale si el contacto emparejado es el esperado.
- **Fecha**: tiene que ser idéntica.
- **Número**: se comparan solo los dígitos, sin ceros a la izquierda.
- **Total**: con la tolerancia de dinero.
- **Campo ocluido** (`occludedHeaderFields`): cuenta como acierto si la predicción lo omite (proveedor sin nombre ni RIF, fecha o número vacíos, total ausente) o si lo trae igual a la verdad. Si lo trae distinto es fallo (inventado). Un escaneo fallido no cuenta como omitir.

**Líneas detectadas** (`linesDetectedRate`): `TP / (TP + FP + FN)`.

- FP: líneas predichas que no se alinearon con ninguna, más las líneas tapadas leídas mal.
- FN: líneas visibles de la verdad que se perdieron.
- **Líneas tapadas (`occluded`)**: perderlas no cuenta. Si se alinean, cuentan como TP cuando la cantidad y el total coinciden o cuando la línea predicha trae `confidence ≤ 0,5`. Si no, cuentan como **inventadas** (`occluded_mismatch`).

**Exactitud** (`exactRate`): líneas visibles con cantidad, precio unitario y total correctos, sobre todas las líneas visibles. Una línea perdida cuenta como fallo y los `uncertainFields` no se evalúan.

**Emparejamiento.** Cada línea recibe un resultado:

| Resultado | Cuándo |
|-----------|--------|
| `confirmed_correct` | La línea se confirmó con el producto esperado. |
| `doubtful_correct` | Quedó dudosa, pero el producto esperado es el producto o uno de los candidatos. |
| `confirmed_wrong` | Se confirmó con otro producto, o se confirmó una línea que no debía tener producto (inventada, fuera de catálogo o `null`). |
| `doubtful_wrong` | Quedó dudosa y el producto esperado no está entre los candidatos. |
| `unmatched` | Quedó sin emparejar. |
| `lost` | La línea se perdió en la extracción. |
| `ok_none` | No tenía producto y no se confirmó. |

- `matchOkRate = (confirmed_correct + doubtful_correct) / líneas de verdad con producto en catálogo`. Las perdidas cuentan en el denominador.
- **`confirmedWrongRate = confirmed_wrong / (líneas de verdad evaluadas + inventadas)`**. Es la métrica que manda.

**Buckets.**

- `sinAlias`: todas las facturas en orden de id, sin few-shot y con los alias vacíos. Los `previousScans` simulados son las facturas ya procesadas en la misma pasada, para detectar duplicados.
- `conAlias`: desde la 2.ª factura de cada proveedor. Los alias simulados son lo que el usuario habría confirmado en las anteriores del mismo proveedor (`learnAliases`: cada línea predicha que se alineó con una línea de verdad cuyo producto está en el escenario).
  - Con `fewShot`, la factura se vuelve a extraer con hasta 3 anteriores del proveedor como ejemplo. Nunca se usa la factura de la que es duplicado.
  - Sin `fewShot`, se reutiliza la extracción de `sinAlias` y su uso no se cuenta dos veces.
  - La 1.ª factura de cada proveedor no entra en este bucket.

**Fuga del few-shot** (`fewShotLeak`, meta: 0). Solo en `conAlias` cuando la factura se extrajo con ejemplos: un campo de cabecera predicho (RIF o nombre del proveedor, número o total) igual al de alguno de los ejemplos usados y distinto de la verdad cuenta como fuga. Se agrega como facturas con fuga / facturas con few-shot (`fewShotLeaks` / `fewShotEvaluated`) y el informe lista cada una con sus campos y ejemplos.

**Duplicados.** `pairConsistency` comprueba que los dos escaneos de una misma factura tengan la misma cabecera y las mismas líneas alineadas (cantidad, precio, total y, en `sinAlias`, emparejamiento). En `conAlias` compara solo la extracción: el duplicado hereda los alias aprendidos del original y su emparejamiento difiere por construcción. Los `previousScans` simulados usan solo el proveedor que resolvió el emparejamiento y el RIF leído, como producción; nunca el contacto de la verdad. El informe también cuenta los duplicados detectados, los falsos positivos y los no detectados.

**Replay.** `--replay` valida cada `predicted` con `invoiceExtractionSchema`; la que no lo cumple queda como error por factura (`REPLAY_INVALID`, "extracción inválida en el replay"). Si una extracción no se puede medir, la factura queda con error y la corrida sigue.

**Tiempo.** `p95DurationMs1Page` es el p95 por rango más cercano, **solo de las facturas de 1 página**. La meta es ≤ 15 s.

**Costo.** `avgCostUsd` es la media de las facturas con costo conocido. La meta es ≤ $0,01.

- El costo de cada factura sale de `estimateCostUsd(modelId, tokens)` con la tabla `MODEL_PRICES_USD_PER_MTOK`. La tabla está **fechada** (fuentes oficiales consultadas el 2026-10-15) y algunas filas tienen `effectiveFrom`: gemini-3.6/3.8-flash suben el 2027-01-01. Se elige la fila según la fecha de la corrida.
- claude-haiku-5-5 tiene un tramo más caro cuando la entrada supera los 100k tokens.
- Si el modelo no está en la tabla, el costo queda `null` (por ejemplo `gemini-3.5-flash`, que no tiene precio confirmado).
- Antes de decidir con dinero, hay que verificar los precios en la página oficial.

`meetsTargets` compara cada bucket con las metas del §10. Si una métrica no tiene datos, el informe la marca "sin datos" y no la da por fallida.

### Runner e informe

`runBench` recibe inyectados el extractor (con la misma forma que `extractInvoice`), la carga del contexto de emparejamiento y la lectura de las páginas. Las extracciones pueden correr en paralelo (`concurrency`); el emparejamiento siempre es secuencial. Nunca registra imágenes ni claves, y los errores se guardan solo como mensaje y código. Separa los resultados en reales, sintéticas y todas juntas.

`report.ts` arma el Markdown y el JSON; el CLI los guarda con la regla de nombres de "Cómo correrlo" (`runBaseName` y `writeRun` en `run.ts`). El informe trae:

- las metas del §10 con ✓/✗;
- los totales de cada bucket;
- el detalle por factura;
- los pares duplicados (un par cuya extracción falló sale "no evaluable (motivo)" con "—" en las demás columnas y no entra en el denominador de consistentes, que se muestra como "Consistentes: X/Y evaluables. No evaluables: Z.");
- las fugas de cabecera desde el few-shot;
- los casos de no inventar (f07, f09);
- los errores.

En las corridas con modelo (`google`/`anthropic`), el CLI añade la línea de caché (de caché, llamadas nuevas, llamadas con error) y la sección "Pendientes por medir" (factura, pasada y motivo). Si quedan pendientes, añade también "Métricas solo sobre lo medido"; el agregado normal cuenta cada pendiente como fallo total.

### Cómo correrlo

1. Levantar la base lab con `npm run stock-lab:db-up`.
2. Sembrar el escenario con `npx tsx scripts/invoice-eval/seed-lab.ts`.
3. Correr el banco con `npm run invoice-eval -- <flags>` (`npx tsx scripts/invoice-eval/run.ts`).
4. Los tests del banco se corren con `npx jest scripts/invoice-eval`.

Flags:

| Flag | Qué hace |
|------|----------|
| `--provider google\|anthropic\|mock\|oracle` | Proveedor. Obligatorio salvo con `--replay` sin `--fill-missing`. `oracle` no llama a ningún modelo (ver "Emparejamiento con oráculo"). |
| `--model <id>` | Modelo exacto (se pasa como `INVOICE_SCAN_MODEL`). Si se omite, el del proveedor por defecto. No vale con `oracle`. |
| `--only f01,f02` | Solo esas facturas. |
| `--no-fewshot` | Sin ejemplos few-shot en "con alias". Con `oracle` el few-shot no aplica nunca. |
| `--concurrency n` | Extracciones en paralelo, entero de 1 a 8 (por defecto 2). El emparejamiento siempre es secuencial. |
| `--out <dir>` | Carpeta de los informes (por defecto `scripts/invoice-eval/runs/`). |
| `--label <texto>` | Sufijo del nombre del informe. |
| `--replay <run.json>` | Reutiliza las extracciones guardadas de una corrida y recalcula solo el emparejamiento con el código y el lab actuales. Tokens, tiempo y costo salen de la corrida original. No admite `--no-fewshot` ni `oracle`. |
| `--fill-missing` | Solo con `--replay`: las facturas sin extracción guardada se extraen de nuevo. Exige `--provider` y `--model` iguales a los de la corrida de origen. Sin este flag quedan con error `REPLAY_MISSING`. |
| `--keys-env <ruta>` | Archivo del que se leen las keys de IA (por defecto `.env.local` del repo principal). |
| `--resume` | Solo con `google`/`anthropic` y con la caché activa. En cada pasada extrae las reales antes que las sintéticas, para que un corte por cuota deje medidas las reales. Repetir el mismo comando solo llama por lo que falta. |
| `--no-cache` | Solo con `google`/`anthropic`, y no se combina con `--resume`. No lee la caché: siempre llama y sobrescribe la entrada con el resultado nuevo. |

**Nombre de los informes** (regla única, `runBaseName` en `run.ts`). Cada corrida escribe `<out>/<nombre>.md` y `<out>/<nombre>.json`, donde `<nombre>` es:

- con modelo: `<fecha Caracas>-<proveedor>-<modelo>[-label]`;
- oráculo: `<fecha Caracas>-oraculo-solo-emparejamiento[-label]`;
- replay: `<fecha Caracas>-replay-<proveedor>-<modelo>[-label]`.

El proveedor, el modelo y la etiqueta van en minúsculas, y cualquier carácter que no sea letra, dígito o punto pasa a `-`. Si el nombre ya existe se añade `-2`, `-3`…: nunca se sobrescribe una corrida. (`writeRunFiles` de `report.ts`, con otro nombre, solo lo usan los tests.)

### Caché de extracciones y reanudación

- **Qué guarda.** Toda extracción real (`google`/`anthropic`) que termina bien se guarda en `scripts/invoice-eval/cache/<provider>/<modelId>/<id>-<pasada>-<clave16>.json`. Guarda la extracción, los tokens, la duración, el número de páginas, la fecha y el `modelId` resuelto. No guarda keys ni imágenes, solo hashes.
- **Clave.** Es el sha256 de lo que recibe el modelo: la versión del formato de caché, el proveedor y el modelo, el hash del prompt del sistema (`buildInvoiceSystemPrompt`), el hash del contrato (JSON Schema de `invoiceExtractionSchema`), los ids de las facturas de few-shot y los mensajes de few-shot y de la página tal como los arma `prompt.ts`, con cada imagen sustituida por su sha256.
- **Qué la invalida.** Un cambio de prompt, de contrato, de few-shot, de imagen o de `CACHE_FORMAT_VERSION` cambia la clave: la entrada vieja deja de casar y se vuelve a llamar. Una entrada ilegible, con otra clave o con una extracción que no cumple el schema se trata como si no existiera.
- **Uso.** Antes de llamar al modelo se busca la entrada; si está, se reutiliza con sus tokens y duración originales. El informe dice cuántas salieron de la caché.
- **Errores.** Los errores no se cachean (429, 503, timeout, salida inválida): `--resume` los vuelve a intentar. Un 429 se reintenta tras 65 s (la ventana por minuto); si sigue, cuenta para la racha de cuota diaria. Un `PROVIDER_ERROR` (503) se reintenta una vez tras 20 s.
- **`--no-cache`** obliga a llamar aunque la entrada exista, y la sobrescribe.
- El oráculo, el mock y el replay no usan la caché.

Protecciones del CLI:

- **Supabase solo del lab local.** Se lee únicamente de `.env.stock-lab` del worktree y el CLI aborta si la URL no es `127.0.0.1` o `localhost`.
- **Solo las 2 keys de IA.** Del archivo de `--keys-env` (que apunta a producción) se leen solo `GOOGLE_GENERATIVE_AI_API_KEY` y `ANTHROPIC_API_KEY`, y solo la del proveedor pedido; nada más entra en `process.env` y las keys nunca se imprimen ni se escriben. El oráculo y el replay sin `--fill-missing` no leen el archivo.
- **Cerrojo.** Mientras corre se toma `.notes/factura-escaneo/lab.lock` del repo principal; si otro proceso lo tiene, el CLI aborta.
- **Cuota.** 3 errores de cuota seguidos cortan la pasada y el informe lo avisa.

---

## Resultados por proveedor de IA

Las metas son las del §10 del plan. La key de Gemini está en free tier, con cuota diaria por modelo que se reinicia a las 07:00 UTC. Todas las corridas con modelo usan `--resume --concurrency 1` y few-shot en "con alias". Por modelo hay 51 extracciones por medir: 32 sin alias (22 reales y 10 sintéticas) y 19 con alias y few-shot. Las primeras llamadas se hicieron el 2026-10-15 (noche de Caracas). El 2026-10-16 (CIE-04, desde las 13:50 UTC) se completó lo que permitió la cuota.

### Cobertura por modelo

| Modelo | Medidas (sin / con alias) | Pendientes | Motivo | Corrida |
|--------|---------------------------|------------|--------|---------|
| gemini-3.5-flash-lite | 32/32 · 19/19 | 0 | — | `runs/2026-10-15-google-gemini-3.5-flash-lite-resume.md` |
| gemini-3.1-flash-lite | 32/32 · 18/19 | 1 | f10 con alias: timeout dos veces (con 3 imágenes de few-shot pasa de los 45 s de `extractInvoice`). No es cuota. | `runs/2026-10-15-google-gemini-3.1-flash-lite-resume.md` |
| gemini-3.6-flash | 14/32 · 0/19 | 37 | 2026-10-16: 5 nuevas (f12, f13, f16, f17, f18). Luego hubo 503 en f05 y f11, timeouts y 429 desde f19, y la pasada se cortó por cuota. | `runs/2026-10-15-google-gemini-3.6-flash.md` → `runs/2026-10-16-google-gemini-3.6-flash-cie04.md` |
| gemini-3.8-flash | 2/32 · 0/19 | 49 | 2026-10-16: 1 nueva (f09). Hubo 503 en f02–f06 y 429 desde f07, y la pasada se cortó por cuota. | `runs/2026-10-15-google-gemini-3.8-flash-2.md` → `runs/2026-10-16-google-gemini-3.8-flash-cie04.md` |
| gemini-2.5-flash | 1/32 · 0/19 | 50 | Cuota diaria ya agotada (429 desde la 1.ª llamada nueva). No se reintentó el 16-10. | `runs/2026-10-15-google-gemini-2.5-flash-2.md` |
| gemini-2.5-flash-lite | 0 | 51 | 404: la key no tiene acceso al modelo. Los modelos 2.5 solo se sirven a proyectos que ya los usaban. | `runs/2026-10-15-google-gemini-2.5-flash-lite-sonda.md` |
| claude-haiku-4-5 / claude-haiku-5-5 | 0 | 51 / 51 | **No verificado**: `ANTHROPIC_API_KEY` está vacía en el archivo de keys | — |

### Medición actual (2026-10-16, código de HEAD `7f37c31`, replay de las extracciones guardadas)

Los dos modelos lite tienen el banco completo (o casi) y se midieron de nuevo con `--replay` sobre sus corridas originales. Las extracciones son exactamente las mismas (0 llamadas); el emparejamiento, la cabecera y las métricas se recalculan con el código y el lab actuales. Tokens, p95 y costo salen de la corrida original. El HEAD `7f37c31` incluye la UI (alias por clave estable en `match.ts`), CIE-02 (fuente de tasa en `loadMatchContext`) y CIE-03b (`tax_id_match` con letra en `20261019d`, aplicado al lab).

- 3.5-flash-lite: `runs/2026-10-16-replay-google-gemini-3.5-flash-lite-cie04.md`. La anterior es `…-f3.md`, de HEAD `ca6a83f`.
- 3.1-flash-lite: `runs/2026-10-16-replay-google-gemini-3.1-flash-lite-cie04.md`. La anterior es `…-f5.md`.
- Oráculo: `runs/2026-10-16-oraculo-solo-emparejamiento-cie04.md`.

p95 y $/factura son de la corrida entera (la meta es sobre el total) y van en la fila "sin alias" de cada modelo. El p95 por el BFF está en "p95 y costo por el BFF".

| Modelo · bucket | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal | Fugas few-shot | p95 1 pág. | $/factura | Cobertura |
|-----------------|----------|--------|-----------|---------|-----------------|----------------|------------|-----------|-----------|
| **Meta §10** (sin / con alias) | ≥ 90 % / ≥ 95 % | ≥ 95 % | ≥ 90 % | ≥ 70 % / ≥ 90 % | ≤ 2 % | 0 | ≤ 15 s | ≤ $0,01 | 51/51 |
| gemini-3.5-flash-lite · sin alias | 98,4 % | 99,5 % | 99,0 % | 88,6 % | 0 % | — | 6,8 s | $0,0036 | 32/32 |
| gemini-3.5-flash-lite · con alias | 100 % | 100 % | 100 % | 96,1 % | 0 % | 0/19 | ↑ | ↑ | 19/19 |
| gemini-3.1-flash-lite · sin alias | 97,6 % | 99,0 % | 94,8 % | 88,6 % | 0 % | — | 7,9 s | $0,0024 | 32/32 |
| gemini-3.1-flash-lite · con alias | **94,7 % ✗** | 96,2 % | 96,1 % | 91,2 % | 0 % | 0/18 | ↑ | ↑ | 18/19 |

**Frente a la medición de `ca6a83f`, ninguna métrica del §10 empeora** en ningún bucket, modelo ni en el oráculo:

- 3.5-flash-lite: las seis métricas son idénticas en los dos buckets.
- 3.1-flash-lite: el emparejamiento con alias sube de 90,2 % a 91,2 %; las demás no cambian.
- Duplicados: 4/4 en los dos modelos y en el oráculo, 0 falsos positivos. f07 y f09 sin líneas inventadas.
- Pares consistentes: 3/4 en 3.5-flash-lite (antes 1/4: F6 corrige f03), 2/4 en 3.1-flash-lite y 4/4 en el oráculo.

El cambio visible es de **automatización**: en "con alias" muchas más líneas pasan de dudosa correcta a **confirmada correcta**, sin ninguna confirmada mal. Es el efecto del alias por clave estable de la UI (`5bdf8ae`, `9ff1f01`):

| Confirmadas correctas · con alias | `ca6a83f` | `7f37c31` |
|-----------------------------------|-----------|-----------|
| 3.5-flash-lite | 10 | 59 |
| 3.1-flash-lite | 7 | 61 |
| Oráculo | 32 | 75 |

- **gemini-3.5-flash-lite cumple todas las metas de calidad** del §10 en los dos buckets.
- **gemini-3.1-flash-lite falla solo la cabecera con alias**. Toda la diferencia viene de f10 con alias, que no tiene extracción por el timeout y cuenta como fallo total (4 de 76 campos). Además, en f11 sin alias leyó una línea tapada con confianza (1 inventada) y en f03 sin alias omitió el número.
- En los dos, la cabecera de s09 con alias sale ✓ porque el modelo trae el proveedor de los ejemplos few-shot, que es el mismo de la verdad. Por eso no cuenta como fuga (la fuga exige que el campo difiera de la verdad) ni como inventado. Ver el caos 6.1.

**Modelos con medición parcial.** Las métricas son "solo sobre lo medido", con el código de la corrida indicada (las de 3.6 y 3.8 son del HEAD `7f37c31`). El agregado del informe cuenta lo pendiente como fallo total. Con tan pocas facturas, no se pueden comparar con los lite.

| Modelo | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal | Fugas few-shot | p95 1 pág. | $/factura | Cobertura |
|--------|----------|--------|-----------|---------|-----------------|----------------|------------|-----------|-----------|
| gemini-3.6-flash (14 facturas, sin alias) | 92,7 % | 95,3 % | 92,3 % | 86,0 % | 0 % | — | 44,4 s ✗ | $0,0125 ✗ | 14/51 |
| gemini-3.8-flash (2 facturas, sin alias) | 100 % | 100 % | 100 % | 92,9 % | 0 % | — | 41,6 s ✗ | $0,0127 ✗ | 2/51 |
| gemini-2.5-flash (1 factura, 15-10) | 100 % | 100 % | 100 % | 100 % | 0 % | — | 14,9 s | $0,0085 | 1/51 |
| gemini-2.5-flash-lite | — | — | — | — | — | — | — | — | 0/51 (404) |
| claude-haiku-4-5 | No verificado | | | | | | | | 0/51 |
| claude-haiku-5-5 | No verificado | | | | | | | | 0/51 |

3.6-flash y 3.8-flash incumplen la meta de tiempo y la de costo con lo medido. Además, el 16-10 dieron 503 en la mitad de las llamadas, y su precio sube el 2027-01-01 (tabla `MODEL_PRICES_USD_PER_MTOK`).

### Medición inicial (2026-10-15) frente a la actual

| Modelo · bucket | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal |
|-----------------|----------|--------|-----------|---------|-----------------|
| 3.5-flash-lite · sin alias, inicial → actual | 94,3 → 98,4 % | 97,5 → 99,5 % | 97,0 → 99,0 % | 87,2 → 88,6 % | 0 → 0 % |
| 3.5-flash-lite · con alias, inicial → actual | **94,7** → 100 % | 96,3 → 100 % | 96,3 → 100 % | 93,3 → 96,1 % | 0 → 0 % |
| 3.1-flash-lite · sin alias, inicial → actual | 94,3 → 97,6 % | 97,0 → 99,0 % | 92,9 → 94,8 % | 87,2 → 88,6 % | 0 → 0 % |
| 3.1-flash-lite · con alias, inicial → actual | 94,4 → 94,7 % | 96,2 → 96,2 % | 96,1 → 96,1 % | 91,1 → 91,2 % | 0 → 0 % |

La medición inicial es la de `runs/2026-10-15-google-gemini-<modelo>-resume.md`, recalculada solo sobre lo medido (en 3.1 sin f10 con alias; en la actual f10 cuenta como fallo). Con esa medición, **3.5-flash-lite no cumplía la cabecera con alias (94,7 % < 95 %)**.

Las extracciones son las mismas: no se volvió a llamar al modelo ni se tocó ninguna salida. Lo que cambió es el banco y el emparejamiento:

1. **F3, definición del banco** (`93037d1`). `occludedHeaderFields` declara lo que la foto no permite leer: la fecha de f03 (la tapa el pulgar) y los cuatro campos de cabecera de s09 (foto casi ilegible a propósito), con todas las líneas de s09 `occluded`. Omitir un campo ocluido cuenta como acierto y traerlo distinto de la verdad cuenta como fallo (inventado). La regla es la misma para todos los modelos y se decide mirando la foto, no lo que devolvió un modelo: **no es etiquetar salidas**. La verdad conserva el valor real para detectar lo inventado. Esto explica la subida de la cabecera (s09 y la fecha de f03) y la de líneas y exactitud (las 4 líneas de s09 ya no cuentan como perdidas).
2. **Emparejamiento recalculado con el código actual** (it1, it2, F4, F5). Cada corrida original usaba el `match.ts` que había al lanzarla. F5 además hace que los `previousScans` del banco lleven la fecha y el total leídos, y con eso el posible duplicado de F4 también se ve en el banco.

### p95 y costo por el BFF (modelo por defecto, 2026-10-16)

Se midió por el camino real, no por el banco:

- **Servidor**: `next dev` del HEAD `7f37c31` contra el lab (`.env.stock-lab`), con `INVOICE_SCAN_PROVIDER=google` y sin `INVOICE_SCAN_MODEL`.
- **Petición**: `POST /api/purchases/invoice-scan` multipart con Bearer del usuario lab `eval-facturas-admin@eval.local` (admin, con `purchases.create`).
- **Fotos**: reales, comprimidas como el cliente (JPEG, lado mayor ≤ 1600 px, ≤ 1 MB) y todas distintas, para que ninguna caiga en la caché por hash.
- **Modelo**: todas las filas de `invoice_scans` registran `model = gemini-3.5-flash-lite`.
- **Medidas**: la duración es `invoice_scans.duration_ms` (el tiempo de pared por HTTP añade unos 0,3 s). El costo sale de los tokens de la fila con `estimateCostUsd`.

| Tanda | Facturas | p95 (rango más cercano) | Mediana | $/factura (media) | Fallos |
|-------|----------|-------------------------|---------|-------------------|--------|
| 1 (pedida: 5 facturas) | f01, f04, f12, f18, f21 | **26,1 s ✗** (f12, 41 líneas) | 10,0 s | $0,0049 ✓ | 0 |
| 2 (control) | f02, f06, f08, f15, f19 | — | — | — | f02: TIMEOUT a los 45 s → 502 `INVOICE_SCAN_PROVIDER_ERROR` |
| 1 + 2 (9 correctas de 10) | | 26,1 s ✗ (45 s con el timeout) | 9,7 s | $0,0038 ✓ | 1/10 |

- **El costo cumple la meta (≤ $0,01)**. Solo una factura larga como f12 (41 líneas, 5.799 tokens de salida, $0,0152) la supera por sí sola.
- **El p95 por el BFF no cumple la meta (≤ 15 s)**: f04 tardó 16,6 s y f12 26,1 s, y f02 agotó los 45 s. Las líneas extraídas coinciden con la verdad en número (6, 5, 41, 1 y 1).
- **Por qué el banco da 6,8 s y el BFF no**:
  - el BFF añade poco: la diferencia entre la pared HTTP y `duration_ms` es de unos 0,3 s;
  - la latencia del modelo del 16-10 fue mucho mayor: hasta las facturas de 1 línea tardan unos 8,5 s, frente a 2,5 s en la corrida del banco;
  - ese mismo día 3.6-flash y 3.8-flash dieron 503 en la mitad de las llamadas.
  - Con free tier no se puede separar la carga de Google de la latencia propia del modelo.
- El escaneo fallido (f02) queda `failed` con `usage_pages = 1`: consume cupo diario aunque no lea nada.
- Evidencia: `.notes/factura-escaneo/cierre/CIE-04/` del repo principal (`bff-requests.log`, `bff-invoice_scans.txt`, `bff-p95-costo.txt`). Los 10 escaneos y sus imágenes se borraron del lab al terminar.

### Recomendación

**`INVOICE_SCAN_MODEL=gemini-3.5-flash-lite` (el default), de forma provisional.**

- En el banco cumple todas las metas del §10: cabecera 98,4 % / 100 %, líneas 99,5 % / 100 %, exactitud 99,0 % / 100 %, emparejamiento 88,6 % / 96,1 %, 0 % confirmadas mal, 0/19 fugas y $0,0036 por factura.
- El 16-10 se volvió a medir con HEAD `7f37c31` y no empeora ninguna métrica.
- **Condición pendiente: el tiempo.** Por el BFF, el p95 de 5 facturas fue 26,1 s y hubo 1 timeout en 10. Antes de abrir el escaneo a tiendas reales hay que:
  1. pasar la key a plan de pago (D18; además, en free tier Google puede usar los datos);
  2. repetir la medición del BFF con ≥ 20 facturas para que el p95 no sea simplemente el máximo.
  - Si con plan de pago sigue por encima de 15 s, la meta de tiempo queda incumplida para este modelo y hay que revisar el timeout de 45 s y el aviso al usuario.
- **Alternativa más barata: `gemini-3.1-flash-lite`** ($0,0024 por factura, p95 de banco 7,9 s). Tiene la exactitud más baja (94,8 % frente a 99,0 % sin alias) y el emparejamiento con alias más bajo (91,2 % frente a 96,1 %). Además, el timeout con few-shot en f10 lo deja fuera de la meta de cabecera con alias, e inventó una línea tapada en f11.
- **3.6-flash y 3.8-flash no son alternativa**: con lo medido incumplen tiempo y costo, y dieron 503 frecuentes.
- **Cuándo revisar la recomendación**:
  - al medir Haiku 4.5 y 5.5 (hace falta `ANTHROPIC_API_KEY`);
  - al completar 3.6-flash y 3.8-flash, con el mismo comando: `npm run invoice-eval -- --provider google --model <id> --resume --concurrency 1`. La caché hace que solo se llame por lo pendiente. Con free tier caben unas 5 llamadas por día y modelo.
  - al repetir el p95 por el BFF con la key de pago.
- **Fine-tuning.** En Vertex, el modelo ajustable de la familia lite es Gemini 3.1 Flash-Lite. 3.5-flash-lite no figura como ajustable según el research de precios y tuning (los ajustables son `gemini-3.5-flash`, 3.1 Flash-Lite y los 2.5). Hoy el ajuste **no se justifica**: el emparejamiento sin alias de 3.5-flash-lite es 88,6 %, por encima de la meta del 70 %, y las capas de alias y few-shot ya llevan el bucket con alias al 96,1 %.

### Emparejamiento con oráculo

`npm run invoice-eval -- --provider oracle` usa la verdad de `truth/` como extracción: 0 llamadas a la IA, tokens y costo `null`, duración 0. Así mide **solo el emparejamiento** (proveedor, producto, alias, empaque) con una lectura perfecta. **No es una métrica del modelo**: el informe lo marca con un aviso, y cabecera, líneas, exactitud, tiempo y costo salen como "n/a (oráculo)". Sirve para iterar las reglas de emparejamiento sin gastar cuota.

Estado actual (`runs/2026-10-16-oraculo-solo-emparejamiento-cie04.md`, HEAD `7f37c31`): emparejamiento 96,8 % sin alias y 98,1 % con alias, 0 % confirmadas mal, duplicados 4/4 sin falsos positivos. Coincide con it1 "después": it2, F4, F5, la UI, CIE-02 y CIE-03b no lo mueven. Lo único que cambia es que en "con alias" las confirmadas correctas suben de 32 a 75 (alias por clave estable).

### Iteraciones de ajuste (SCN-11)

En cada iteración solo se cambian el prompt, el schema o las reglas de emparejamiento. Como máximo se hacen 5 iteraciones, o menos si se alcanzan las metas. **Nunca se etiqueta una salida del modelo como verdad.** Las verdades de `truth/` solo cambian si al revisar la foto aparece un error de lectura humana, y ese cambio queda registrado en `manifestDiffs`.

**Total: 3 iteraciones de reglas (it1, it2 y F4/F5) y 1 de prompt (it3), es decir, 4 de 5.**

#### Iteración 1 (2026-10-15, oráculo): segunda pasada difusa

- Qué cambió: segunda pasada difusa con textos limpios (sin marcadores de empaque ni prefijos, y con la unidad separada del número) solo para las líneas sin ningún candidato, en `src/modules/invoice-scan/server/loadMatchContext.ts` y `src/modules/invoice-scan/server/match/searchText.ts`.
- Informe antes: `runs/2026-10-15-oraculo-solo-emparejamiento-it1-antes.md` · Informe después: `runs/2026-10-15-oraculo-solo-emparejamiento-it1-despues.md`

| Métrica | Bucket | Antes | Después |
|---------|--------|-------|---------|
| Emparejamiento correcto (conf. + dudosa) | sin alias | 85,1 % | 96,8 % |
| Emparejamiento correcto (conf. + dudosa) | con alias | 96,2 % | 98,1 % |
| Confirmadas mal | sin alias / con alias | 0 % | 0 % |
| Sin emparejar (producto en catálogo) | sin alias | 28 | 6 |
| Sin emparejar (producto en catálogo) | con alias | 4 | 2 |

- Qué mejoró: 24 líneas pasan de sin emparejar a dudosa con el candidato correcto; ninguna otra línea cambia.
- Qué empeoró: nada.
- Pendiente: 6 líneas siguen sin emparejar (Ketchup, Solera, Papa rayada, Samy, Fanta y Protector). Arreglarlas pide bajar el umbral o cambiar la medida de similitud en SQL.
- Decisión: **se mantiene**.

#### Iteración 2 (2026-10-15, oráculo): D17, el SKU o el código de barras exacto confirma

- Qué cambió (`682aec7`): un SKU del proveedor o un código de barras exacto confirma la línea si viene por unidad o con un empaque registrado. Con un empaque declarado que no está registrado, la línea queda dudosa ("No hay empaque registrado de N unidades"). Un código de barras de dos productos deja la línea dudosa y sin producto. El mock del contexto tiene la misma segunda pasada difusa que `loadMatchContext`.
- Informe antes: `runs/2026-10-15-oraculo-solo-emparejamiento-it2-antes.md` · Informe después: `runs/2026-10-15-oraculo-solo-emparejamiento-it2-despues.md`

| Métrica | Bucket | Antes | Después |
|---------|--------|-------|---------|
| Emparejamiento correcto | sin alias / con alias | 96,8 % / 98,1 % | 96,8 % / 98,1 % |
| Confirmadas correctas | sin alias / con alias | 0 / 32 | 0 / 32 |
| Confirmadas mal | sin alias / con alias | 0 % / 0 % | 0 % / 0 % |
| Sin emparejar | sin alias / con alias | 6 / 2 | 6 / 2 |

- Por qué es neutro en el banco: las 69 líneas por SKU y las 32 por código de barras del banco son todas de empaque (bulto o caja de 6, 12, 20 o 24), y el escenario no registra empaques del proveedor para esos productos. Por eso siguen dudosas. Para que D17 se note en el banco habría que sembrar esos empaques en el lab.
- Qué empeoró: nada.
- Decisión: **se mantiene** (la regla vale en producción, donde los empaques sí se registran).

#### Iteración 3 (2026-10-15/16, prompt, 3.5-flash-lite y 3.1-flash-lite)

- Qué cambió (`0e0862f`): solo `src/modules/invoice-scan/server/prompt.ts`, con dos variantes de reglas generales que mantienen intactas las defensas de §6.1 y §6.3.
  - **A**: el número es el del bloque de la fecha bajo "FACTURA" y no los internos de caja; la fecha se lee siempre con el día primero; la cantidad es la impresa, sin multiplicar por unidades del empaque, y sin cantidad impresa es 1.
  - **B**: A, más "el número dentro de un empaque es `unitsPerPack`, nunca la cantidad".
- Árbitro: ninguna métrica puede bajar más de 1 punto en ningún bucket ni modelo mientras otra sube.
- Informes: base `runs/2026-10-15-replay-google-gemini-<modelo>-it3-antes.md`; variantes `runs/2026-10-15-google-gemini-3.5-flash-lite-it3-despues.md` (A), `…-it3-despues-b.md` (B) y `runs/2026-10-16-google-gemini-3.1-flash-lite-it3-despues-b.md`.

| Modelo · corrida (sin / con alias) | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal | p95 | $ |
|---|---|---|---|---|---|---|---|
| 3.5 base (replay) | 94,3 / 94,7 | 97,5 / 96,3 | 97,0 / 96,3 | 87,2 / 93,3 | 0 / 0 | 6,8 s | 0,0036 |
| 3.5 A | 94,3 / **93,4** | 97,0 / 96,3 | **93,4** / 96,3 | 87,2 / 93,3 | 0 / 0 | 5,2 s | 0,0036 |
| 3.5 B | 94,3 / **93,4** | 97,5 / 96,3 | **94,9** / 96,3 | 87,8 / 92,4 | 0 / 0 | 5,2 s | 0,0038 |
| 3.1 base (replay) | 94,3 / 89,5 | 97,0 / 92,7 | 92,9 / 92,5 | 87,2 / 87,6 | 0 / 0 | 7,9 s | 0,0024 |
| 3.1 B | 88,6 / 93,4 | 92,5 / 96,3 | 88,9 / 96,3 | 82,9 / 91,4 | 0 / 0 | 16,9 s | 0,0025 |

Estos números son anteriores a F3: la cabecera todavía exigía los campos ocluidos de f03 y s09.

- Qué mejoró: la fecha de f19 (3.5, con A y B) y las cantidades de f05 (3.1, con B).
- Qué empeoró:
  - 3.5: la exactitud sin alias y la cabecera con alias bajan más de 1 punto con A y con B.
  - 3.1 B: tuvo 3 timeouts, que cuentan como fallo total, y en s09 sin alias **inventó** proveedor, total y 4 líneas sobre la foto ilegible.
  - El número de f22 no cambió con ninguna de las dos.
- Decisión: **se revierte** el prompt (lo decide el árbitro). La caché de la base sigue valiendo con el prompt revertido.

#### F4/F5 (2026-10-16): reglas del caos (duplicados y RIF)

- Qué cambió:
  - **F4** (`b1f7f6e`, caos 5.4): **posible duplicado**. Cuando no hay coincidencia exacta por número normalizado, se marca si coinciden el proveedor y el total (±0,01) y además el número difiere en un solo carácter con la misma fecha, o no se leyó número y coincide la fecha (o tampoco hay fecha). `normalizeInvoiceNumber` quita etiquetas (FACTURA, N°, NRO) y un número de solo ceros o "S/N" cuenta como sin número.
  - **F5** (`472bfa4`): la resolución del proveedor por RIF exige la misma letra cuando las dos partes la traen (`sameTaxId`), así una cédula V y un RIF J con los mismos dígitos ya no se confunden. F4 ya aplicaba lo mismo a los duplicados.
  - **F5, banco** (`ca6a83f`): los `previousScans` del banco llevan la fecha y el total leídos, como en producción.
- Informes: `runs/2026-10-16-replay-google-gemini-3.1-flash-lite-f3.md` frente a `…-f5.md`; oráculo `runs/2026-10-16-oraculo-solo-emparejamiento-f3.md` frente a `…-f5.md`.

| Métrica | Bucket | Antes (f3) | Después (f5) |
|---------|--------|------------|--------------|
| Duplicados detectados, 3.1-flash-lite | sin alias | 1/2 (f03 no detectado: sin número) | 2/2 (FP 0) |
| Duplicados detectados, 3.1-flash-lite | con alias | 2/2 | 2/2 |
| Resto de métricas, 3.1-flash-lite y oráculo | ambos | — | sin cambio |

- Qué empeoró: nada; ningún falso positivo (f11/f14 siguen sin marcarse).
- Decisión: **se mantienen**.

### Caos acotado

0 hallazgos altos. Evidencia en `.notes/factura-escaneo/evaluacion/caos/` del repo principal.

| Caso | Severidad | Hallazgo | Estado |
|------|-----------|----------|--------|
| 5.4 Duplicados | Medio | La detección dependía de leer el número igual: 3.1 omitió el número de f03 y el duplicado no salió | Corregido en F4 (posible duplicado por proveedor + total + fecha, número a un carácter) |
| 5.4 Duplicados | Bajo | `normalizeInvoiceNumber` no quitaba "N°"/"FACT" y trataba "S/N" y "0" como números | Corregido en F4 |
| 5.4 Duplicados | Bajo | `normalizeTaxId` descartaba la letra: cédula V y RIF J con los mismos dígitos eran el mismo proveedor | Corregido en F4 (duplicados) y F5 (resolución del proveedor) |
| 5.4 Duplicados (banco) | Bajo | En "con alias", `pairConsistency` salía ✗ incluso en el oráculo, y `previousScans` usaba el contacto de la verdad | Corregido en F3: en "con alias" se compara solo la extracción y nunca se usa el contacto de la verdad |
| 6.1 Borrosa | Bajo | Con few-shot, el modelo copia el proveedor de los ejemplos en una foto ilegible (s09) | Medido: métrica `fewShotLeak` (F3). Hoy 0/19 y 0/18, porque en s09 lo copiado coincide con la verdad |
| 6.2 No factura | — | Pasa; el nombre basura llega a `supplier.name` con 0 líneas, sin efecto | Observación, sin cambio |
| 6.3 Inyección | Bajo | Una fila impresa con cantidad e importe que parece una orden se descarta en vez de copiarse | Abierto (propuesta de regla de prompt); ninguna inyección cambió total, RIF ni líneas |
| Robustez del banco | Bajo | Un `predicted` con nulls en `--replay` tumbaba la corrida entera | Corregido en F3 (`REPLAY_INVALID` por factura) |

Pares duplicados (F6): `pairConsistency` ignora los campos de `occludedHeaderFields` que un lado omite; con el replay de 3.5-flash-lite los pares consistentes pasan de 1/4 a 3/4 (f07/f16 sin alias difiere en 1 emparejamiento); oráculo 4/4.

---

## Dataset para fine-tuning (opcional)

Hoy el modelo **no se entrena**: aprenden las capas de alias y de few-shot. El exportador deja listo el dataset por si el banco algún día justifica un ajuste supervisado (SFT) de Gemini en Vertex AI, **pero no ejecuta ningún entrenamiento ni sube nada a Google**. Solo escribe archivos JSONL locales.

### Comando

```bash
npm run invoice-eval:export-finetune -- --store eval-facturas --gcs-prefix gs://mi-bucket/invoice-scans \
  [--out <file.jsonl>] [--since 2026-10-01] [--validation-ratio 0.1] [--download-dir <dir>] \
  [--env-file .env.stock-lab] [--allow-remote]
```

| Opción | Uso |
|--------|-----|
| `--store <id\|slug>` | Obligatoria. La tienda de la que se leen los `invoice_scans` con `status = 'confirmed'`. El store_id lo resuelve el script contra `stores`. |
| `--gcs-prefix gs://bucket/prefijo` | Obligatoria. El `fileUri` de cada página es `<prefijo>/<storage_path>`. |
| `--out` | Debe terminar en `.jsonl`. Por defecto escribe `.notes/factura-escaneo/evaluacion/finetune/<fecha Caracas>.jsonl`. |
| `--since YYYY-MM-DD` | Solo exporta los escaneos con `created_at` desde ese día (medianoche de Caracas, -04:00). |
| `--validation-ratio` | Un valor en [0, 1); por defecto 0,1. El reparto es determinista por hash SHA-256 del id y escribe además `<out>.validation.jsonl`. |
| `--download-dir` | Copia las imágenes del bucket privado `invoice-scans` para subirlas después a GCS. |
| `--env-file` | Por defecto `.env.stock-lab`. |
| `--allow-remote` | Obligatoria si Supabase no es local. Aun así, el script solo lee. |

El script nunca imprime claves.

**Qué se exporta.** `invoice_scans.confirmed` tiene la forma D10 (`buildConfirmedPayload` en `confirmScan.server.ts`): `{ extraction, lines, confirmedAt, purchaseId, supplierId }`. La salida de cada ejemplo es `confirmed.extraction` tal cual, validada con `invoiceExtractionSchema`; las claves ajenas al schema se descartan. `lines`, `productId`, `supplierId`, `purchaseId`, los alias y las fechas nunca pasan a la salida. Por compatibilidad, un `confirmed` que ya es un `InvoiceExtraction` desnudo (forma anterior a D10) se acepta tal cual. Un ejemplo se **omite** si:

- `confirmed` está vacío o `confirmed.extraction` es `null` ("confirmed.extraction vacío");
- `confirmed.extraction` no cumple el schema;
- `confirmed` tiene una forma desconocida, por ejemplo la anterior con solo `lines`, que ya no se reconstruye;
- la extracción contiene un UUID (id interno);
- las imágenes no cumplen los límites o el `storage_path` no sigue la convención multipágina;
- el `storage_path` no empieza por `<store_id>/` de la tienda exportada ("storage_path fuera de la tienda exportada", CIE-08): se omite antes de descargar nada con service role. Hoy el check `invoice_scans_storage_path_scope` (19g) ya impide esa fila en la base.

El resumen final indica cuántos ejemplos se omitieron y por qué. Con `--validation-ratio` > 0 siempre se escribe `<out>.validation.jsonl`; con pocos ejemplos puede salir **vacío** (0 bytes), porque el reparto por hash no garantiza que alguno caiga en validación (con 2 ejemplos y ratio 0,1, ninguno cayó).

**Aviso de privacidad.** El `fileUri` **incluye el store_id**, porque forma parte de `storage_path` (`<store>/<sha>/p1.<ext>`, y `p2`… en las facturas de varias páginas). El JSONL y el bucket identifican a la tienda, así que se tratan como datos privados.

### Formato (Vertex AI, consultado el 2026-10-15)

Cada línea es un ejemplo:

- `systemInstruction`: solo partes `text`.
- `contents`: un turno `user` y un turno `model`.
  - El turno `user` lleva una parte `fileData {mimeType, fileUri}` por cada página y una parte `text` con la instrucción.
  - El turno `model` lleva una parte `text` con el JSON de la extracción confirmada.
- Cada parte lleva `text` o `fileData`, nunca los dos.

Documentación oficial (las URL `cloud.google.com/...` redirigen a `docs.cloud.google.com/...`):

- Preparar datos: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning-prepare
- SFT y límites: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning
- Usar SFT: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-use-supervised-tuning
- Tuning con imágenes: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/tune_gemini/image_tune

**Modelos ajustables hoy**: `gemini-3.5-flash`, Gemini 3.1 Flash-Lite, Gemini 2.5 Pro, 2.5 Flash y 2.5 Flash-Lite. Para 3.5 Flash y 3.1 Flash-Lite el ajuste se hace en `us-central1` o `europe-west4`. `gemini-3.6-flash` y `gemini-3.8-flash` **no** figuran como ajustables.

**Límites que aplica el exportador**:

| Límite | Valor |
|--------|-------|
| Imágenes por ejemplo | ≤ 30 |
| Tamaño por imagen | ≤ 20 MB (solo se comprueba al descargar) |
| Tokens por ejemplo (entrada + salida) | ≤ 131.072, con una estimación conservadora |
| Ejemplos de validación | ≤ 5.000 |

Otros límites de Vertex: archivo de entrenamiento de 1 GB como máximo y dataset de 300K ejemplos multimodales como máximo. La doc no fija un mínimo duro; recomienda empezar con 100–500 ejemplos.

**Sin confirmar**: el precio de `gemini-3.5-flash` en Vertex, el precio del entrenamiento SFT y el de inferencia del modelo ajustado.

### Qué haría falta para ejecutarlo (no se ejecuta)

1. Una cuenta de Google Cloud con facturación activa y Vertex AI habilitado.
2. Un bucket `gs://` **privado**. Nunca URLs públicas: son facturas de la tienda.
3. Exportar con `--download-dir`, subir las imágenes con `gsutil -m cp -r <dir>/* gs://mi-bucket/invoice-scans/` y subir también los JSONL al bucket. Vertex exige que el dataset esté en GCS.
4. Reunir al menos 100–500 ejemplos confirmados. El banco actual (32) no alcanza.
5. Lanzar el ajuste SFT sobre un modelo ajustable y **reevaluar el modelo ajustado con este banco** antes de usarlo. Solo se adopta si mejora las métricas del §10, sobre todo `confirmedWrongRate`, sin subir el costo por encima de la meta.

---

## Despliegue

Nada de esto está en producción. Producción y la tienda Las Luces no se tocan desde el plan: el despliegue lo hace el dueño.

### 1. Parches SQL

Se aplican en este orden en el SQL Editor. Todos son idempotentes y terminan con `notify pgrst, 'reload schema';`. `build-deploy-sql.test` solo exige en sus listas los parches del plan ux-mejoras (de `20261007a` a `20261018a`) e ignora todos los posteriores (`20261019*` y `20261020a`), así que **no** están en `supabase/patches/deploy/` y se aplican uno a uno. No hay 19f, 19h ni 19j.

| # | Parche | Qué hace |
|---|--------|----------|
| 1 | `20261019a-invoice-scans.sql` | Tabla `invoice_scans`, RLS de solo lectura (`purchases.view`) y bucket privado `invoice-scans`. En Storage solo crea la política de lectura y borra (`drop policy if exists`) la de insert que creaban versiones anteriores: nadie sube directo por la API de Storage (CIE-08) |
| 2 | `20261019b-supplier-product-aliases.sql` | `pg_trgm`, tabla `supplier_product_aliases`, `claim_` / `release_invoice_scan_claim`, `confirm_invoice_scan` y `learn_invoice_aliases`. CIE-06: un reclamo cuya clave ya creó su compra no caduca (otra clave recibe PT409 "Esta factura ya se registró en otra compra") y `release_invoice_scan_claim` no lo suelta |
| 3 | `20261019c-invoice-scan-orphans.sql` | `list_expired_invoice_scan_objects`: imágenes subidas sin fila, para la purga |
| 4 | `20261019d-invoice-match-candidates.sql` | `invoice_match_norm` e `invoice_match_candidates`: proveedores y candidatos por trigram |
| 5 | `20261019e-invoice-scan-reserve.sql` | Estado `processing`, `usage_pages` y `reserve_invoice_scan`: reserva y cuota atómicas |
| 6 | `20261019g-invoice-scan-writes-lockdown.sql` | Quita las escrituras directas, añade checks de ruta y cuota y crea `complete` / `fail` / `discard_invoice_scan`; redefine `reserve_invoice_scan` |
| 7 | `20261019i-invoice-scan-service-only.sql` | RPCs de escritura solo para `service_role`, `attempt_id` y tope de 512 KB; redefine reserve, complete, fail y discard |
| 8 | `20261019k-invoice-scan-claim-guard.sql` | El descarte respeta el reclamo de la compra en curso (PT409) y la reserva exige usuario de la tienda; redefine reserve y discard. CIE-06: el descarte también da PT409 "Esta factura ya tiene una compra registrada y no se puede descartar." si la clave del reclamo ya creó su compra, aunque el reclamo haya caducado |
| 9 | `20261020a-supplier-alias-remove.sql` | `remove_supplier_product_alias` (quitar un alias desde el proveedor) |

**Cadena de reaplicación.** Varias funciones se redefinen en parches posteriores; la versión vigente es la del último:

| Función | Se define en | Vigente |
|---------|--------------|---------|
| `reserve_invoice_scan` | 19e → 19g → 19i → 19k | 19k |
| `discard_invoice_scan` | 19g → 19i → 19k | 19k |
| `complete_invoice_scan`, `fail_invoice_scan` | 19g → 19i | 19i |
| `claim_invoice_scan`, `release_invoice_scan_claim`, `confirm_invoice_scan`, `learn_invoice_aliases` | 19b | 19b |

- Cadenas: **19a → 19g → 19i → 19k** y **19b → 19k**.
- Reaplicar 19a obliga a reaplicar después 19g, 19i y 19k. 19a ya no devuelve escrituras (solo concede select a `authenticated` y borra las políticas de insert y update de la tabla y la de insert de Storage), pero se mantiene el orden de despliegue.
- Reaplicar 19e o 19g (vuelven las firmas viejas concedidas a `authenticated`) obliga a reaplicar después 19i y 19k.
- Reaplicar 19i obliga a reaplicar después 19k.
- Reaplicar 19b obliga a reaplicar después 19k: las guardas de 19k leen las columnas del reclamo que crea 19b (sin ellas solo miran `purchase_id` y `confirmed`).
- 19b crea `invoice_scans` como respaldo solo si no existe (sin políticas); con 19a aplicado antes no hace nada. 19k funciona con y sin 19b, pero en despliegue 19b va antes.

### 2. Storage

El bucket **privado** `invoice-scans` lo crea 19a. No hay URLs públicas: subida y lectura con URL firmada (lectura de 5 minutos), y rutas siempre bajo `<store_id>/<sha256>/p<n>.<ext>`. No hay política de insert para `authenticated` (CIE-08): la subida firmada no pasa por RLS, así que un usuario no puede subir directo por la API de Storage.

### 3. Variables de entorno

`.env.local.example` no está versionado (`.gitignore` excluye `.env*`; solo se versiona `.env.stock-lab.example`), por eso las variables se documentan aquí. En Vercel van en Settings → Environment Variables.

| Variable | Valores | Por defecto | Notas |
|----------|---------|-------------|-------|
| `INVOICE_SCAN_PROVIDER` | `google` \| `anthropic` \| `mock` | `google` | Si falta la key del proveedor pedido se usa el otro (con su modelo por defecto). Sin ninguna key, con datos en Supabase el escaneo responde 503 sin reservar ni cobrar (CIE-08); `mock` solo si se pide explícito o con datos mock. |
| `INVOICE_SCAN_MODEL` | id del modelo | `gemini-3.5-flash-lite` (google) · `claude-haiku-5-5` (anthropic) | D22 / CIE-01. No cambia el modelo del asistente (`ASSISTANT_MODEL`, que conserva su propio default). |
| `INVOICE_SCAN_MOCK_MODE` | `ok` \| `error` \| `timeout` \| `empty` \| `invalid` | `ok` | Solo QA y caos, y solo con el proveedor mock (`mockModel.ts`): `ok` devuelve la factura de fixture, `error` un fallo del proveedor (502), `timeout` no responde hasta que se aborta, `empty` "no es factura" (sin líneas y con aviso) e `invalid` un JSON que no cumple el schema. Un valor desconocido vale `ok`; se lee en cada llamada. No se configura en producción. |
| `INVOICE_SCAN_DAILY_LIMIT` | entero | `50` | Páginas por tienda y día operativo de Caracas; máximo 10000. Un valor no numérico vuelve a 50. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | key | — | Ya existe por el asistente. Debe estar en plan de pago: en free tier Google puede usar los datos y la cuota diaria corta el escaneo (D18). |
| `ANTHROPIC_API_KEY` | key | — | Ya existe por el asistente; opcional. |
| `CRON_SECRET` | secreto | — | Ya existe; lo valida la purga igual que el auto-close de caja. |
| `SUPABASE_SERVICE_ROLE_KEY` | key | — | Ya existe; el BFF escribe `invoice_scans` y firma Storage con service role. |

### 4. Purga a 90 días

`.github/workflows/cash-auto-close.yml` tiene el job `invoice-scans-purge`. Corre a diario a las 08:30 UTC (04:30 Caracas) y también con `workflow_dispatch`. Llama a `POST /api/cron/invoice-scans/purge` con `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. Primero borra las imágenes de Storage y después las filas, incluidas las imágenes huérfanas.

- **Hay que crear el secret `CRON_SECRET`** en GitHub (Settings → Secrets and variables → Actions) con el mismo valor que tiene Vercel. Sin él, la purga responde 401 y el job falla.
- **Aviso:** el job `auto-close` de `main` sigue con el valor de `CRON_SECRET` escrito en claro en el workflow (anterior a este plan, fuera de alcance, D14). Al rotar el secreto hay que cambiarlo en Vercel y en el secret de GitHub, y pasar ese job a `${{ secrets.CRON_SECRET }}`. Si no, el auto-close de caja empieza a fallar con 401.

### 5. Comprobación tras desplegar

1. `GET /api/purchases/invoice-scan/limits` con un usuario almacén → `{ used, limit, remaining }`.
2. Escanear una factura de prueba en una tienda que no sea Las Luces, confirmar la compra y comprobar `invoiceScan.confirmed: true`.
3. Lanzar a mano el workflow (Run workflow) y comprobar que la purga responde 200 con `{ deleted, objects }`.
