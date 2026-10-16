> Corrida: google / gemini-3.1-flash-lite — it3-despues-b
> Pedido: --provider google --model gemini-3.1-flash-lite; few-shot sí
> Caché de extracciones (scripts/invoice-eval/cache): 0 de caché, 48 llamadas nuevas, 3 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.1-flash-lite

- Fecha: 2026-10-16T04:04:16.658Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 88.6 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 92.5 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 88.9 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 82.9 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 93.4 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 96.3 % | >= 95.0 % | ✓ |
| con alias | Cantidad/precio/total exactos | 96.3 % | >= 90.0 % | ✓ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 91.4 % | >= 90.0 % | ✓ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 16.9 s | <= 15.0 s | ✗ |
| total | Costo medio por factura | $0.0025 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 88.6 % | 92.5 % | 88.9 % | 82.9 % | 0.0 % | 2/2 (FP 0) | 21.2 s | $0.0023 |
| todas | con alias | 19 | 93.4 % | 96.3 % | 96.3 % | 91.4 % | 0.0 % | 2/2 (FP 0) | 16.9 s | $0.0029 |
| todas | total | 51 | 90.5 % | 93.9 % | 91.5 % | 86.0 % | 0.0 % | 4/4 (FP 0) | 16.9 s | $0.0025 |
| reales | sin alias | 22 | 93.1 % | 94.4 % | 92.1 % | 83.2 % | 0.0 % | 2/2 (FP 0) | 21.2 s | $0.0023 |
| reales | con alias | 13 | 98.1 % | 100.0 % | 100.0 % | 95.6 % | 0.0 % | 2/2 (FP 0) | 16.9 s | $0.0029 |
| reales | total | 35 | 95.0 % | 96.2 % | 94.7 % | 87.4 % | 0.0 % | 4/4 (FP 0) | 21.2 s | $0.0025 |
| sintéticas | sin alias | 10 | 77.8 % | 88.1 % | 81.4 % | 82.1 % | 0.0 % | 0/0 (FP 0) | 12.2 s | $0.0025 |
| sintéticas | con alias | 6 | 83.3 % | 89.7 % | 89.7 % | 83.8 % | 0.0 % | 0/0 (FP 0) | 8.0 s | $0.0030 |
| sintéticas | total | 16 | 80.0 % | 88.8 % | 84.7 % | 82.8 % | 0.0 % | 0/0 (FP 0) | 12.2 s | $0.0027 |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 4.1 s | 2783/1006 | $0.0022 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 7.0 s | 2783/794 | $0.0019 |
| f03 | sin alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✓ detectado (f02) | 2.5 s | 2783/801 | $0.0019 |
| f04 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 4/5 | 0/2/1/1 | – | 3.2 s | 2761/1024 | $0.0022 |
| f05 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/8/0/1 | – | 3.5 s | 2783/1434 | $0.0028 |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.7 s | 2783/797 | $0.0019 |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/1/0 | – | 2.9 s | 2783/926 | $0.0021 |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.2 s | 2783/992 | $0.0022 |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 10.5 s | 2785/1349 | $0.0027 |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 8.6 s | 2783/623 | $0.0016 |
| f11 | sin alias | P✓ F✓ N✓ T✓ | 2/0/1 | 2/2 | 0/0/0/1 | – | 6.5 s | 2783/664 | $0.0017 |
| f12 | sin alias | P✓ F✓ N✗ T✓ | 40/1/0 | 37/41 | 0/30/0/7 | – | 21.2 s | 2747/5324 | $0.0087 |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 1.8 s | 2783/397 | $0.0013 |
| f14 | sin alias | error TIMEOUT | 0/5/0 | 0/5 | 0/0/0/0 | – | – | – | – |
| f15 | sin alias | P✓ F✓ N✓ T✓ | 4/1/0 | 4/5 | 0/2/0/1 | – | 3.8 s | 2783/667 | $0.0017 |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | ✓ detectado (f07) | 3.0 s | 2783/934 | $0.0021 |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 15.5 s | 2783/843 | $0.0020 |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 33.6 s | 2783/346 | $0.0012 |
| f19 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.1 s | 2761/324 | $0.0012 |
| f20 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 1.8 s | 2783/343 | $0.0012 |
| f21 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.6 s | 2747/351 | $0.0012 |
| f22 | sin alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 5.7 s | 2747/1928 | $0.0036 |
| s01 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/7/0/0 | – | 3.9 s | 2747/1443 | $0.0029 |
| s02 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.3 s | 5528/2710 | $0.0054 |
| s03 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.9 s | 2756/1267 | $0.0026 |
| s04 (sintética) | sin alias | error TIMEOUT | 0/7/0 | 0/7 | 0/0/0/0 | – | – | – | – |
| s05 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.7 s | 2739/1065 | $0.0023 |
| s06 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.8 s | 2747/792 | $0.0019 |
| s07 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 12.2 s | 2747/1093 | $0.0023 |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/0 | 0/0 | 0/0/0/0 | – | 2.0 s | 2775/69 | $0.0008 |
| s09 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 4/0/0 | 0/4 | 0/1/0/2 | – | 8.2 s | 2739/684 | $0.0017 |
| s10 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.3 s | 2747/1194 | $0.0025 |
| f02 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.0 s | 4443/802 | $0.0023 |
| f03 | con alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 4/1/0/0 | ✓ detectado (f02) | 2.9 s | 4443/777 | $0.0023 |
| f06 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 4.0 s | 7445/756 | $0.0030 |
| f07 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/6/0/0 | – | 3.0 s | 7447/895 | $0.0032 |
| f08 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.1 s | 7449/877 | $0.0032 |
| f09 | con alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 4.2 s | 7451/1246 | $0.0037 |
| f10 | con alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 10.8 s | 7426/627 | $0.0028 |
| f13 | con alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 16.9 s | 7353/383 | $0.0024 |
| f14 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 8.1 s | 7147/750 | $0.0029 |
| f16 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 4/2/0/0 | ✓ detectado (f07) | 6.5 s | 7163/876 | $0.0031 |
| f17 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 3.1 s | 7236/749 | $0.0029 |
| f20 | con alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 1.9 s | 4513/297 | $0.0016 |
| f22 | con alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 4.3 s | 5711/1510 | $0.0037 |
| s02 (sintética) | con alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 8.5 s | 5528/2710 | $0.0054 |
| s05 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.2 s | 4383/762 | $0.0022 |
| s06 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.8 s | 4388/686 | $0.0021 |
| s07 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 3.0 s | 4355/772 | $0.0022 |
| s09 (sintética) | con alias | error TIMEOUT | 0/4/0 | 0/4 | 0/0/0/0 | – | – | – | – |
| s10 (sintética) | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 8.0 s | 5837/874 | $0.0028 |

## Pares duplicados

Consistentes: 1/4 evaluables. No evaluables: 0.

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f07) | ✓ | – | 0/0 | 0 | 0 |
| con alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 5 |
| con alias | f07 / f16 | ✓ (f07) | ✗ | – | 0/0 | 0 | 6 |

## Casos "no inventar"

- f07 (sin alias): ✓ ninguna línea inventada.
- f09 (sin alias): ✓ ninguna línea inventada.
- f11 (sin alias): ✗ 1 inventada(s):
  - #2 "542,14 POLAR PILSEN 222ML.. Bs 3.084,28" (línea tapada leída con confianza)
- f07 (con alias): ✓ ninguna línea inventada.
- f09 (con alias): ✓ ninguna línea inventada.

## Errores

- f14 (sin alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.
- s04 (sintética) (sin alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.
- s09 (sintética) (con alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.


## Pendientes por medir (google/gemini-3.1-flash-lite): 3

| Factura | Pasada | Motivo |
|---|---|---|
| f14 | sinAlias | timeout del modelo (TIMEOUT) |
| s04 | sinAlias | timeout del modelo (TIMEOUT) |
| s09 | conAlias | timeout del modelo (TIMEOUT) |

## Métricas solo sobre lo medido (48 de 51 entradas)

Sin las pendientes (que arriba cuentan como fallo). En conAlias, una anterior pendiente del mismo proveedor deja menos alias aprendidos.

| Pasada | Facturas | Cabecera | Líneas detectadas | Exactitud | Emparejadas OK | Confirmadas mal | p95 1 pág. (ms) | $/factura |
|---|---|---|---|---|---|---|---|---|
| sin alias | 30 | 94.8% | 98.4% | 94.6% | 88.1% | 0.0% | 21240 | $0.00232 |
| con alias | 18 | 98.6% | 100.0% | 100.0% | 94.1% | 0.0% | 16938 | $0.00289 |
| total | 48 | 96.3% | 99.0% | 96.5% | 90.3% | 0.0% | 16938 | $0.00254 |
