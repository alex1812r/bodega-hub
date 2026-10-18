# Precarga de compras desde la foto de la factura — análisis de opciones (oct 2026)

Objetivo: al registrar una compra, fotografiar o subir la factura del proveedor y que el sistema proponga proveedor, fecha, número, líneas (producto, cantidad, costo, IVA) y totales, dejando al usuario confirmar línea a línea. Restricción: costo mínimo, preferiblemente cero.

## 1. Conclusión corta

**No hay que entrenar un modelo.** Entrenar (fine-tuning de Donut, LayoutLM o similares) exige cientos de facturas etiquetadas a mano, GPU, un pipeline de evaluación y mantenimiento cada vez que un proveedor cambia su formato; para una bodega con facturas heterogéneas (preimpresas, térmicas, manuscritas, fotos torcidas) es la peor relación costo/resultado. Un **modelo de visión generalista con salida estructurada** (Gemini Flash o Claude Haiku) lee hoy esas facturas sin entrenamiento, y la precisión real del sistema sale de dos cosas que sí controlamos: **el emparejamiento con nuestro catálogo** y **el aprendizaje por confirmación** (cada vez que el usuario confirma que "REF.MALTA 1.5 X6" es "Malta 1.5 Lt · caja de 6", el vínculo proveedor–producto guarda ese alias y la siguiente factura ya llega emparejada).

Arquitectura recomendada: Gemini Flash (free tier, ya integrado en el repo por el asistente) con `generateObject` del AI SDK y un schema Zod de factura → emparejamiento determinista contra `supplier_products` (SKU del proveedor, alias aprendidos, código de barras, nombre) → la compra se abre precargada con cada línea marcada **confirmada / dudosa / sin emparejar**. El cambio de proveedor de IA es una variable de entorno, como en el asistente.

Costo: **$0** con el free tier de Gemini (una factura son ~1–4 imágenes de 258 tokens por mosaico + ~1.500 tokens de salida; el límite diario del free tier sobra para decenas de facturas al día). Si el negocio no quiere que sus facturas se usen para entrenar modelos de Google, el plan de pago cuesta **menos de un centavo por factura**.

## 2. Opciones evaluadas

| Opción | Costo | Entrenamiento | Facturas manuscritas / térmicas / fotos torcidas | Líneas de detalle | Privacidad | Veredicto |
|--------|-------|---------------|-----------------------------------------------|-------------------|------------|-----------|
| **Gemini Flash / Flash-Lite (visión + JSON)** | Free tier: $0 (datos pueden usarse para entrenar). Pago: Flash-Lite $0,25–0,30 / M tokens entrada; Flash $0,75 / M hasta fin de 2026. Una factura ≈ 1–4 mosaicos × 258 tokens + prompt + ~1.500 salida → **< $0,005** | Ninguno | Bien: entiende contexto ("x6" es empaque, "EXENTO" es alícuota 0) | Sí, con schema | Free: no garantizada. Pago: no entrena | **Recomendada** |
| **Claude Haiku 4.5 (visión + JSON)** | $1 / M entrada, $5 / M salida → **≈ $0,005–0,01 por factura** | Ninguno | Bien | Sí | No entrena con datos de API | Alternativa de pago, misma integración (ya instalada) |
| Google Document AI – Invoice Parser | $0,10 por bloque de 10 páginas (redondea hacia arriba): **$0,10 por factura** de 1 página; sin free tier | Ninguno (modelo preentrenado de facturas) | Regular en manuscritas; bueno en preimpresas | Sí (descripción, cantidad, importe) | No entrena | Más caro que el LLM y sin ventaja real para facturas informales |
| Azure AI Document Intelligence – Invoice | $10 por 1.000 páginas (**$0,01 por factura**); F0 gratis 500 páginas/mes solo para pruebas | Ninguno; custom opcional (requiere etiquetar) | Regular en manuscritas | Sí | No entrena | Buena segunda opción si se quiere un servicio especializado; 500 gratis/mes cubrirían una bodega, pero F0 es "solo pruebas" según Microsoft |
| OCR libre (Tesseract / PaddleOCR) + reglas | $0, corre en el servidor | Ninguno, pero las reglas son por formato de factura | Mal en manuscritas y fotos torcidas; cada proveedor nuevo rompe las reglas | Parcial | Total (local) | Solo como respaldo offline; no como camino principal |
| OCR libre + LLM de texto | $0 OCR + tokens de texto | Ninguno | Hereda los errores del OCR | Sí | Mixta | Peor que mandar la imagen directo al modelo de visión; no vale la pena |
| Fine-tuning propio (Donut, LayoutLMv3, Florence) | GPU + horas + etiquetado de 200–500 facturas; mantenimiento | **Alto** | Depende del dataset; cada formato nuevo necesita más datos | Sí | Total (local) | **Descartado** para esta escala |
| Modelo de visión local (Qwen2-VL, LLaVA, Moondream vía Ollama) | $0 en una PC con GPU; Vercel no puede alcanzarla | Ninguno | Aceptable los grandes; flojos los pequeños | Sí | Total | Solo si algún día el BFF corre en una máquina del negocio |

Precios vigentes según las fuentes citadas al final; confirmar en la página oficial antes de activar facturación.

## 3. Cómo funciona (diseño)

```text
Foto / PDF de la factura (móvil o web)
  → corrección básica en el cliente: rotación, recorte, compresión a ≤ 1.600 px (expo-image-manipulator ya está en la app; en web, canvas)
  → POST /api/purchases/invoice-scan  (requireStorePermission purchases.create, idempotente por hash de la imagen)
  → generateObject(model, { schema: InvoiceSchema, image })   ← Gemini Flash / Haiku, temperature 0
  → emparejamiento determinista contra la tienda:
       1. supplier_products.supplier_sku == código impreso        → confirmada
       2. alias aprendido (supplier_product_aliases.text)         → confirmada
       3. código de barras en la línea                            → confirmada
       4. búsqueda difusa por nombre (trigram) en productos activos→ dudosa (muestra 3 candidatos)
       5. nada                                                    → sin emparejar (ofrece "Nuevo producto" con nombre, costo e IVA precargados)
  → respuesta: proveedor (emparejado por RIF/nombre), fecha, nº, líneas con estado, totales leídos vs calculados, alícuotas detectadas
  → /purchases/create se abre precargado; cada línea muestra su estado; el usuario corrige y confirma
  → al confirmar la compra: cada línea confirmada guarda (proveedor, texto de la factura) → producto como alias
```

**Schema de salida** (Zod, orientativo): `{ supplier: {name, taxId?, phone?}, number?, date?, currency: 'VES'|'USD'|'unknown', lines: [{ rawText, description, quantity, unit?: 'unidad'|'caja'|'bulto'|…, unitsPerPack?, unitPrice, lineTotal, taxCode?: 'exento'|'reducida'|'general'|'unknown', barcode? }], subtotal?, tax?, total?, confidence: 0–1, warnings: string[] }`. El modelo rellena `rawText` con el texto literal de la línea: es lo que se guarda como alias.

**Reglas que evitan los errores caros:**

- El modelo **no decide** nada de dinero: propone números; la UI recalcula totales con las alícuotas del catálogo (`tax_rates`) y marca en rojo cualquier línea cuyo total leído no coincida con cantidad × precio.
- Nada se guarda hasta que el usuario confirma la compra; el escaneo no crea productos ni vínculos por sí solo.
- Moneda: toda factura fiscal es en Bs (las impresoras fiscales solo emiten en bolívares); los costos entran en Bs y se convierten a REF con la tasa del día. Si la factura trae tasa impresa, se usa para validar. Las compras en USD son informales y siguen registrándose a mano.
- Empaques: si la línea dice "CAJA x6" y el producto tiene receta o empaque de 6, la línea entra en modo empaque; si no coincide, dudosa.
- Idempotencia por hash de la imagen: subir dos veces la misma foto devuelve el mismo resultado sin volver a llamar al modelo.
- Límite por tienda y día (p. ej. 50 escaneos) para proteger la cuota free, con contador visible.

## 4. Precisión esperada y cómo medirla

- **Sin aliases** (primeras facturas de un proveedor): cabecera y totales bien en la gran mayoría; en líneas, el emparejamiento por nombre difuso acierta parcialmente y el resto queda dudoso o sin emparejar. El valor ya está: el usuario no teclea cantidades ni precios, solo confirma productos.
- **Con aliases** (segunda factura del mismo proveedor en adelante): la mayoría de líneas llegan confirmadas; el trabajo del usuario se reduce a revisar.
- Medir, no suponer: banco de 30 facturas reales del negocio (fotos de teléfono, térmicas, manuscritas, con y sin IVA, en Bs y USD) anonimizadas en `scripts/invoice-eval/`, con la verdad esperada en JSON; script que corre el escaneo y reporta por factura: campos de cabecera correctos, líneas emparejadas, cantidades y precios exactos, totales. Meta inicial: ≥ 90 % de cabeceras, ≥ 70 % de líneas confirmadas o dudosas-con-candidato-correcto en la primera factura, ≥ 90 % con aliases. Se repite con Gemini y con Haiku para elegir con datos.

## 5. Privacidad y decisión del dueño

**Decidido (2026-10-15):** Gemini en plan de pago, facturado contra los $10/mes de crédito de Google Cloud incluidos en la suscripción Google AI Pro del dueño (beneficio del Google Developer Program desde enero de 2026; se activa en developers.google.com/program/my-benefits y requiere vincular una cuenta de facturación de Cloud; es del titular, no de los miembros de la familia). En plan de pago Google no usa los datos para entrenar. A menos de $0,01 por factura, el crédito cubre más de mil facturas al mes junto con el asistente.


El free tier de Gemini permite a Google usar los datos para mejorar sus modelos; una factura contiene el RIF del proveedor, precios de compra y volumen. Opciones: (a) aceptar en free tier; (b) plan de pago de Gemini (menos de $0,01 por factura, sin uso para entrenamiento); (c) Claude Haiku (igual, no entrena). Misma integración en los tres casos; es una variable de entorno. Recomendación: arrancar en free tier con facturas de prueba, y pasar a pago antes de usarlo con facturas reales si el dueño lo prefiere; a 100 facturas al mes son centavos.

## 6. Alcance del MVP y esfuerzo

| Fase | Qué | Esfuerzo |
|------|-----|----------|
| 1 | Endpoint de escaneo con schema, proveedor de IA reutilizando `assistant/server/provider.ts`, idempotencia por hash, límite diario | 1–2 días |
| 2 | Emparejamiento (SKU proveedor, alias, barcode, difuso), tabla `supplier_product_aliases`, aprendizaje al confirmar | 1–2 días |
| 3 | UI: botón "Escanear factura" en `/purchases/create` (cámara en móvil, archivo en web), vista de revisión con estados por línea, precarga del formulario existente | 2–3 días |
| 4 | Banco de 30 facturas y script de evaluación; ajuste de prompt y schema | 1 día |
| 5 | App móvil: misma pantalla con la cámara (`expo-image-manipulator` ya está) | 1–2 días, en el repo de la app |

Dependencias ya resueltas en `main`: proveedor de IA por entorno, `tax_rates`, vínculo automático proveedor–producto al confirmar (COM-02), "Nuevo producto" desde la compra (COM-03), empaques y recetas, borrador de compra y `ProcessGuard`.

## 7. Estado de implementación

Implementado (oct 2026) en la rama `feat/invoice-scan` según el plan [`agent-prompts/factura-escaneo-gtm.md`](agent-prompts/factura-escaneo-gtm.md). Todavía no está desplegado en producción. Detalle en [`factura-escaneo.md`](factura-escaneo.md).

**Hecho (fases 1 a 4):**

- **Escaneo**: `POST /api/purchases/invoice-scan` (foto JPG/PNG/WebP o PDF de hasta 10 páginas, ≤ 1600 px y ≤ 1 MB por página), subida firmada para las facturas grandes, idempotencia por sha256 y tienda, cuota diaria por páginas (`INVOICE_SCAN_DAILY_LIMIT`, 50) y bucket privado `invoice-scans` con purga a 90 días.
- **Modelo**: proveedor por entorno, reutilizando la factory del asistente (`INVOICE_SCAN_PROVIDER`, `INVOICE_SCAN_MODEL`); por defecto `gemini-3.5-flash-lite`, elegido con el banco (D19/D22).
- **Emparejamiento**: determinista en cascada (SKU, alias, código de barras, difuso), con empaques y recetas, coherencia de precio y alícuota. La tasa es la del día del formulario de compra; la impresa se compara (aviso > 2 %). Detecta duplicados.
- **UI**: botón «Escanear factura», modal con avisos de calidad y cuota, pantalla de revisión por línea que precarga el formulario existente, factura visible en el detalle de la compra y alias del proveedor que se pueden quitar.
- **Aprendizaje**: alias por proveedor (`supplier_product_aliases`) y few-shot con los escaneos confirmados (`invoice_scans.confirmed`, lectura corregida por el usuario, D10).
- **Banco**: `npm run invoice-eval` con 22 facturas reales y 10 sintéticas, oráculo, replay y caché. Con `gemini-3.5-flash-lite` cumple todas las metas del plan (§10): cabecera 98,4 %, líneas 99,5 %, emparejamiento 88,6 % sin alias y 96,1 % con alias, 0 % confirmadas mal, p95 6,8 s y $0,0036 por factura.
- **Dataset de fine-tuning**: `npm run invoice-eval:export-finetune` exporta JSONL para Vertex AI.

**No hecho (fuera del MVP o pendiente):**

- Fase 5, app móvil con la cámara: queda en el backlog de [`mobile-app.md`](mobile-app.md#backlog-escaneo-de-facturas-con-la-cámara). Los endpoints ya aceptan Bearer.
- Fine-tuning: el dataset está listo, pero no se entrena. Hoy no se justifica y faltan 100–500 escaneos confirmados.
- Claude Haiku sin medir (la key estaba vacía). Gemini 3.6 y 3.8 Flash, y 2.5 Flash, solo tienen medición parcial por la cuota free.
- Recorte manual de la foto en la app web: solo se reduce y se rota.
- Facturas de venta, notas de crédito, varias facturas en una foto y OCR local offline (excluidos en el plan).
- Despliegue: parches `20261019a`…`20261020a`, variables y el secret `CRON_SECRET` en GitHub (ver [`factura-escaneo.md` § Despliegue](factura-escaneo.md#despliegue)).

## Fuentes

- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini: tokens por imagen](https://ai.google.dev/gemini-api/docs/tokens)
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Google Document AI invoice parser pricing (jun 2026)](https://invoicedataextraction.com/blog/google-document-ai-invoice-parser-pricing)
- [Azure Document Intelligence pricing](https://docuocr.com/blog/azure-document-intelligence-pricing)
