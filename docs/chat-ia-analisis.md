# Chat IA de consultas — análisis de alcance y costo (sep 2026)

Objetivo: un chat donde el admin de tienda pregunte en lenguaje natural por el estado del negocio ("cuánto se ha vendido desde ayer", "producto más vendido", "ganancia entre fechas", "capital actual") y el superadmin haga lo mismo a nivel multitienda ("tienda con más venta", "compara tienda 1 con tienda 2"). Restricción: costo mínimo, idealmente cero.

## 1. Conclusión corta

Es viable a costo cero en LLM usando el free tier de Gemini, y sin infraestructura nueva: Vercel + Supabase actuales alcanzan. El 80 % del trabajo ya está hecho porque los servicios de reportes reciben `(searchParams, storeIds[])`; el chat es una capa fina que traduce la pregunta a llamadas a esos servicios. Estimación: **3–5 días** para un MVP útil.

Arquitectura recomendada: **el chat vive dentro del BFF (`/api/chat`), las herramientas del modelo son los servicios internos existentes, y el `store_id` lo impone el servidor desde la sesión — nunca el modelo.**

## 2. Cómo funciona (tool calling)

```text
Usuario: "¿cuánto vendimos desde ayer?"
  → POST /api/chat  (cookie de sesión, requireStorePermission "assistant.use")
  → LLM recibe: system prompt (fecha Caracas, semántica REF/VES, reglas) + catálogo de herramientas
  → LLM decide: getSalesSummary({ from: "2026-09-02", to: "2026-09-03" })
  → servidor ejecuta getDashboardMetrics(params, [auth.storeId])   ← storeId de la sesión
  → LLM redacta la respuesta SOLO con los datos devueltos
  → UI muestra respuesta + tabla "fuente" plegable con el resultado crudo
```

El modelo no escribe SQL ni ve tokens. Solo elige qué reporte llamar y con qué parámetros (fechas, límites, nombre de tienda). Si la pregunta no encaja con ninguna herramienta, responde que no puede calcularlo.

## 3. Opciones de integración (la pregunta "token del usuario vs APIs de chat")

| Opción | Cómo | Veredicto |
|--------|------|-----------|
| **A. Chat en el BFF, tools = servicios internos** | `/api/chat` autentica con la cookie como cualquier ruta; cada tool llama `getXReport(params, [auth.storeId])` directamente. Superadmin: tool recibe nombres de tienda, el servidor resuelve ids y valida `platform.reports.view` + `normalizeStoreIds`. | **Recomendada.** Cero endpoints nuevos, permisos idénticos a la UI, sin salto HTTP. |
| B. El modelo llama `/api/*` por HTTP con el token del usuario | Tools hacen `fetch` a la propia API reenviando cookie/JWT. | Solo tiene sentido si el chat vive **fuera** de la app (bot de WhatsApp/Telegram). Misma seguridad que A, más latencia. Dejarlo como camino futuro. |
| C. "APIs únicas de chat" con service key | Ruta de chat con admin client y el modelo pasa `storeId`. | **No.** Si el modelo (o una inyección en el prompt) elige otro `storeId`, hay fuga entre tiendas. |
| D. Text-to-SQL (el modelo escribe SQL) | Rol read-only + RLS + el modelo genera consultas. | **No en v1.** Responde cualquier cosa pero requiere blindaje serio (exfiltración cross-store, SQL inválido, costos por reintento). Evaluar solo si las herramientas se quedan cortas. |

Regla que no se negocia: **el `store_id` viene de la sesión o de una validación server-side; nunca de un argumento del modelo.**

## 4. Proveedor LLM y costo

| Proveedor | Costo | Límites free | Tool calling | Privacidad | Notas |
|-----------|-------|--------------|--------------|------------|-------|
| **Gemini Flash (free tier)** | $0 | ~15 RPM, ~1.500 req/día → ~700 consultas/día (2 llamadas por consulta) | Sí | **Los prompts pueden usarse para entrenar** en free tier; en paid no | Opción cero costo. Sobra para una tienda; alcanza para varias. |
| Groq (free) | $0 | ~30 RPM, ~1.000 req/día, **6.000 tokens/min** | Sí | Sin uso para entrenamiento declarado | El TPM es demasiado bajo para tools + historial (una consulta ronda 8–10k tokens/min). No viable sin recortar mucho. |
| **Claude Haiku 4.5 (pago)** | $1 / M input, $5 / M output; cache 0,1× | Sin límite práctico | Sí, muy fiable | No entrena con datos de API | ~9k in + 0,4k out por consulta ≈ **$0,006–0,011/consulta**. 30/día ≈ $5–10/mes; 100/día ≈ $18–33/mes. |
| Gemini Flash (pago) | Fracción de Haiku | — | Sí | No entrena | Camino natural si el free tier se queda corto o si la privacidad importa. |
| Ollama en PC del admin | $0 | — | Depende del modelo | Total | Vercel no puede alcanzarlo; obligaría a correr el chat local. Descartado. |

Infraestructura: Vercel Hobby (funciones hasta 300 s, streaming OK) y Supabase actual. **$0 adicional.** SDK: Vercel AI SDK (`ai` + `@ai-sdk/google` o `@ai-sdk/anthropic`), open source, cambia de proveedor con una línea.

Decisión de negocio a plantear al cliente: ¿acepta que sus cifras de ventas se usen para entrenar modelos de Google a cambio de $0, o prefiere pagar ~$5–15/mes por privacidad? Ambos caminos usan el mismo código.

Nota aparte: el plan Hobby de Vercel es solo para uso no comercial según sus fair-use guidelines. Aplica a toda la app, no solo al chat.

## 5. Alcance del MVP

### Herramientas (fase 1) — 8 de 10 son wrappers de servicios existentes

| Tool | Servicio existente | Responde |
|------|--------------------|----------|
| `ventas_periodo` | `getDashboardMetrics` | cuánto se vendió desde ayer / entre fechas / vs periodo anterior |
| `ganancia_bruta` | `getGrossProfitReport` | ganancia entre fechas |
| `top_productos` | `getTopProductsReport` | producto más vendido |
| `top_clientes` | `getTopCustomersReport` | mejores clientes |
| `rentabilidad_productos` | `getProductProfitabilityReport` | margen por producto |
| `compras_periodo` | `getPurchasesReport` / `getSupplierPurchasesReport` | cuánto se compró, a quién |
| `stock_bajo` | `getLowStockReport` | qué reponer |
| `cierre_dia` | `getDailyCloseSummary` | resumen del día, mix de pagos, caja/baúl |
| `capital_actual` | **nuevo** | ver §6 |
| `comparar_tiendas` | `getDashboardMetrics(params, storeIds[])` + gross profit, agrupado por tienda | superadmin: ranking y comparación |

### Código nuevo

- `src/app/api/chat/route.ts` — AI SDK `streamText` con `maxSteps` ≤ 5, historial acotado a 10 mensajes.
- `src/modules/assistant/tools/*.ts` — un archivo por tool: schema Zod de argumentos + wrapper al servicio.
- `src/modules/assistant/assistant-home/page.tsx` — UI con `useChat`, respuesta + fuente plegable.
- Permiso `assistant.use` (admin, superadmin) en `src/shared/auth/permissions.ts`; entrada de menú.
- Rate limit por usuario (p. ej. 100 consultas/día) para proteger la cuota free.
- Tabla `assistant_queries` (pregunta, tools usadas, tokens, usuario) para revisar qué preguntan y qué falla.

### System prompt (esencial)

Fecha y hora actual en America/Caracas; que REF = USD referencia y Bs = VES; que las cifras salen solo de herramientas y nunca se inventan; que si falta información pregunte o diga que no puede; formato de respuesta corto con la cifra principal primero.

## 6. Huecos a definir con el cliente

- **"Capital actual"**: propuesta = baúl efectivo Bs + cuenta Bs + REF × tasa del día + inventario a costo + cuentas por cobrar (ventas `pendiente_pago`) − cuentas por pagar (compras no pagadas). Requiere una vista `store_capital_summary`. Confirmar definición.
- **"Ganancia estos meses"**: `gross_profit_summary` es diaria; agregar por mes en el servicio (trivial).
- **"Tienda con más pérdida"**: ambiguo. Hoy lo único calculable es pérdida por devaluación (`getFxDepreciationReport`). Si el cliente quiere pérdida operativa hacen falta gastos, que el sistema no registra.
- Precisión de datos: el chat hereda cualquier descuadre del baúl (ver [`cuadre-baul.md`](cuadre-baul.md)). Un chat que responde con confianza sobre datos malos es peor que ninguno.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Cifras inventadas | El modelo solo reporta salidas de tools; la UI muestra la fuente cruda; `temperature` 0. |
| Fechas relativas mal resueltas ("desde ayer", "estos meses") | Fecha Caracas en el prompt + tool que devuelve el rango que usó, visible al usuario. |
| Fuga entre tiendas | `store_id` server-side; superadmin resuelve nombres → ids con validación de permiso. |
| Agotar cuota free | Rate limit por usuario + caché de respuestas idénticas del mismo día. |
| Privacidad en free tier | Decisión explícita del cliente; cambiar a paid es cambiar una variable de entorno. |

## 8. Fases

1. **MVP (3–5 días):** ruta + 8 tools existentes + UI + permiso + logging. Gemini free.
2. **Capital y meses (1–2 días):** vista `store_capital_summary`, agregación mensual.
3. **Superadmin (1–2 días):** `comparar_tiendas`, resolución de nombres de tienda.
4. **Opcional:** bot WhatsApp/Telegram reutilizando las mismas tools (opción B), historial persistente, gráficos en la respuesta.

## 9. Plan de ejecución

Plan autónomo paso a paso para Claude Code: [`agent-prompts/chat-ia-gtm.md`](agent-prompts/chat-ia-gtm.md).

## 9. Estado de implementación (2 sep 2026)

Rama `feat/assistant-chat`. Detalle funcional en [`modules-catalog.md`](modules-catalog.md#asistente-ia-de-consultas).

**Qué quedó hecho:** ruta `/api/chat` con streaming, 10 herramientas de tienda + 2 de plataforma, permiso `assistant.use`, pantalla `/assistant`, servicio de capital (mock + Supabase), límite diario por usuario, bitácora `assistant_queries` y banco de preguntas ejecutable.

**Variables de entorno** (ver `.env.local.example`):

```text
ASSISTANT_PROVIDER=google            # google | anthropic | mock
ASSISTANT_MODEL=                     # opcional; default gemini-2.5-flash / claude-haiku-4-5
GOOGLE_GENERATIVE_AI_API_KEY=
ANTHROPIC_API_KEY=
ASSISTANT_DAILY_LIMIT=100
```

**Parches SQL a aplicar en el SQL Editor** (en este orden):

1. `supabase/patches/20260906-store-capital-summary.sql` — vista `store_capital_summary`.
2. `supabase/patches/20260906b-assistant-queries.sql` — tabla `assistant_queries` + RLS.

Sin ellos el asistente funciona igual en `API_DATA_SOURCE=mock`; en Supabase, `capital_actual` y el contador diario fallan de forma controlada.

**Cómo correr el banco de preguntas:**

```bash
# 1. Dev server con datos mock y demo auth
API_DATA_SOURCE=mock ALLOW_DEMO_AUTH=true npm run dev

# 2. Plumbing (sin consumir cuota): ASSISTANT_PROVIDER=mock en .env.local
npm run assistant:eval

# 3. Modelo real, paceado para el free tier
ASSISTANT_EVAL_DELAY_MS=27000 npm run assistant:eval
```

### Corrección al §4: el free tier de Gemini es mucho más chico de lo estimado

Medido contra la API con una key real (sep 2026), el free tier de Gemini es **por modelo y por proyecto**:

| Modelo | Free tier medido |
|--------|------------------|
| `gemini-2.5-flash` | 20 peticiones/día, 5 por minuto |
| `gemini-3.8-flash` (`gemini-flash-latest`) | 20 peticiones/día |
| `gemini-3.5-flash`, `gemini-3.1-flash-lite-preview` | 20 peticiones/día (cuota independiente por modelo) |

Además, `gemini-2.0-flash` y `gemini-2.5-flash-lite` ya **no están disponibles para keys nuevas**.

Una consulta del asistente consume **2 llamadas** (una para elegir la herramienta, otra para redactar). Es decir: **~10 consultas al día**, no las ~700 que estimaba el §4. Eso no alcanza ni para un solo admin.

Consecuencias:

- La opción "costo cero" del §4 queda descartada tal como estaba planteada. `ASSISTANT_DAILY_LIMIT=100` protege la app, no la cuota.
- Caminos reales: (a) activar facturación en Google (Gemini Flash de pago cuesta una fracción de Haiku), o (b) `ASSISTANT_PROVIDER=anthropic` con Haiku 4.5 (~$0,006–0,011 por consulta, ver §4).
- El proveedor `mock` sigue disponible para demos y tests sin gastar cuota.

La decisión de privacidad del §4 sigue en pie y ahora es más simple: si de todos modos hay que pagar, el free tier deja de ser un argumento para aceptar el entrenamiento con los datos del cliente.
