> Corrida: google / gemini-3.5-flash-lite — it3-despues
> Pedido: --provider google --model gemini-3.5-flash-lite; few-shot sí
> Caché de extracciones (scripts/invoice-eval/cache): 0 de caché, 51 llamadas nuevas, 0 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.5-flash-lite

- Fecha: 2026-10-16T03:53:36.899Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 94.3 % | >= 90.0 % | ✓ |
| sin alias | Líneas detectadas | 97.0 % | >= 95.0 % | ✓ |
| sin alias | Cantidad/precio/total exactos | 93.4 % | >= 90.0 % | ✓ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 87.2 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 93.4 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 96.3 % | >= 95.0 % | ✓ |
| con alias | Cantidad/precio/total exactos | 96.3 % | >= 90.0 % | ✓ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 93.3 % | >= 90.0 % | ✓ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 5.2 s | <= 15.0 s | ✓ |
| total | Costo medio por factura | $0.0036 | <= $0.0100 | ✓ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 94.3 % | 97.0 % | 93.4 % | 87.2 % | 0.0 % | 2/2 (FP 0) | 7.0 s | $0.0035 |
| todas | con alias | 19 | 93.4 % | 96.3 % | 96.3 % | 93.3 % | 0.0 % | 2/2 (FP 0) | 5.2 s | $0.0038 |
| todas | total | 51 | 94.0 % | 96.8 % | 94.4 % | 89.4 % | 0.0 % | 4/4 (FP 0) | 5.2 s | $0.0036 |
| reales | sin alias | 22 | 96.6 % | 98.6 % | 93.5 % | 86.3 % | 0.0 % | 2/2 (FP 0) | 7.0 s | $0.0035 |
| reales | con alias | 13 | 98.1 % | 100.0 % | 100.0 % | 97.1 % | 0.0 % | 2/2 (FP 0) | 5.2 s | $0.0037 |
| reales | total | 35 | 97.1 % | 99.1 % | 95.7 % | 89.9 % | 0.0 % | 4/4 (FP 0) | 7.0 s | $0.0036 |
| sintéticas | sin alias | 10 | 88.9 % | 93.2 % | 93.2 % | 89.3 % | 0.0 % | 0/0 (FP 0) | 4.1 s | $0.0037 |
| sintéticas | con alias | 6 | 83.3 % | 89.7 % | 89.7 % | 86.5 % | 0.0 % | 0/0 (FP 0) | 4.6 s | $0.0041 |
| sintéticas | total | 16 | 86.7 % | 91.8 % | 91.8 % | 88.2 % | 0.0 % | 0/0 (FP 0) | 4.6 s | $0.0038 |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.5 s | 2683/955 | $0.0032 |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.9 s | 2683/863 | $0.0030 |
| f03 | sin alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | ✓ detectado (f02) | 2.9 s | 2683/880 | $0.0030 |
| f04 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/2/1/1 | – | 7.0 s | 2661/983 | $0.0033 |
| f05 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 2/9 | 0/8/0/1 | – | 3.7 s | 2683/1384 | $0.0043 |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.7 s | 2683/793 | $0.0028 |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/0/1 | – | 3.2 s | 2683/1061 | $0.0035 |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.0 s | 2683/1014 | $0.0033 |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 4.5 s | 2685/1321 | $0.0041 |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 2.8 s | 2683/724 | $0.0026 |
| f11 | sin alias | P✓ F✓ N✓ T✓ | 2/0/1 | 2/2 | 0/0/0/1 | – | 2.4 s | 2683/641 | $0.0024 |
| f12 | sin alias | P✓ F✓ N✓ T✓ | 41/0/0 | 40/41 | 0/30/0/8 | – | 12.2 s | 2647/5886 | $0.0155 |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 2.0 s | 2683/444 | $0.0019 |
| f14 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.6 s | 2683/842 | $0.0029 |
| f15 | sin alias | P✓ F✓ N✓ T✓ | 4/1/0 | 4/5 | 0/2/0/1 | – | 2.4 s | 2683/630 | $0.0024 |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | ✓ detectado (f07) | 2.9 s | 2683/923 | $0.0031 |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 3.1 s | 2683/865 | $0.0030 |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 1.7 s | 2683/334 | $0.0016 |
| f19 | sin alias | P✗ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/0/0/1 | – | 1.7 s | 2661/332 | $0.0016 |
| f20 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 3.1 s | 2683/343 | $0.0017 |
| f21 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 3.7 s | 2647/367 | $0.0017 |
| f22 | sin alias | P✓ F✓ N✗ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 4.9 s | 2647/1836 | $0.0054 |
| s01 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/7/0/0 | – | 4.1 s | 2647/1460 | $0.0044 |
| s02 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.4 s | 5328/2806 | $0.0086 |
| s03 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.2 s | 2656/1210 | $0.0038 |
| s04 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/5/0/1 | – | 3.4 s | 2647/1291 | $0.0040 |
| s05 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.1 s | 2639/1146 | $0.0037 |
| s06 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.6 s | 2647/875 | $0.0030 |
| s07 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.1 s | 2647/1107 | $0.0036 |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/0 | 0/0 | 0/0/0/0 | – | 2.5 s | 2675/57 | $0.0009 |
| s09 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.1 s | 2639/53 | $0.0009 |
| s10 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 3.8 s | 2647/1244 | $0.0039 |
| f02 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 4.3 s | 4343/829 | $0.0034 |
| f03 | con alias | P✓ F✗ N✓ T✓ | 5/0/0 | 5/5 | 4/1/0/0 | ✓ detectado (f02) | 2.3 s | 4343/606 | $0.0028 |
| f06 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 2.9 s | 7345/758 | $0.0041 |
| f07 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/6/0/0 | – | 2.7 s | 7347/646 | $0.0038 |
| f08 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 4.3 s | 7349/921 | $0.0045 |
| f09 | con alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/8/0/0 | – | 5.2 s | 7351/915 | $0.0045 |
| f10 | con alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 3.5 s | 7326/466 | $0.0034 |
| f13 | con alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 2.5 s | 7253/278 | $0.0029 |
| f14 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.2 s | 7047/787 | $0.0041 |
| f16 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 4/2/0/0 | ✓ detectado (f07) | 2.7 s | 7063/679 | $0.0038 |
| f17 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 3.6 s | 7136/520 | $0.0034 |
| f20 | con alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 1.7 s | 4413/277 | $0.0020 |
| f22 | con alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/9/0/1 | – | 4.8 s | 5611/1681 | $0.0059 |
| s02 (sintética) | con alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 7.4 s | 5328/2815 | $0.0086 |
| s05 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 3.3 s | 4283/669 | $0.0030 |
| s06 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/3/0/2 | – | 2.8 s | 4288/703 | $0.0030 |
| s07 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 3.2 s | 4255/950 | $0.0037 |
| s09 (sintética) | con alias | P✗ F✗ N✗ T✗ | 0/4/0 | 0/4 | 0/0/0/0 | – | 1.5 s | 5778/44 | $0.0018 |
| s10 (sintética) | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 4.6 s | 5737/1019 | $0.0043 |

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
- f11 (sin alias): ✗ 1 inventada(s):
  - #2 "542,14 OLAR PILSEN 222ML.. Bs 3.084,28" (línea tapada leída con confianza)
- f07 (con alias): ✓ ninguna línea inventada.
- f09 (con alias): ✓ ninguna línea inventada.

## Errores

Sin errores.


## Pendientes por medir (google/gemini-3.5-flash-lite)

Ninguna: todas las extracciones de la corrida están medidas.
