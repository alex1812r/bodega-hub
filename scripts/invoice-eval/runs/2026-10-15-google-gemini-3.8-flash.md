> Corrida: google / gemini-3.8-flash
> Pedido: --provider google --model gemini-3.8-flash; few-shot sí
> **AVISO: pasada cortada por cuota** (3 errores QUOTA seguidos; 44 extracciones no se intentaron). Las métricas de esta corrida están incompletas.

# Banco de evaluación del escaneo: google / gemini-3.8-flash

- Fecha: 2026-10-16T01:41:05.843Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 0.0 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 0.0 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 0.0 % | >= 70.0 % | ✗ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 0.0 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 0.0 % | >= 95.0 % | ✗ |
| con alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 0.0 % | >= 90.0 % | ✗ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | – | <= 15.0 s | sin datos |
| total | Costo medio por factura | – | <= $0.0100 | sin datos |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| todas | con alias | 19 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| todas | total | 51 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/4 (FP 0) | – | – |
| reales | sin alias | 22 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| reales | con alias | 13 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/2 (FP 0) | – | – |
| reales | total | 35 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/4 (FP 0) | – | – |
| sintéticas | sin alias | 10 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | con alias | 6 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | total | 16 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | error PROVIDER_ERROR | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |
| f02 | sin alias | error PROVIDER_ERROR | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f03 | sin alias | error PROVIDER_ERROR | 0/5/0 | 0/5 | 0/0/0/0 | ✗ no detectado | – | – | – |
| f04 | sin alias | error QUOTA | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f05 | sin alias | error QUOTA | 0/9/0 | 0/9 | 0/0/0/0 | – | – | – | – |
| f06 | sin alias | error QUOTA | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f07 | sin alias | error QUOTA | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
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

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✗ | ✓ | – | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✗ | ✓ | – | 0/0 | 0 | 0 |
| con alias | f02 / f03 | ✗ | ✓ | – | 0/0 | 0 | 0 |
| con alias | f07 / f16 | ✗ | ✓ | – | 0/0 | 0 | 0 |

## Casos "no inventar"

- f07 (sin alias): sin extracción (error).
- f09 (sin alias): sin extracción (error).
- f07 (con alias): sin extracción (error).
- f09 (con alias): sin extracción (error).

## Errores

- f01 (sin alias) [PROVIDER_ERROR]: El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.
- f02 (sin alias) [PROVIDER_ERROR]: El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.
- f03 (sin alias) [PROVIDER_ERROR]: El servicio de IA no está disponible en este momento. Intenta de nuevo en unos minutos.
- f04 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f05 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f06 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
- f07 (sin alias) [QUOTA]: Se agotó la cuota del servicio de IA por ahora. Intenta más tarde o registra la compra a mano.
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
