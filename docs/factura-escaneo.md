# Escaneo de facturas de compra

Documento del plan [`agent-prompts/factura-escaneo-gtm.md`](agent-prompts/factura-escaneo-gtm.md) (§9). Cada módulo escribe sus propias secciones.

## Índice

1. Cómo funciona (la completa el módulo Extracción / UI)
2. Las tres capas de aprendizaje (la completa el módulo Emparejamiento)
3. [Banco de evaluación](#banco-de-evaluación) (módulo Evaluación)
4. [Resultados por proveedor de IA](#resultados-por-proveedor-de-ia) (módulo Evaluación)
5. [Dataset para fine-tuning (opcional)](#dataset-para-fine-tuning-opcional) (módulo Evaluación)

---

## Cómo funciona

(la completa el módulo Extracción / UI)

## Las tres capas de aprendizaje

(la completa el módulo Emparejamiento)

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

`report.ts` escribe `<dir>/<YYYY-MM-DD>-<provider>[-n].md` y `.json` y nunca sobrescribe una corrida anterior. El informe trae:

- las metas del §10 con ✓/✗;
- los totales de cada bucket;
- el detalle por factura;
- los pares duplicados (un par cuya extracción falló sale "no evaluable (motivo)" con "—" en las demás columnas y no entra en el denominador de consistentes, que se muestra como "Consistentes: X/Y evaluables. No evaluables: Z.");
- los casos de no inventar (f07, f09);
- los errores.

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

Los informes se guardan como `<fecha Caracas>-<proveedor>-<modelo>[-label].md|.json`; el oráculo como `<fecha>-oraculo-solo-emparejamiento[-label]` y el replay como `<fecha>-replay-<proveedor>-<modelo>[-label]`. Nunca se sobrescribe una corrida.

Protecciones del CLI:

- **Supabase solo del lab local.** Se lee únicamente de `.env.stock-lab` del worktree y el CLI aborta si la URL no es `127.0.0.1` o `localhost`.
- **Solo las 2 keys de IA.** Del archivo de `--keys-env` (que apunta a producción) se leen solo `GOOGLE_GENERATIVE_AI_API_KEY` y `ANTHROPIC_API_KEY`, y solo la del proveedor pedido; nada más entra en `process.env` y las keys nunca se imprimen ni se escriben. El oráculo y el replay sin `--fill-missing` no leen el archivo.
- **Cerrojo.** Mientras corre se toma `.notes/factura-escaneo/lab.lock` del repo principal; si otro proceso lo tiene, el CLI aborta.
- **Cuota.** 3 errores de cuota seguidos cortan la pasada y el informe lo avisa.

---

## Resultados por proveedor de IA

Las metas son las del §10 del plan. La tabla por modelo se llena con los informes completos de `scripts/invoice-eval/runs/`.

### Corridas reales del 2026-10-15

- **gemini-2.5-flash** (`runs/2026-10-15-google-gemini-2.5-flash.md`, few-shot sí): cortada por la cuota free diaria (429) tras 3 facturas. En esas 3: cabecera 100 %, exactitud 16/16 líneas, p95 17,6 s, $0,0076 por factura. No sirve como resultado del modelo: 3 facturas no son el banco.
- **gemini-3.8-flash** (`runs/2026-10-15-google-gemini-3.8-flash.md`): sin respuestas (503/429); no hay métricas.
- **Haiku 4.5 y Haiku 5.5**: no corridos, porque `ANTHROPIC_API_KEY` está vacía en el archivo de keys.

La tabla por modelo queda **pendiente** hasta tener una corrida completa por modelo.

| Métrica (meta sin alias / con alias) | Gemini sin alias | Gemini con alias | Haiku sin alias | Haiku con alias |
|--------------------------------------|------------------|------------------|-----------------|-----------------|
| Cabecera correcta (≥ 90 % / ≥ 95 %) | | | | |
| Líneas detectadas (≥ 95 % / ≥ 95 %) | | | | |
| Cantidad y precio exactos (≥ 90 % / ≥ 90 %) | | | | |
| Confirmadas correctas o dudosas con candidato correcto (≥ 70 % / ≥ 90 %) | | | | |
| Confirmadas incorrectamente (≤ 2 % / ≤ 2 %) | | | | |
| Tiempo p95, 1 página (≤ 15 s) | | — | | — |
| Costo medio por factura (≤ $0,01) | | — | | — |

Por cada corrida que alimente la tabla se anotan el modelo exacto (`modelId`), la fecha, si fue con o sin few-shot y el informe de origen.

### Emparejamiento con oráculo

`npm run invoice-eval -- --provider oracle` usa la verdad de `truth/` como extracción: 0 llamadas a la IA, tokens y costo `null`, duración 0. Así mide **solo el emparejamiento** (proveedor, producto, alias, empaque) con una lectura perfecta. **No es una métrica del modelo**: el informe lo marca con un aviso, y cabecera, líneas, exactitud, tiempo y costo salen como "n/a (oráculo)". Sirve para iterar las reglas de emparejamiento sin gastar cuota.

#### Iteración 1 (2026-10-15, oráculo)

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
- Pendiente:
  - 6 líneas siguen sin emparejar: Ketchup, Solera, Papa rayada, Samy, Fanta y Protector. Arreglarlas pide bajar el umbral o cambiar la medida de similitud en SQL.
  - Sin alias hay 0 confirmadas: sin empaque registrado para el proveedor, la regla §3 deja la línea dudosa aunque traiga SKU o código de barras. Si el código de barras debe confirmar es decisión del gerente.
- Decisión: se mantiene.

### Iteraciones de ajuste (SCN-11)

En cada iteración solo se cambian el prompt, el schema o las reglas de emparejamiento. Como máximo se hacen 5 iteraciones, o menos si se alcanzan las metas. **Nunca se etiqueta una salida del modelo como verdad.** Las verdades de `truth/` solo cambian si al revisar la foto aparece un error de lectura humana, y ese cambio queda registrado en `manifestDiffs`.

Plantilla por iteración:

```markdown
#### Iteración N (AAAA-MM-DD, proveedor/modelo)

- Qué cambió:
- Informe antes: runs/… · Informe después: runs/…

| Métrica | Bucket | Antes | Después |
|---------|--------|-------|---------|
| … | sin alias / con alias | | |

- Qué mejoró:
- Qué empeoró:
- Decisión (se mantiene / se revierte / siguiente paso):
```

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

**Qué se exporta.** La salida de cada ejemplo es un `InvoiceExtraction` validado con `invoiceExtractionSchema` y sin ids internos: si aparece un UUID, el ejemplo se descarta. `confirmed` puede venir como extracción completa o como líneas confirmadas por Emparejamiento; en el segundo caso, la extracción se reconstruye desde `extracted`. Un ejemplo se **omite** en tres casos:

- alguna línea extraída no aparece en `confirmed`;
- el `rawText` confirmado no coincide con el extraído;
- una línea tiene dos tamaños de empaque.

El resumen final indica cuántos ejemplos se omitieron y por qué.

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
