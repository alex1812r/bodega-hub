> Corrida: google / gemini-3.5-flash-lite — resume
> Pedido: --provider google --model gemini-3.5-flash-lite; few-shot sí
> Caché de extracciones (scripts/invoice-eval/cache): 50 de caché, 1 llamadas nuevas, 0 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.5-flash-lite

- Fecha: 2026-10-16T03:35:32.793Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 94.3 % | >= 90.0 % | ✓ |
| sin alias | Líneas detectadas | 97.5 % | >= 95.0 % | ✓ |
| sin alias | Cantidad/precio/total exactos | 97.0 % | >= 90.0 % | ✓ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 87.2 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 94.7 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 96.3 % | >= 95.0 % | ✓ |
| con alias | Cantidad/precio/total exactos | 96.3 % | >= 90.0 % | ✓ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 93.3 % | >= 90.0 % | ✓ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 6.8 s | <= 15.0 s | ✓ |
| total | Costo medio por factura | $0.0036 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 94.3 % | 97.5 % | 97.0 % | 87.2 % | 0.0 % | 2/2 (FP 0) | 14.8 s | $0.0035 |
| todas | con alias | 19 | 94.7 % | 96.3 % | 96.3 % | 93.3 % | 0.0 % | 2/2 (FP 0) | 6.8 s | $0.0039 |
| todas | total | 51 | 94.5 % | 97.1 % | 96.7 % | 89.4 % | 0.0 % | 4/4 (FP 0) | 6.8 s | $0.0036 |
| reales | sin alias | 22 | 96.6 % | 99.3 % | 98.6 % | 86.4 % | 0.0 % | 2/2 (FP 0) | 14.8 s | $0.0035 |
| reales | con alias | 13 | 98.1 % | 100.0 % | 100.0 % | 97.1 % | 0.0 % | 2/2 (FP 0) | 6.8 s | $0.0038 |
| reales | total | 35 | 97.1 % | 99.5 % | 99.0 % | 90.0 % | 0.0 % | 4/4 (FP 0) | 14.8 s | $0.0036 |
| sintéticas | sin alias | 10 | 88.9 % | 93.2 % | 93.2 % | 89.3 % | 0.0 % | 0/0 (FP 0) | 4.1 s | $0.0036 |
| sintéticas | con alias | 6 | 87.5 % | 89.7 % | 89.7 % | 86.5 % | 0.0 % | 0/0 (FP 0) | 3.4 s | $0.0041 |
| sintéticas | total | 16 | 88.3 % | 91.8 % | 91.8 % | 88.2 % | 0.0 % | 0/0 (FP 0) | 4.1 s | $0.0038 |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.6 s | 2427/1034 | $0.0033 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.9 s | 2427/849 | $0.0029 |
| f03 | sin alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✓ detectado (f02) | 2.7 s | 2427/845 | $0.0028 |
| f04 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/2/1/1 | – | 2.9 s | 2405/987 | $0.0032 |
| f05 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/8/0/1 | – | 3.7 s | 2427/1370 | $0.0042 |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.8 s | 2427/864 | $0.0029 |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/0/1 | – | 3.3 s | 2427/919 | $0.0030 |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.8 s | 2427/1056 | $0.0034 |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 4.6 s | 2429/1389 | $0.0042 |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 2.8 s | 2427/714 | $0.0025 |
| f11 | sin alias | P✓ F✓ N✓ T✓ | 3/0/0 | 2/2 | 0/1/0/1 | – | 2.5 s | 2427/641 | $0.0023 |
| f12 | sin alias | P✓ F✓ N✓ T✓ | 41/0/0 | 40/41 | 0/30/0/8 | – | 14.8 s | 2391/6794 | $0.0177 |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 1.9 s | 2427/456 | $0.0019 |
| f14 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.6 s | 2427/842 | $0.0028 |
| f15 | sin alias | P✓ F✓ N✓ T✓ | 4/1/0 | 4/5 | 0/2/0/1 | – | 2.6 s | 2427/651 | $0.0024 |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | ✓ detectado (f07) | 3.1 s | 2427/958 | $0.0031 |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 2.5 s | 2427/808 | $0.0027 |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 35.5 s | 2427/316 | $0.0015 |
| f19 | sin alias | P✓ F✗ N✓ T✓ | 1/0/0 | 1/1 | 0/0/0/1 | – | 1.7 s | 2405/344 | $0.0016 |
| f20 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.0 s | 2427/399 | $0.0017 |
| f21 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.5 s | 2391/366 | $0.0016 |
| f22 | sin alias | P✓ F✓ N✗ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 5.0 s | 2391/1707 | $0.0050 |
| s01 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/7/0/0 | – | 4.1 s | 2391/1460 | $0.0044 |
| s02 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.5 s | 4816/2819 | $0.0085 |
| s03 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.3 s | 2400/1204 | $0.0037 |
| s04 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/5/0/1 | – | 3.4 s | 2391/1291 | $0.0039 |
| s05 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.2 s | 2383/1146 | $0.0036 |
| s06 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 3.0 s | 2391/765 | $0.0026 |
| s07 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.6 s | 2391/1112 | $0.0035 |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/0 | 0/0 | 0/0/0/0 | – | 1.4 s | 2419/57 | $0.0009 |
| s09 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.7 s | 2383/91 | $0.0009 |
| s10 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.5 s | 2391/1246 | $0.0038 |
| f02 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 4.2 s | 4087/580 | $0.0027 |
| f03 | con alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 4/1/0/0 | ✓ detectado (f02) | 2.8 s | 4087/771 | $0.0032 |
| f06 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 4.0 s | 7089/563 | $0.0035 |
| f07 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/6/0/0 | – | 6.8 s | 7091/900 | $0.0044 |
| f08 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.5 s | 7093/900 | $0.0044 |
| f09 | con alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/8/0/0 | – | 4.4 s | 7095/1287 | $0.0053 |
| f10 | con alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 4.5 s | 7070/664 | $0.0038 |
| f13 | con alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 3.1 s | 6997/397 | $0.0031 |
| f14 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.7 s | 6791/413 | $0.0031 |
| f16 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 4/2/0/0 | ✓ detectado (f07) | 3.3 s | 6807/633 | $0.0036 |
| f17 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 2/2/0/1 | – | 2.9 s | 6880/772 | $0.0040 |
| f20 | con alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 2.3 s | 4157/332 | $0.0021 |
| f22 | con alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 4.8 s | 5355/1682 | $0.0058 |
| s02 (sintética) | con alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.4 s | 4816/2823 | $0.0085 |
| s05 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 2.9 s | 4027/928 | $0.0035 |
| s06 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.6 s | 4032/714 | $0.0030 |
| s07 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.9 s | 3999/914 | $0.0035 |
| s09 (sintética) | con alias | P✓ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.9 s | 5522/71 | $0.0018 |
| s10 (sintética) | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.4 s | 5481/997 | $0.0041 |

## Pares duplicados

Consistentes: 0/4 evaluables. No evaluables: 0.

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f07) | ✗ | – | 0/0 | 0 | 1 |
| con alias | f02 / f03 | ✓ (f02) | ✗ | date | 0/0 | 0 | 5 |
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
