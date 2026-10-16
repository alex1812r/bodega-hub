> Corrida: google / gemini-2.5-flash
> Pedido: --provider google --model gemini-2.5-flash; few-shot sí
> **AVISO: pasada cortada por cuota** (3 errores QUOTA seguidos; 47 extracciones no se intentaron). Las métricas de esta corrida están incompletas.
> Caché de extracciones (scripts/invoice-eval/cache): 1 de caché, 0 llamadas nuevas, 50 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-2.5-flash

- Fecha: 2026-10-16T03:19:29.167Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 3.3 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 3.0 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 3.0 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 3.2 % | >= 70.0 % | ✗ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 0.0 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 0.0 % | >= 95.0 % | ✗ |
| con alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 0.0 % | >= 90.0 % | ✗ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 14.9 s | <= 15.0 s | ✓ |
| total | Costo medio por factura | $0.0085 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 3.3 % | 3.0 % | 3.0 % | 3.2 % | 0.0 % | 0/2 (FP 0) | 14.9 s | $0.0085 |
| todas | con alias | 19 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| todas | total | 51 | 2.0 % | 2.0 % | 2.0 % | 2.1 % | 0.0 % | 0/4 (FP 0) | 14.9 s | $0.0085 |
| reales | sin alias | 22 | 4.6 % | 4.3 % | 4.3 % | 4.7 % | 0.0 % | 0/2 (FP 0) | 14.9 s | $0.0085 |
| reales | con alias | 13 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| reales | total | 35 | 2.9 % | 2.9 % | 2.9 % | 3.1 % | 0.0 % | 0/4 (FP 0) | 14.9 s | $0.0085 |
| sintéticas | sin alias | 10 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | con alias | 6 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | total | 16 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 14.9 s | 1585/3195 | $0.0085 |
| f02 | sin alias | error QUOTA | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f03 | sin alias | error QUOTA | 0/5/0 | 0/5 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f04 | sin alias | error QUOTA | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f05 | sin alias | error QUOTA_CUT | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f06 | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f07 | sin alias | error QUOTA_CUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f08 | sin alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f09 | sin alias | error QUOTA_CUT | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f10 | sin alias | error QUOTA_CUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f11 | sin alias | error QUOTA_CUT | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f12 | sin alias | error QUOTA_CUT | 0/41/0 | 0/41 | 0/0/0/0 | – | – | – | – |
| f13 | sin alias | error QUOTA_CUT | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f14 | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f15 | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f16 | sin alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f17 | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f18 | sin alias | error QUOTA_CUT | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f19 | sin alias | error QUOTA_CUT | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f20 | sin alias | error QUOTA_CUT | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f21 | sin alias | error QUOTA_CUT | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f22 | sin alias | error QUOTA_CUT | 0/11/0 | 0/11 | 0/0/0/0 | – | – | – | – |
| s01 (sintética) | sin alias | error QUOTA_CUT | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s02 (sintética) | sin alias | error QUOTA_CUT | 0/14/0 | 0/14 | 0/0/0/0 | – | – | – | – |
| s03 (sintética) | sin alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| s04 (sintética) | sin alias | error QUOTA_CUT | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s05 (sintética) | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s06 (sintética) | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s07 (sintética) | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s08 (sintética) | sin alias | error QUOTA_CUT | 0/0/0 | 0/0 | 0/0/0/0 | – | – | – | – |
| s09 (sintética) | sin alias | error QUOTA_CUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| s10 (sintética) | sin alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f02 | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f03 | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f06 | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f07 | con alias | error QUOTA_CUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f08 | con alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f09 | con alias | error QUOTA_CUT | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f10 | con alias | error QUOTA_CUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f13 | con alias | error QUOTA_CUT | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f14 | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f16 | con alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f17 | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f20 | con alias | error QUOTA_CUT | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f22 | con alias | error QUOTA_CUT | 0/11/0 | 0/11 | 0/0/0/0 | – | – | – | – |
| s02 (sintética) | con alias | error QUOTA_CUT | 0/14/0 | 0/14 | 0/0/0/0 | – | – | – | – |
| s05 (sintética) | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s06 (sintética) | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s07 (sintética) | con alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s09 (sintética) | con alias | error QUOTA_CUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| s10 (sintética) | con alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |

## Pares duplicados

Consistentes: 0/0 evaluables. No evaluables: 4.

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | — | no evaluable (fallaron ambas extracciones) | — | — | — | — |
| sin alias | f07 / f16 | — | no evaluable (fallaron ambas extracciones) | — | — | — | — |
| con alias | f02 / f03 | — | no evaluable (fallaron ambas extracciones) | — | — | — | — |
| con alias | f07 / f16 | — | no evaluable (fallaron ambas extracciones) | — | — | — | — |

## Casos "no inventar"

- f07 (sin alias): sin extracción (error).
- f09 (sin alias): sin extracción (error).
- f07 (con alias): sin extracción (error).
- f09 (con alias): sin extracción (error).

## Errores

- f02 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f03 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f04 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f05 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f06 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f07 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f08 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f09 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f10 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f11 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f12 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f13 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f14 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f15 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f16 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f17 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f18 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f19 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f20 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f21 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f22 (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s01 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s02 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s03 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s04 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s05 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s06 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s07 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s08 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s09 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s10 (sintética) (sin alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f02 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f03 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f06 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f07 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f08 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f09 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f10 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f13 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f14 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f16 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f17 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f20 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- f22 (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s02 (sintética) (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s05 (sintética) (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s06 (sintética) (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s07 (sintética) (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s09 (sintética) (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.
- s10 (sintética) (con alias) [QUOTA_CUT]: Pasada cortada: 3 errores de cuota seguidos.


## Pendientes por medir (google/gemini-2.5-flash): 50

| Factura | Pasada | Motivo |
|---|---|---|
| f02 | sinAlias | cuota agotada (429 tras reintentar) (QUOTA) |
| f03 | sinAlias | cuota agotada (429 tras reintentar) (QUOTA) |
| f04 | sinAlias | cuota agotada (429 tras reintentar) (QUOTA) |
| f05 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f06 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f07 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f08 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f09 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f10 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f11 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f12 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f13 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f14 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f15 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f16 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f17 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f18 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f19 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f20 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f21 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f22 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s01 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s02 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s03 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s04 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s05 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s06 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s07 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s08 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s09 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s10 | sinAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f02 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f03 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f06 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f07 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f08 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f09 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f10 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f13 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f14 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f16 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f17 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f20 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| f22 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s02 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s05 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s06 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s07 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s09 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |
| s10 | conAlias | cuota: pasada cortada, no se intentó (QUOTA_CUT) |

## Métricas solo sobre lo medido (1 de 51 entradas)

Sin las pendientes (que arriba cuentan como fallo). En conAlias, una anterior pendiente del mismo proveedor deja menos alias aprendidos.

| Pasada | Facturas | Cabecera | Líneas detectadas | Exactitud | Emparejadas OK | Confirmadas mal | p95 1 pág. (ms) | $/factura |
|---|---|---|---|---|---|---|---|---|
| sin alias | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 14928 | $0.00846 |
| con alias | 0 | – | – | – | – | – | – | – |
| total | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 14928 | $0.00846 |
