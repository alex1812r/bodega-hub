> Corrida: google / gemini-3.5-flash-lite — it3-despues-b
> Pedido: --provider google --model gemini-3.5-flash-lite; few-shot sí
> Caché de extracciones (scripts/invoice-eval/cache): 0 de caché, 51 llamadas nuevas, 0 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.5-flash-lite

- Fecha: 2026-10-16T03:59:12.657Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 94.3 % | >= 90.0 % | ✓ |
| sin alias | Líneas detectadas | 97.5 % | >= 95.0 % | ✓ |
| sin alias | Cantidad/precio/total exactos | 94.9 % | >= 90.0 % | ✓ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 87.8 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 93.4 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 96.3 % | >= 95.0 % | ✓ |
| con alias | Cantidad/precio/total exactos | 96.3 % | >= 90.0 % | ✓ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 92.4 % | >= 90.0 % | ✓ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 5.2 s | <= 15.0 s | ✓ |
| total | Costo medio por factura | $0.0038 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 94.3 % | 97.5 % | 94.9 % | 87.8 % | 0.0 % | 2/2 (FP 0) | 5.2 s | $0.0036 |
| todas | con alias | 19 | 93.4 % | 96.3 % | 96.3 % | 92.4 % | 0.0 % | 2/2 (FP 0) | 5.7 s | $0.0040 |
| todas | total | 51 | 94.0 % | 97.1 % | 95.4 % | 89.4 % | 0.0 % | 4/4 (FP 0) | 5.2 s | $0.0038 |
| reales | sin alias | 22 | 96.6 % | 99.3 % | 95.7 % | 87.1 % | 0.0 % | 2/2 (FP 0) | 5.2 s | $0.0036 |
| reales | con alias | 13 | 98.1 % | 100.0 % | 100.0 % | 95.6 % | 0.0 % | 2/2 (FP 0) | 5.7 s | $0.0040 |
| reales | total | 35 | 97.1 % | 99.5 % | 97.1 % | 90.0 % | 0.0 % | 4/4 (FP 0) | 5.7 s | $0.0037 |
| sintéticas | sin alias | 10 | 88.9 % | 93.2 % | 93.2 % | 89.3 % | 0.0 % | 0/0 (FP 0) | 3.8 s | $0.0037 |
| sintéticas | con alias | 6 | 83.3 % | 89.7 % | 89.7 % | 86.5 % | 0.0 % | 0/0 (FP 0) | 3.6 s | $0.0042 |
| sintéticas | total | 16 | 86.7 % | 91.8 % | 91.8 % | 88.2 % | 0.0 % | 0/0 (FP 0) | 3.8 s | $0.0039 |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.5 s | 2783/930 | $0.0032 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.9 s | 2783/845 | $0.0029 |
| f03 | sin alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✓ detectado (f02) | 2.9 s | 2783/860 | $0.0030 |
| f04 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/2/1/1 | – | 2.9 s | 2761/960 | $0.0032 |
| f05 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/8/0/1 | – | 3.8 s | 2783/1415 | $0.0044 |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.8 s | 2783/805 | $0.0028 |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/0/1 | – | 2.9 s | 2783/908 | $0.0031 |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.1 s | 2783/1005 | $0.0033 |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 4.8 s | 2785/1483 | $0.0045 |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 2.4 s | 2783/750 | $0.0027 |
| f11 | sin alias | P✗ F✓ N✓ T✓ | 3/0/0 | 1/2 | 0/1/0/1 | – | 3.4 s | 2783/639 | $0.0024 |
| f12 | sin alias | P✓ F✓ N✓ T✓ | 41/0/0 | 37/41 | 0/31/0/7 | – | 14.1 s | 2747/6763 | $0.0177 |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 2.0 s | 2783/442 | $0.0019 |
| f14 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.7 s | 2783/823 | $0.0029 |
| f15 | sin alias | P✓ F✓ N✓ T✓ | 4/1/0 | 4/5 | 0/2/0/1 | – | 2.4 s | 2783/690 | $0.0026 |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | ✓ detectado (f07) | 2.8 s | 2783/857 | $0.0030 |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 3.4 s | 2783/853 | $0.0030 |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 1.9 s | 2783/315 | $0.0016 |
| f19 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/0/0/1 | – | 1.7 s | 2761/317 | $0.0016 |
| f20 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 1.7 s | 2783/348 | $0.0017 |
| f21 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.1 s | 2747/366 | $0.0017 |
| f22 | sin alias | P✓ F✓ N✗ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 5.2 s | 2747/1926 | $0.0056 |
| s01 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/7/0/0 | – | 3.8 s | 2747/1490 | $0.0045 |
| s02 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 11.5 s | 5528/2764 | $0.0086 |
| s03 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.5 s | 2756/1210 | $0.0039 |
| s04 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/5/0/1 | – | 3.5 s | 2747/1274 | $0.0040 |
| s05 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.2 s | 2739/1065 | $0.0035 |
| s06 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.6 s | 2747/852 | $0.0030 |
| s07 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.5 s | 2747/1094 | $0.0036 |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/0 | 0/0 | 0/0/0/0 | – | 1.3 s | 2775/57 | $0.0010 |
| s09 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.3 s | 2739/95 | $0.0011 |
| s10 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.5 s | 2747/1244 | $0.0039 |
| f02 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.9 s | 4443/802 | $0.0033 |
| f03 | con alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✓ detectado (f02) | 5.1 s | 4443/841 | $0.0034 |
| f06 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.0 s | 7445/787 | $0.0042 |
| f07 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/6/0/0 | – | 3.6 s | 7447/900 | $0.0045 |
| f08 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.6 s | 7449/968 | $0.0047 |
| f09 | con alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 3.4 s | 7451/929 | $0.0046 |
| f10 | con alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 3.9 s | 7426/658 | $0.0039 |
| f13 | con alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 2.5 s | 7353/278 | $0.0029 |
| f14 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.6 s | 7147/695 | $0.0039 |
| f16 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 4/2/0/0 | ✓ detectado (f07) | 3.6 s | 7163/658 | $0.0038 |
| f17 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 2/2/0/1 | – | 3.2 s | 7236/793 | $0.0042 |
| f20 | con alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 1.7 s | 4513/330 | $0.0022 |
| f22 | con alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 5.7 s | 5711/1684 | $0.0059 |
| s02 (sintética) | con alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.4 s | 5528/2806 | $0.0087 |
| s05 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.1 s | 4383/949 | $0.0037 |
| s06 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.4 s | 4388/656 | $0.0030 |
| s07 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.3 s | 4355/918 | $0.0036 |
| s09 (sintética) | con alias | P✗ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.6 s | 5878/41 | $0.0019 |
| s10 (sintética) | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.6 s | 5837/1027 | $0.0043 |

## Pares duplicados

Consistentes: 0/4 evaluables. No evaluables: 0.

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f07) | ✗ | – | 0/0 | 0 | 1 |
| con alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 0 |
| con alias | f07 / f16 | ✓ (f07) | ✗ | – | 0/0 | 0 | 6 |

## Casos "no inventar"

- f07 (sin alias): ✓ ninguna línea inventada.
- f09 (sin alias): ✓ ninguna línea inventada.
- f07 (con alias): ✓ ninguna línea inventada.
- f09 (con alias): ✓ ninguna línea inventada.

## Errores

Sin errores.


## Pendientes por medir (google/gemini-3.5-flash-lite)

Ninguna: todas las extracciones de la corrida están medidas.
