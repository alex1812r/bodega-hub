> Corrida: google / gemini-3.1-flash-lite — resume
> Pedido: --provider google --model gemini-3.1-flash-lite; few-shot sí
> Caché de extracciones (scripts/invoice-eval/cache): 47 de caché, 3 llamadas nuevas, 1 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.1-flash-lite

- Fecha: 2026-10-16T03:13:23.948Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 94.3 % | >= 90.0 % | ✓ |
| sin alias | Líneas detectadas | 97.0 % | >= 95.0 % | ✓ |
| sin alias | Cantidad/precio/total exactos | 92.9 % | >= 90.0 % | ✓ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 87.2 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 89.5 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 92.7 % | >= 95.0 % | ✗ |
| con alias | Cantidad/precio/total exactos | 92.5 % | >= 90.0 % | ✓ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 87.6 % | >= 90.0 % | ✗ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 7.9 s | <= 15.0 s | ✓ |
| total | Costo medio por factura | $0.0024 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 94.3 % | 97.0 % | 92.9 % | 87.2 % | 0.0 % | 1/2 (FP 0) | 8.2 s | $0.0022 |
| todas | con alias | 19 | 89.5 % | 92.7 % | 92.5 % | 87.6 % | 0.0 % | 2/2 (FP 0) | 7.9 s | $0.0027 |
| todas | total | 51 | 92.5 % | 95.5 % | 92.8 % | 87.3 % | 0.0 % | 3/4 (FP 0) | 7.9 s | $0.0024 |
| reales | sin alias | 22 | 96.6 % | 98.6 % | 92.8 % | 86.3 % | 0.0 % | 1/2 (FP 0) | 8.2 s | $0.0021 |
| reales | con alias | 13 | 90.4 % | 94.3 % | 94.1 % | 89.7 % | 0.0 % | 2/2 (FP 0) | 7.9 s | $0.0028 |
| reales | total | 35 | 94.2 % | 97.2 % | 93.2 % | 87.4 % | 0.0 % | 3/4 (FP 0) | 8.2 s | $0.0024 |
| sintéticas | sin alias | 10 | 88.9 % | 93.2 % | 93.2 % | 89.3 % | 0.0 % | 0/0 (FP 0) | 5.4 s | $0.0023 |
| sintéticas | con alias | 6 | 87.5 % | 89.7 % | 89.7 % | 83.8 % | 0.0 % | 0/0 (FP 0) | 2.7 s | $0.0026 |
| sintéticas | total | 16 | 88.3 % | 91.8 % | 91.8 % | 87.1 % | 0.0 % | 0/0 (FP 0) | 5.4 s | $0.0024 |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 4.4 s | 2427/987 | $0.0021 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 4.7 s | 2427/849 | $0.0019 |
| f03 | sin alias | P✓ F✗ N✗ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✗ no detectado | 2.7 s | 2427/834 | $0.0019 |
| f04 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 4/5 | 0/2/1/1 | – | 2.7 s | 2405/973 | $0.0021 |
| f05 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 2/9 | 0/8/0/1 | – | 5.6 s | 2427/1430 | $0.0028 |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 4.6 s | 2427/813 | $0.0018 |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/1/0 | – | 3.1 s | 2427/976 | $0.0021 |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 8.2 s | 2427/923 | $0.0020 |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 4.5 s | 2429/1380 | $0.0027 |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 3.3 s | 2427/690 | $0.0016 |
| f11 | sin alias | P✓ F✓ N✓ T✓ | 2/0/1 | 2/2 | 0/0/0/1 | – | 3.6 s | 2427/677 | $0.0016 |
| f12 | sin alias | P✓ F✓ N✗ T✓ | 41/0/0 | 40/41 | 0/30/0/8 | – | 11.4 s | 2391/5254 | $0.0085 |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 2.1 s | 2427/396 | $0.0012 |
| f14 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.5 s | 2427/846 | $0.0019 |
| f15 | sin alias | P✓ F✓ N✓ T✓ | 4/1/0 | 4/5 | 0/2/0/1 | – | 3.4 s | 2427/654 | $0.0016 |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | ✓ detectado (f07) | 3.6 s | 2427/917 | $0.0020 |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 2.9 s | 2427/843 | $0.0019 |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 3.8 s | 2427/306 | $0.0011 |
| f19 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/0/0/1 | – | 3.4 s | 2405/300 | $0.0011 |
| f20 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.3 s | 2427/343 | $0.0011 |
| f21 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.6 s | 2391/335 | $0.0011 |
| f22 | sin alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 5.4 s | 2391/1882 | $0.0034 |
| s01 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/7/0/0 | – | 4.0 s | 2391/1461 | $0.0028 |
| s02 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 10.0 s | 4816/2707 | $0.0053 |
| s03 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 5.4 s | 2400/1025 | $0.0021 |
| s04 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/5/0/1 | – | 4.8 s | 2391/1050 | $0.0022 |
| s05 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.6 s | 2383/1112 | $0.0023 |
| s06 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 3.5 s | 2391/818 | $0.0018 |
| s07 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.6 s | 2391/1082 | $0.0022 |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/0 | 0/0 | 0/0/0/0 | – | 2.0 s | 2419/69 | $0.0007 |
| s09 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.9 s | 2383/117 | $0.0008 |
| s10 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 5.4 s | 2391/1194 | $0.0024 |
| f02 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.9 s | 4087/740 | $0.0021 |
| f03 | con alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 4/1/0/0 | ✓ detectado (f02) | 2.7 s | 4087/783 | $0.0022 |
| f06 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.8 s | 7089/756 | $0.0029 |
| f07 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/6/0/0 | – | 6.7 s | 7091/931 | $0.0032 |
| f08 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.6 s | 7093/877 | $0.0031 |
| f09 | con alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 6.1 s | 7095/1246 | $0.0036 |
| f10 | con alias | error TIMEOUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| f13 | con alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 3.3 s | 6997/385 | $0.0023 |
| f14 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 5.4 s | 6791/748 | $0.0028 |
| f16 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 3/3/0/0 | ✓ detectado (f07) | 3.1 s | 6807/872 | $0.0030 |
| f17 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 4.0 s | 6880/674 | $0.0027 |
| f20 | con alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 7.9 s | 4157/291 | $0.0015 |
| f22 | con alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 4.6 s | 5355/1513 | $0.0036 |
| s02 (sintética) | con alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.2 s | 4816/2707 | $0.0053 |
| s05 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 2.5 s | 4027/762 | $0.0021 |
| s06 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.4 s | 4032/618 | $0.0019 |
| s07 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 2.7 s | 3999/808 | $0.0022 |
| s09 (sintética) | con alias | P✓ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.4 s | 5522/100 | $0.0015 |
| s10 (sintética) | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 2.7 s | 5481/870 | $0.0027 |

## Pares duplicados

Consistentes: 1/4 evaluables. No evaluables: 0.

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✗ | ✗ | date, number | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f07) | ✓ | – | 0/0 | 0 | 0 |
| con alias | f02 / f03 | ✓ (f02) | ✗ | supplier, date | 0/0 | 0 | 5 |
| con alias | f07 / f16 | ✓ (f07) | ✗ | – | 0/0 | 0 | 4 |

## Casos "no inventar"

- f07 (sin alias): ✓ ninguna línea inventada.
- f09 (sin alias): ✓ ninguna línea inventada.
- f11 (sin alias): ✗ 1 inventada(s):
  - #2 "542,14 POLAR PILSEN 222ML.. Bs 3.084,28" (línea tapada leída con confianza)
- f07 (con alias): ✓ ninguna línea inventada.
- f09 (con alias): ✓ ninguna línea inventada.

## Errores

- f10 (con alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.


## Pendientes por medir (google/gemini-3.1-flash-lite): 1

| Factura | Pasada | Motivo |
|---|---|---|
| f10 | conAlias | timeout del modelo (TIMEOUT) |

## Métricas solo sobre lo medido (50 de 51 entradas)

Sin las pendientes (que arriba cuentan como fallo). En conAlias, una anterior pendiente del mismo proveedor deja menos alias aprendidos.

| Pasada | Facturas | Cabecera | Líneas detectadas | Exactitud | Emparejadas OK | Confirmadas mal | p95 1 pág. (ms) | $/factura |
|---|---|---|---|---|---|---|---|---|
| sin alias | 32 | 94.3% | 97.0% | 92.9% | 87.2% | 0.0% | 8220 | $0.00218 |
| con alias | 18 | 94.4% | 96.2% | 96.1% | 91.1% | 0.0% | 7925 | $0.00272 |
| total | 50 | 94.4% | 96.7% | 94.0% | 88.5% | 0.0% | 7925 | $0.00237 |
