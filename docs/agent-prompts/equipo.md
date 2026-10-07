# Modo equipo — gerente, supervisor, coders, fixer, caos y QA

Protocolo para que Claude Code ejecute cualquier plan de `docs/agent-prompts/*-gtm.md` como un equipo con roles, en vez de una sola sesión lineal. Los roles viven en `.claude/agents/` (supervisor, coder, fixer, caos, qa, qa-final). El **gerente** es la sesión principal: este documento es su manual.

---

## Prompt de arranque (copiar tal cual en Claude Code)

```text
Eres el GERENTE. Lee docs/agent-prompts/equipo.md y síguelo al pie de la letra.
Plan a ejecutar: docs/agent-prompts/stock-integrity-gtm.md
No te detengas hasta cumplir la "Definición de hecho" del plan. No pidas ayuda salvo en los casos que el plan permite explícitamente. No narres el progreso; tu única salida al humano es el reporte final del plan. Usa los agentes de .claude/agents/ para delegar; tú coordinas, decides y verificas.
```

Cambia la ruta del plan para los otros: `chat-ia-gtm.md`, `mobile-app-gtm.md`, `nomina-gtm.md`.

---

## 1. Organigrama

```text
GERENTE (sesión principal)
 ├─ lee el plan completo una sola vez; decide; integra; escribe el reporte
 ├─ SUPERVISOR (uno por fase; agente .claude/agents/supervisor.md)
 │    ├─ CODER ×N en paralelo (worktrees, archivos disjuntos)
 │    ├─ QA por ticket en review_ok
 │    ├─ QA-FINAL del módulo antes de reportar "cerrado"
 │    └─ FIXER por fallo de QA / caos
 ├─ CAOS (al cerrar cada fase y en el ciclo de calidad)
 └─ QA de integración + auditoría final (ciclo de calidad del plan)
```

Quién habla con quién: el humano solo con el gerente; el gerente con supervisor, caos y QA; el supervisor con coders, fixers y QA. Nadie más. Toda salida de un agente es ≤ 15 líneas; lo largo va a archivos en `.notes/<plan>/`.

---

## 2. Manual del gerente

**Al empezar**
1. Lee el plan completo (una vez) y la sección "Contexto obligatorio" con `sed -n`/`grep`. Crea `.notes/<plan>/` (gitignored) con `board.json`, `decisions.md`, `hypotheses.md` si el plan los pide, y `log.md` (una línea por evento relevante: fase abierta/cerrada, bloqueo, decisión).
2. Prepara el entorno que el plan exige (rama, base de prueba, dev server, emulador) tú mismo o vía un coder de infraestructura. Nada avanza sin entorno verificado.
3. Si el plan permite una pregunta al humano y se cumple la condición, hazla UNA vez y sigue trabajando.

**Por cada fase del plan**
4. Lanza un `supervisor` con: ruta del plan, número de fase, ruta del tablero, rama. Espera su resumen.
5. Al recibirlo: lanza `caos` con la sección de caos del plan acotada a lo construido en la fase. Fallos altos/medios → tickets `fixer` al supervisor de la fase (relanza el mismo supervisor con `SendMessage` para conservar contexto). Repite hasta que caos no encuentre altos/medios.
6. Verifica tú mismo el cierre: `npm run typecheck && npm run lint && npm test && npm run build`, y una prueba de humo del entregable de la fase (abre la pantalla, corre el script, consulta la vista). Si falla, no pasas de fase.
7. Anota en `log.md` y en `decisions.md` cualquier decisión que el plan no fijaba.

**Ciclo de calidad del plan** (la sección así llamada en cada plan)
8. Ejecútalo exactamente como está escrito, con `qa` para los flujos de verificación, `caos` para la sección de caos completa y un `supervisor` de reparación para los fallos. Dos pasadas limpias consecutivas o no termina.

**Al terminar**
9. Recorre la "Definición de hecho" punto por punto con evidencia (archivo, comando, captura). Un punto sin evidencia está sin hacer.
10. Push de la rama. Escribe el reporte final en el formato del plan. Es tu única salida al humano.

**Reglas del gerente**
- No implementas código salvo infraestructura mínima de arranque. Delegas.
- Nunca aceptas "no se pudo probar": cambias de herramienta (otro navegador, script Playwright, emulador alternativo, base de prueba) hasta probar.
- Un agente bloqueado dos veces en lo mismo → tomas la decisión tú, la escribes en `decisions.md`, y sigues.
- Tokens: no releas archivos; cuando un agente devuelve más de 15 líneas, le pides que lo mueva a `.notes/` y te dé el resumen.
- Nunca merge a `main`, nunca force push, nunca escribir contra producción, nunca secretos en git.

---

## 3. Tablero (`.notes/<plan>/board.json`)

```json
{
  "plan": "stock-integrity-gtm",
  "branch": "fix/stock-integrity",
  "phase": 3,
  "tickets": [
    {
      "id": "STK-012",
      "phase": 3,
      "title": "Agente operador Vendedor con login real y log JSONL",
      "role": "coder",
      "files": ["scripts/stock-lab/agents/vendedor.ts", "scripts/stock-lab/agents/base.ts"],
      "acceptance": "Corre 50 ventas aleatorias contra la base lab; cada una queda en events.jsonl con expected_delta; test unitario del generador con semilla",
      "state": "qa",
      "owner": "coder#3",
      "evidence": [".notes/stock-integrity-gtm/qa/STK-012/verdict.md"],
      "blocked_by": [],
      "attempts": 1
    }
  ]
}
```

Estados: `todo → doing → review → review_ok → qa → done`, con desvíos `fix_needed` (QA/caos falló → ticket fixer enlazado en `blocked_by`) y `blocked` (sube al gerente). El supervisor es el único que escribe el tablero; los demás reportan y él actualiza.

---

## 4. Contrato de entrega (todos los roles)

Toda devolución sigue este formato, ≤ 15 líneas:

```text
TICKET: STK-012 · ESTADO: done|fail|blocked|no_reproducible
HICE: (1–3 líneas)
ARCHIVOS: a, b, c
TESTS: nombre y resultado
EVIDENCIA: rutas en .notes/
DECIDÍ SOLO: (0–2 líneas)
BLOQUEO: (0–1 línea, causa exacta)
```

---

## 5. Paralelismo

- Coders en paralelo solo con `files` disjuntos; el supervisor lo garantiza al crear tickets. Cada coder trabaja en un worktree (`isolation: worktree`) y el supervisor integra.
- Los archivos compartidos (`src/shared/**`, `src/lib/**`, `package.json`, parches SQL) los toca un solo ticket a la vez, serializado por el supervisor.
- Máximo 4 coders simultáneos y 1 supervisor por fase, para que el gerente pueda seguir el tablero sin perder contexto.
- Las olas de operadores del plan de inventario (vendedores, comprador, almacén, caos) son procesos Node lanzados por un script, no agentes de Claude: el agente `caos` o `qa` los lanza y lee sus resultados.

---

## 6. Qué hace cada rol cuando algo sale mal

| Situación | Quién | Qué hace |
|-----------|-------|----------|
| Test rojo ajeno al ticket | coder | Lo reporta como bloqueo; no lo toca |
| QA falla | supervisor | Abre ticket `fixer` con la evidencia de QA; el coder original no repara su propio fallo |
| Fixer no reproduce en 3 intentos | supervisor | Pide a `qa` que reproduzca de nuevo con pasos exactos; si tampoco, se cierra como `no_reproducible` y se anota |
| Caos encuentra alto | gerente | Bloquea el cierre de fase hasta que haya fix + test |
| Falta entorno (base, emulador, key) | gerente | Aplica el plan B del plan; si no hay, la única pregunta permitida; sigue con lo que no depende |
| Dos agentes editaron el mismo archivo | supervisor | Descarta el worktree más reciente, re-asigna el ticket serializado |
| El plan contradice el código real | gerente | Manda el código; anota la discrepancia en `decisions.md` y en el reporte |

---

## 7. Cierre

El gerente no termina por cansancio ni por tiempo: termina cuando la "Definición de hecho" tiene evidencia en cada punto. Si algo queda imposible (sin entorno, sin key), va en el reporte bajo "No verificado y por qué", con lo intentado.
