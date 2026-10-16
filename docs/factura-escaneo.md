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

Las metas son las del §10 del plan. Todas las llamadas a modelos se hicieron el 2026-10-15 (noche de Caracas) con la key de Gemini en free tier, que tiene cuota diaria por modelo, con `--resume --concurrency 1` y few-shot en "con alias". Por modelo hay 51 extracciones por medir: 32 sin alias (22 reales y 10 sintéticas) y 19 con alias y few-shot.

### Cobertura por modelo

| Modelo | Medidas (sin / con alias) | Pendientes | Motivo | Corrida original |
|--------|---------------------------|------------|--------|------------------|
| gemini-3.5-flash-lite | 32/32 · 19/19 | 0 | — | `runs/2026-10-15-google-gemini-3.5-flash-lite-resume.md` |
| gemini-3.1-flash-lite | 32/32 · 18/19 | 1 | f10 con alias: timeout dos veces (con 3 imágenes de few-shot pasa de los 45 s de `extractInvoice`). No es cuota. | `runs/2026-10-15-google-gemini-3.1-flash-lite-resume.md` |
| gemini-3.6-flash | 9/32 · 0/19 | 42 | Cuota diaria (429) tras unas 10 llamadas y un 503 en f05 | `runs/2026-10-15-google-gemini-3.6-flash.md` |
| gemini-2.5-flash | 1/32 · 0/19 | 50 | Cuota diaria ya agotada (429 desde la 1.ª llamada nueva) | `runs/2026-10-15-google-gemini-2.5-flash-2.md` |
| gemini-3.8-flash | 1/32 · 0/19 | 50 | 503, timeout y cuota diaria (429) | `runs/2026-10-15-google-gemini-3.8-flash-2.md` |
| gemini-2.5-flash-lite | 0 | 51 | 404: la key no tiene acceso al modelo. Los modelos 2.5 solo se sirven a proyectos que ya los usaban. | `runs/2026-10-15-google-gemini-2.5-flash-lite-sonda.md` |
| claude-haiku-4-5 / claude-haiku-5-5 | 0 | 51 / 51 | **Sin medir**: `ANTHROPIC_API_KEY` está vacía en el archivo de keys | — |

### Medición actual (código de HEAD `ca6a83f`, replay de las extracciones guardadas)

Los dos modelos lite tienen el banco completo (o casi) y se midieron de nuevo con `--replay` sobre sus corridas originales: las extracciones son exactamente las mismas (0 llamadas) y el emparejamiento, la cabecera y las métricas se recalculan con el código y el banco actuales. Tokens, p95 y costo salen de la corrida original. El qa-final reprodujo los números de 3.5-flash-lite con `--resume` desde la caché (51 de caché, 0 llamadas nuevas).

- 3.5-flash-lite: `runs/2026-10-16-replay-google-gemini-3.5-flash-lite-f3.md`.
- 3.1-flash-lite: `runs/2026-10-16-replay-google-gemini-3.1-flash-lite-f5.md`.

p95 y $/factura son de la corrida entera (la meta es sobre el total); van en la fila "sin alias" de cada modelo.

| Modelo · bucket | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal | Fugas few-shot | p95 1 pág. | $/factura | Cobertura |
|-----------------|----------|--------|-----------|---------|-----------------|----------------|------------|-----------|-----------|
| **Meta §10** (sin / con alias) | ≥ 90 % / ≥ 95 % | ≥ 95 % | ≥ 90 % | ≥ 70 % / ≥ 90 % | ≤ 2 % | 0 | ≤ 15 s | ≤ $0,01 | 51/51 |
| gemini-3.5-flash-lite · sin alias | 98,4 % | 99,5 % | 99,0 % | 88,6 % | 0 % | — | 6,8 s | $0,0036 | 32/32 |
| gemini-3.5-flash-lite · con alias | 100 % | 100 % | 100 % | 96,1 % | 0 % | 0/19 | ↑ | ↑ | 19/19 |
| gemini-3.1-flash-lite · sin alias | 97,6 % | 99,0 % | 94,8 % | 88,6 % | 0 % | — | 7,9 s | $0,0024 | 32/32 |
| gemini-3.1-flash-lite · con alias | **94,7 % ✗** | 96,2 % | 96,1 % | 90,2 % | 0 % | 0/18 | ↑ | ↑ | 18/19 |

- **gemini-3.5-flash-lite cumple todas las metas** del §10 en los dos buckets. Duplicados 4/4 detectados, 0 falsos positivos; f07 y f09 sin líneas inventadas.
- **gemini-3.1-flash-lite falla solo la cabecera con alias**, y toda la diferencia viene de f10 con alias, que no tiene extracción por el timeout: cuenta como fallo total (4 de 76 campos). Además, en f11 sin alias leyó una línea tapada con confianza (1 inventada) y en f03 sin alias omitió el número. Duplicados 4/4 (f03 sin alias se detecta como posible duplicado, ver F4).
- En los dos, la cabecera de s09 con alias sale ✓ porque el modelo trae el proveedor de los ejemplos few-shot, que es el mismo de la verdad. Por eso no cuenta como fuga (la fuga exige que el campo difiera de la verdad) ni como inventado. Ver el caos 6.1.

**Modelos con medición parcial.** No tienen replay con el código actual: los números son los de la corrida original del 15-10 y solo cubren lo medido (el agregado del informe cuenta lo pendiente como fallo total). Con 1 o 9 facturas no se pueden comparar con los lite.

| Modelo | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal | Fugas few-shot | p95 1 pág. | $/factura | Cobertura |
|--------|----------|--------|-----------|---------|-----------------|----------------|------------|-----------|-----------|
| gemini-3.6-flash (9 facturas, sin alias) | 86,1 % | 90,2 % | 89,8 % | 87,8 % | 0 % | — | 27,1 s ✗ | $0,0116 ✗ | 9/51 |
| gemini-2.5-flash (1 factura) | 100 % | 100 % | 100 % | 100 % | 0 % | — | 14,9 s | $0,0085 | 1/51 |
| gemini-3.8-flash (1 factura) | 100 % | 100 % | 100 % | 100 % | 0 % | — | 41,6 s ✗ | $0,0110 ✗ | 1/51 |
| gemini-2.5-flash-lite | — | — | — | — | — | — | — | — | 0/51 (404) |
| claude-haiku-4-5 | sin medir | | | | | | | | 0/51 |
| claude-haiku-5-5 | sin medir | | | | | | | | 0/51 |

Aun con tan pocas facturas, 3.6-flash y 3.8-flash superan la meta de tiempo y la de costo. Además, su precio sube el 2027-01-01 (tabla `MODEL_PRICES_USD_PER_MTOK`).

### Medición inicial (2026-10-15) frente a la actual

| Modelo · bucket | Cabecera | Líneas | Exactitud | Emp. OK | Confirmadas mal |
|-----------------|----------|--------|-----------|---------|-----------------|
| 3.5-flash-lite · sin alias, inicial → actual | 94,3 → 98,4 % | 97,5 → 99,5 % | 97,0 → 99,0 % | 87,2 → 88,6 % | 0 → 0 % |
| 3.5-flash-lite · con alias, inicial → actual | **94,7** → 100 % | 96,3 → 100 % | 96,3 → 100 % | 93,3 → 96,1 % | 0 → 0 % |
| 3.1-flash-lite · sin alias, inicial → actual | 94,3 → 97,6 % | 97,0 → 99,0 % | 92,9 → 94,8 % | 87,2 → 88,6 % | 0 → 0 % |
| 3.1-flash-lite · con alias, inicial → actual | 94,4 → 94,7 % | 96,2 → 96,2 % | 96,1 → 96,1 % | 91,1 → 90,2 % | 0 → 0 % |

La medición inicial es la de `runs/2026-10-15-google-gemini-<modelo>-resume.md`, recalculada solo sobre lo medido (en 3.1 sin f10 con alias; en la actual f10 cuenta como fallo). Con esa medición, **3.5-flash-lite no cumplía la cabecera con alias (94,7 % < 95 %)**.

Las extracciones son las mismas: no se volvió a llamar al modelo ni se tocó ninguna salida. Lo que cambió es el banco y el emparejamiento:

1. **F3, definición del banco** (`93037d1`). `occludedHeaderFields` declara lo que la foto no permite leer: la fecha de f03 (la tapa el pulgar) y los cuatro campos de cabecera de s09 (foto casi ilegible a propósito), con todas las líneas de s09 `occluded`. Omitir un campo ocluido cuenta como acierto y traerlo distinto de la verdad cuenta como fallo (inventado). La regla es la misma para todos los modelos y se decide mirando la foto, no lo que devolvió un modelo: **no es etiquetar salidas**. La verdad conserva el valor real para detectar lo inventado. Esto explica la subida de la cabecera (s09 y la fecha de f03) y la de líneas y exactitud (las 4 líneas de s09 ya no cuentan como perdidas).
2. **Emparejamiento recalculado con el código actual** (it1, it2, F4, F5). Cada corrida original usaba el `match.ts` que había al lanzarla. F5 además hace que los `previousScans` del banco lleven la fecha y el total leídos, y con eso el posible duplicado de F4 también se ve en el banco.

### Recomendación

**`INVOICE_SCAN_MODEL=gemini-3.5-flash-lite`, de forma provisional.** En el banco cumple todas las metas del §10: cabecera 98,4 % / 100 %, líneas 99,5 % / 100 %, exactitud 99,0 % / 100 %, emparejamiento 88,6 % / 96,1 %, 0 % confirmadas mal, 0/19 fugas, p95 6,8 s y $0,0036 por factura.

- **Alternativa más barata: `gemini-3.1-flash-lite`** ($0,0024 por factura, p95 7,9 s). Tiene la exactitud más baja (94,8 % frente a 99,0 % sin alias), el emparejamiento con alias más bajo (90,2 % frente a 96,1 %, justo en la meta) y un timeout con few-shot (f10) que lo deja fuera de la meta de cabecera con alias. También inventó una línea tapada en f11.
- **Cuándo revisar la recomendación**:
  - al medir Haiku 4.5 y 5.5 (hace falta `ANTHROPIC_API_KEY`);
  - al completar 3.6-flash y 3.8-flash con una key de pago, con el mismo comando: `npm run invoice-eval -- --provider google --model <id> --resume --concurrency 1`. La caché hace que solo se llame por lo pendiente.
- **Fine-tuning.** En Vertex, el modelo ajustable de la familia lite es Gemini 3.1 Flash-Lite. 3.5-flash-lite no figura como ajustable según el research de precios y tuning (los ajustables son `gemini-3.5-flash`, 3.1 Flash-Lite y los 2.5). Hoy el ajuste **no se justifica**: el emparejamiento sin alias de 3.5-flash-lite es 88,6 %, por encima de la meta del 70 %, y las capas de alias y few-shot ya llevan el bucket con alias al 96,1 %.

### Emparejamiento con oráculo

`npm run invoice-eval -- --provider oracle` usa la verdad de `truth/` como extracción: 0 llamadas a la IA, tokens y costo `null`, duración 0. Así mide **solo el emparejamiento** (proveedor, producto, alias, empaque) con una lectura perfecta. **No es una métrica del modelo**: el informe lo marca con un aviso, y cabecera, líneas, exactitud, tiempo y costo salen como "n/a (oráculo)". Sirve para iterar las reglas de emparejamiento sin gastar cuota.

Estado actual (`runs/2026-10-16-oraculo-solo-emparejamiento-f5.md`): emparejamiento 96,8 % sin alias y 98,1 % con alias, 0 % confirmadas mal, duplicados 4/4 sin falsos positivos. Coincide con it1 "después": it2, F4 y F5 no lo mueven.

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
- las imágenes no cumplen los límites o el `storage_path` no sigue la convención multipágina.

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
