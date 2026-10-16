> Corrida: mock / invoice-scan-mock
> Pedido: --provider mock; few-shot sí

# Banco de evaluación del escaneo: mock / invoice-scan-mock

- Fecha: 2026-10-16T01:38:22.708Z
- Few-shot en "con alias": sí
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 0.8 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 12.8 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 2.2 % | >= 70.0 % | ✗ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | 0.0 % | >= 95.0 % | ✗ |
| con alias | Líneas detectadas | 16.7 % | >= 95.0 % | ✗ |
| con alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| con alias | Emparejamiento correcto (conf. + dudosa) | 2.9 % | >= 90.0 % | ✗ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | 0.0 s | <= 15.0 s | ✓ |
| total | Costo medio por factura | – | <= $0.0100 | sin datos |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | 0.8 % | 12.8 % | 0.0 % | 2.2 % | 0.0 % | 2/2 (FP 29) | 0.0 s | – |
| todas | con alias | 19 | 0.0 % | 16.7 % | 0.0 % | 2.9 % | 0.0 % | 2/2 (FP 17) | 0.0 s | – |
| todas | total | 51 | 0.5 % | 14.2 % | 0.0 % | 2.4 % | 0.0 % | 4/4 (FP 46) | 0.0 s | – |
| reales | sin alias | 22 | 1.1 % | 8.9 % | 0.0 % | 0.8 % | 0.0 % | 2/2 (FP 19) | 0.0 s | – |
| reales | con alias | 13 | 0.0 % | 13.3 % | 0.0 % | 1.5 % | 0.0 % | 2/2 (FP 11) | 0.0 s | – |
| reales | total | 35 | 0.7 % | 10.4 % | 0.0 % | 1.0 % | 0.0 % | 4/4 (FP 30) | 0.0 s | – |
| sintéticas | sin alias | 10 | 0.0 % | 22.7 % | 0.0 % | 5.4 % | 0.0 % | 0/0 (FP 10) | 0.0 s | – |
| sintéticas | con alias | 6 | 0.0 % | 23.3 % | 0.0 % | 5.4 % | 0.0 % | 0/0 (FP 6) | 0.0 s | – |
| sintéticas | total | 16 | 0.0 % | 22.9 % | 0.0 % | 5.4 % | 0.0 % | 0/0 (FP 16) | 0.0 s | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✗ F✓ N✗ T✗ | 1/5/1 | 0/6 | 0/0/1/0 | – | 0.0 s | 0/0 | – |
| f02 | sin alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f03 | sin alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✓ detectado (f01) | 0.0 s | 0/0 | – |
| f04 | sin alias | P✗ F✗ N✗ T✗ | 0/5/2 | 0/5 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f05 | sin alias | P✗ F✗ N✗ T✗ | 1/8/1 | 0/9 | 0/0/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f06 | sin alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f07 | sin alias | P✗ F✗ N✗ T✗ | 0/4/2 | 0/4 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f08 | sin alias | P✗ F✗ N✗ T✗ | 1/5/1 | 0/6 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f09 | sin alias | P✗ F✗ N✗ T✗ | 1/8/1 | 0/9 | 0/1/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f10 | sin alias | P✗ F✗ N✗ T✗ | 1/3/1 | 0/4 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f11 | sin alias | P✗ F✗ N✗ T✗ | 0/2/2 | 0/2 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f12 | sin alias | P✗ F✗ N✗ T✗ | 2/39/0 | 0/41 | 0/0/1/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f13 | sin alias | P✗ F✗ N✗ T✗ | 1/1/1 | 0/2 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f14 | sin alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f15 | sin alias | P✗ F✗ N✗ T✗ | 0/5/2 | 0/5 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f16 | sin alias | P✗ F✗ N✗ T✗ | 1/5/1 | 0/6 | 0/0/1/0 | ✓ detectado (f01) | 0.0 s | 0/0 | – |
| f17 | sin alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f18 | sin alias | P✗ F✗ N– T✗ | 0/1/2 | 0/1 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f19 | sin alias | P✗ F✗ N✗ T✗ | 0/1/2 | 0/1 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f20 | sin alias | P✗ F✗ N✗ T✗ | 0/1/2 | 0/1 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f21 | sin alias | P✗ F✗ N✗ T✗ | 0/1/2 | 0/1 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f22 | sin alias | P✗ F✗ N✗ T✗ | 1/10/1 | 0/11 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s01 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 1/6/1 | 0/7 | 0/0/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s02 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 4/10/0 | 0/14 | 0/1/1/2 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s03 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 2/4/0 | 0/6 | 0/0/1/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s04 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 2/5/0 | 0/7 | 0/1/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s05 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 2/3/0 | 0/5 | 0/0/1/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s06 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s07 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 0/5/2 | 0/5 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/2 | 0/0 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s09 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 1/3/1 | 0/4 | 0/0/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s10 (sintética) | sin alias | P✗ F✗ N✗ T✗ | 2/4/0 | 0/6 | 0/1/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f02 | con alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f03 | con alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✓ detectado (f01) | 0.0 s | 0/0 | – |
| f06 | con alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f07 | con alias | P✗ F✗ N✗ T✗ | 0/4/2 | 0/4 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f08 | con alias | P✗ F✗ N✗ T✗ | 1/5/1 | 0/6 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f09 | con alias | P✗ F✗ N✗ T✗ | 1/8/1 | 0/9 | 0/1/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f10 | con alias | P✗ F✗ N✗ T✗ | 1/3/1 | 0/4 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f13 | con alias | P✗ F✗ N✗ T✗ | 1/1/1 | 0/2 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f14 | con alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f16 | con alias | P✗ F✗ N✗ T✗ | 1/5/1 | 0/6 | 0/0/1/0 | ✓ detectado (f01) | 0.0 s | 0/0 | – |
| f17 | con alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f20 | con alias | P✗ F✗ N✗ T✗ | 0/1/2 | 0/1 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| f22 | con alias | P✗ F✗ N✗ T✗ | 1/10/1 | 0/11 | 0/0/1/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s02 (sintética) | con alias | P✗ F✗ N✗ T✗ | 4/10/0 | 0/14 | 0/1/1/2 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s05 (sintética) | con alias | P✗ F✗ N✗ T✗ | 2/3/0 | 0/5 | 0/0/1/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s06 (sintética) | con alias | P✗ F✗ N✗ T✗ | 1/4/1 | 0/5 | 0/0/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s07 (sintética) | con alias | P✗ F✗ N✗ T✗ | 0/5/2 | 0/5 | 0/0/0/0 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s09 (sintética) | con alias | P✗ F✗ N✗ T✗ | 1/3/1 | 0/4 | 0/0/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |
| s10 (sintética) | con alias | P✗ F✗ N✗ T✗ | 2/4/0 | 0/6 | 0/1/0/1 | ✗ falso positivo (f01) | 0.0 s | 0/0 | – |

## Pares duplicados

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f01) | ✓ | – | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f01) | ✓ | – | 0/0 | 0 | 0 |
| con alias | f02 / f03 | ✓ (f01) | ✓ | – | 0/0 | 0 | 0 |
| con alias | f07 / f16 | ✓ (f01) | ✓ | – | 0/0 | 0 | 0 |

## Casos "no inventar"

- f07 (sin alias): ✗ 2 inventada(s):
  - #0 "1 MALTA 1.5L [BULTO X 6] 4.203,12 4.203,12" (línea tapada leída con confianza)
  - #1 "2 HARINA PAN 1KG [CAJA X 20] (E) 9.631,20 19.262,40" (sin línea en la verdad)
- f09 (sin alias): ✗ 1 inventada(s):
  - #1 "2 HARINA PAN 1KG [CAJA X 20] (E) 9.631,20 19.262,40" (sin línea en la verdad)
- f07 (con alias): ✗ 2 inventada(s):
  - #0 "1 MALTA 1.5L [BULTO X 6] 4.203,12 4.203,12" (línea tapada leída con confianza)
  - #1 "2 HARINA PAN 1KG [CAJA X 20] (E) 9.631,20 19.262,40" (sin línea en la verdad)
- f09 (con alias): ✗ 1 inventada(s):
  - #1 "2 HARINA PAN 1KG [CAJA X 20] (E) 9.631,20 19.262,40" (sin línea en la verdad)

## Errores

Sin errores.
