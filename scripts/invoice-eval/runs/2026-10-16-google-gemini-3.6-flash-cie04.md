> Corrida: google / gemini-3.6-flash — cie04
> Pedido: --provider google --model gemini-3.6-flash; few-shot sí
> **AVISO: pasada cortada por cuota** (3 errores QUOTA seguidos; 30 extracciones no se intentaron). Las métricas de esta corrida están incompletas.
> Caché de extracciones (scripts/invoice-eval/cache): 9 de caché, 5 llamadas nuevas, 37 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.6-flash

- Fecha: 2026-10-16T13:59:50.608Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 41.5 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 51.5 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 49.5 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 46.7 % | >= 70.0 % | ✗ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 0.0 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 0.0 % | >= 95.0 % | ✗ |
| con alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 0.0 % | >= 90.0 % | ✗ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 44.4 s | <= 15.0 s | ✗ |
| total | Costo medio por factura | $0.0125 | <= $0.0100 | ✗ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | Fugas few-shot (meta 0) | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 41.5 % | 51.5 % | 49.5 % | 46.7 % | 0.0 % | 2/2 (FP 0) | – | 44.4 s | $0.0125 |
| todas | con alias | 19 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – | – |
| todas | total | 51 | 25.6 % | 33.8 % | 32.3 % | 30.3 % | 0.0 % | 2/4 (FP 0) | – | 44.4 s | $0.0125 |
| reales | sin alias | 22 | 58.6 % | 71.6 % | 69.1 % | 65.6 % | 0.0 % | 2/2 (FP 0) | – | 44.4 s | $0.0125 |
| reales | con alias | 13 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – | – |
| reales | total | 35 | 36.7 % | 48.3 % | 46.4 % | 43.7 % | 0.0 % | 2/4 (FP 0) | – | 44.4 s | $0.0125 |
| sintéticas | sin alias | 10 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – | – |
| sintéticas | con alias | 6 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – | – |
| sintéticas | total | 16 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 11.9 s | 2427/2527 | $0.0113 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 17.9 s | 2427/2355 | $0.0107 |
| f03 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✓ detectado (f02) | 27.1 s | 2427/2193 | $0.0100 |
| f04 | sin alias | P✗ F✗ N✗ T✗ | 0/5/0 | 0/5 | 0/0/0/0 | – | 12.4 s | 2405/2214 | $0.0101 |
| f05 | sin alias | error TIMEOUT | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 14.2 s | 2427/2207 | $0.0101 |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/0/1 | – | 14.3 s | 2427/2867 | $0.0126 |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 15.3 s | 2427/3470 | $0.0148 |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 25.2 s | 2429/3412 | $0.0146 |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 10.2 s | 2427/2266 | $0.0103 |
| f11 | sin alias | error PROVIDER_ERROR | 0/2/0 | 0/2 | 0/0/0/0 | – | – | – | – |
| f12 | sin alias | P✓ F✓ N✓ T✓ | 41/0/0 | 38/41 | 0/31/0/7 | – | 44.4 s | 2391/9572 | $0.0377 |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 12.6 s | 2427/1169 | $0.0062 |
| f14 | sin alias | error TIMEOUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f15 | sin alias | error PROVIDER_ERROR | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | ✓ detectado (f07) | 12.4 s | 2427/2656 | $0.0118 |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 11.3 s | 2427/1945 | $0.0091 |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 10.3 s | 2427/948 | $0.0054 |
| f19 | sin alias | error QUOTA | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f20 | sin alias | error QUOTA | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f21 | sin alias | error QUOTA | 0/1/0 | 0/1 | 0/0/0/0 | – | – | – | – |
| f22 | sin alias | error QUOTA_CUT | 0/11/0 | 0/11 | 0/0/0/0 | – | – | – | – |
| s01 (sintética) | sin alias | error QUOTA_CUT | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s02 (sintética) | sin alias | error QUOTA_CUT | 0/14/0 | 0/14 | 0/0/0/0 | – | – | – | – |
| s03 (sintética) | sin alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| s04 (sintética) | sin alias | error QUOTA_CUT | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s05 (sintética) | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s06 (sintética) | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s07 (sintética) | sin alias | error QUOTA_CUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| s08 (sintética) | sin alias | error QUOTA_CUT | 0/0/0 | 0/0 | 0/0/0/0 | – | – | – | – |
| s09 (sintética) | sin alias | error QUOTA_CUT | 0/0/0 | 0/0 | 0/0/0/0 | – | – | – | – |
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
| s09 (sintética) | con alias | error QUOTA_CUT | 0/0/0 | 0/0 | 0/0/0/0 | – | – | – | – |
| s10 (sintética) | con alias | error QUOTA_CUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |

## Pares duplicados

Consistentes: 1/2 evaluables. No evaluables: 2.

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f02) | ✓ | – | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f07) | ✗ | – | 0/0 | 0 | 1 |
| con alias | f02 / f03 | — | no evaluable (fallaron ambas extracciones) | — | — | — | — |
| con alias | f07 / f16 | — | no evaluable (fallaron ambas extracciones) | — | — | — | — |

## Fugas de cabecera desde el few-shot (meta: 0)

Con alias y few-shot: campo de cabecera (RIF o nombre del proveedor, número, total) igual al de un ejemplo few-shot y distinto de la verdad.

Sin extracciones con few-shot en esta corrida.

## Casos "no inventar"

- f07 (sin alias): ✓ ninguna línea inventada.
- f09 (sin alias): ✓ ninguna línea inventada.
- f07 (con alias): sin extracción (error).
- f09 (con alias): sin extracción (error).

## Errores

- f05 (sin alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.
- f11 (sin alias) [PROVIDER_ERROR]: El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.
- f14 (sin alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.
- f15 (sin alias) [PROVIDER_ERROR]: El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.
- f19 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f20 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f21 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
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


## Pendientes por medir (google/gemini-3.6-flash): 37

| Factura | Pasada | Motivo |
|---|---|---|
| f05 | sinAlias | timeout del modelo (TIMEOUT) |
| f11 | sinAlias | proveedor no disponible (503/otro) (PROVIDER_ERROR) |
| f14 | sinAlias | timeout del modelo (TIMEOUT) |
| f15 | sinAlias | proveedor no disponible (503/otro) (PROVIDER_ERROR) |
| f19 | sinAlias | cuota agotada (429 tras reintentar) (QUOTA) |
| f20 | sinAlias | cuota agotada (429 tras reintentar) (QUOTA) |
| f21 | sinAlias | cuota agotada (429 tras reintentar) (QUOTA) |
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

## Métricas solo sobre lo medido (14 de 51 entradas)

Sin las pendientes (que arriba cuentan como fallo). En conAlias, una anterior pendiente del mismo proveedor deja menos alias aprendidos.

| Pasada | Facturas | Cabecera | Líneas detectadas | Exactitud | Emparejadas OK | Confirmadas mal | p95 1 pág. (ms) | $/factura |
|---|---|---|---|---|---|---|---|---|
| sin alias | 14 | 92.7% | 95.3% | 92.3% | 86.0% | 0.0% | 44412 | $0.01248 |
| con alias | 0 | – | – | – | – | – | – | – |
| total | 14 | 92.7% | 95.3% | 92.3% | 86.0% | 0.0% | 44412 | $0.01248 |
