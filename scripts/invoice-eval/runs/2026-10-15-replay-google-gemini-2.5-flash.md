> Corrida: google / gemini-2.5-flash
> Pedido: --replay scripts/invoice-eval/runs/2026-10-15-google-gemini-2.5-flash.json; few-shot sí

# Banco de evaluación del escaneo: REPLAY google / gemini-2.5-flash

> **REPLAY** de scripts/invoice-eval/runs/2026-10-15-google-gemini-2.5-flash.json: extracciones guardadas reutilizadas; el emparejamiento se recalcula con el código y el lab actuales.
> Tokens, tiempo y costo: de la corrida original. Reutilizadas 3, sin extracción 48.

- Fecha: 2026-10-16T01:54:35.271Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 8.9 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 8.1 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 8.1 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 7.0 % | >= 70.0 % | ✗ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 0.0 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 0.0 % | >= 95.0 % | ✗ |
| con alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 0.0 % | >= 90.0 % | ✗ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 17.6 s | <= 15.0 s | ✗ |
| total | Costo medio por factura | $0.0076 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. (de la corrida original) | $ medio (de la corrida original) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 8.9 % | 8.1 % | 8.1 % | 7.0 % | 0.0 % | 1/2 (FP 0) | 17.6 s | $0.0076 |
| todas | con alias | 19 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| todas | total | 51 | 5.5 % | 5.2 % | 5.2 % | 4.5 % | 0.0 % | 1/4 (FP 0) | 17.6 s | $0.0076 |
| reales | sin alias | 22 | 12.6 % | 11.5 % | 11.5 % | 10.1 % | 0.0 % | 1/2 (FP 0) | 17.6 s | $0.0076 |
| reales | con alias | 13 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| reales | total | 35 | 7.9 % | 7.7 % | 7.7 % | 6.7 % | 0.0 % | 1/4 (FP 0) | 17.6 s | $0.0076 |
| sintéticas | sin alias | 10 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | con alias | 6 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | total | 16 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/5/0/1 | – | 12.5 s | 1585/2885 | $0.0077 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 17.6 s | 1585/2726 | $0.0073 |
| f03 | sin alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | ✓ detectado (f02) | 12.7 s | 1585/2909 | $0.0077 |
| f04 | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f05 | sin alias | error REPLAY_MISSING | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f06 | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f07 | sin alias | error REPLAY_MISSING | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f08 | sin alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f09 | sin alias | error REPLAY_MISSING | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f10 | sin alias | error REPLAY_MISSING | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f11 | sin alias | error REPLAY_MISSING | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f12 | sin alias | error REPLAY_MISSING | 0/41/0 | 0/41 | 0/0/0/0 | – | – | – | – |
| f13 | sin alias | error REPLAY_MISSING | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f14 | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f15 | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f16 | sin alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f17 | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f18 | sin alias | error REPLAY_MISSING | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f19 | sin alias | error REPLAY_MISSING | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f20 | sin alias | error REPLAY_MISSING | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f21 | sin alias | error REPLAY_MISSING | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f22 | sin alias | error REPLAY_MISSING | 0/11/0 | 0/11 | 0/0/0/0 | – | – | – | – |
| s01 (sintética) | sin alias | error REPLAY_MISSING | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s02 (sintética) | sin alias | error REPLAY_MISSING | 0/14/0 | 0/14 | 0/0/0/0 | – | – | – | – |
| s03 (sintética) | sin alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| s04 (sintética) | sin alias | error REPLAY_MISSING | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s05 (sintética) | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s06 (sintética) | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s07 (sintética) | sin alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s08 (sintética) | sin alias | error REPLAY_MISSING | 0/0/0 | 0/0 | 0/0/0/0 | – | – | – | – |
| s09 (sintética) | sin alias | error REPLAY_MISSING | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| s10 (sintética) | sin alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f02 | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f03 | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f06 | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f07 | con alias | error REPLAY_MISSING | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f08 | con alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f09 | con alias | error REPLAY_MISSING | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f10 | con alias | error REPLAY_MISSING | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f13 | con alias | error REPLAY_MISSING | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f14 | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f16 | con alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f17 | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f20 | con alias | error REPLAY_MISSING | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f22 | con alias | error REPLAY_MISSING | 0/11/0 | 0/11 | 0/0/0/0 | – | – | – | – |
| s02 (sintética) | con alias | error REPLAY_MISSING | 0/14/0 | 0/14 | 0/0/0/0 | – | – | – | – |
| s05 (sintética) | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s06 (sintética) | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s07 (sintética) | con alias | error REPLAY_MISSING | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s09 (sintética) | con alias | error REPLAY_MISSING | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| s10 (sintética) | con alias | error REPLAY_MISSING | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |

## Pares duplicados

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✗ | ✗ | supplier, date, number, total | 0/0 | 0 | 0 |
| con alias | f02 / f03 | ✗ | ✗ | supplier, date, number, total | 0/0 | 0 | 0 |
| con alias | f07 / f16 | ✗ | ✗ | supplier, date, number, total | 0/0 | 0 | 0 |

## Casos "no inventar"

- f07 (sin alias): sin extracción (error).
- f09 (sin alias): sin extracción (error).
- f07 (con alias): sin extracción (error).
- f09 (con alias): sin extracción (error).

## Errores

- f04 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f05 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f06 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f07 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f08 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f09 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f10 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f11 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f12 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f13 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f14 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f15 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f16 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f17 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f18 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f19 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f20 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f21 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f22 (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s01 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s02 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s03 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s04 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s05 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s06 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s07 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s08 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s09 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- s10 (sintética) (sin alias) [REPLAY_MISSING]: sin extracción en el replay
- f02 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f03 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f06 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f07 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f08 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f09 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f10 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f13 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f14 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f16 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f17 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f20 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- f22 (con alias) [REPLAY_MISSING]: sin extracción en el replay
- s02 (sintética) (con alias) [REPLAY_MISSING]: sin extracción en el replay
- s05 (sintética) (con alias) [REPLAY_MISSING]: sin extracción en el replay
- s06 (sintética) (con alias) [REPLAY_MISSING]: sin extracción en el replay
- s07 (sintética) (con alias) [REPLAY_MISSING]: sin extracción en el replay
- s09 (sintética) (con alias) [REPLAY_MISSING]: sin extracción en el replay
- s10 (sintética) (con alias) [REPLAY_MISSING]: sin extracción en el replay
