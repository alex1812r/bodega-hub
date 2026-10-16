> Corrida: oracle / verdad — it1-antes
> Pedido: --provider oracle; few-shot no (no aplica en oráculo)

# Banco de evaluación del escaneo: ORÁCULO (solo emparejamiento)

> **ORÁCULO: extracción = verdad; mide solo emparejamiento; NO es una métrica del modelo.**
> Cabecera, líneas, exactitud, tiempo y costo: n/a (la extracción es la verdad; 0 llamadas). Few-shot no aplica.

- Fecha: 2026-10-16T01:57:10.396Z
- Few-shot en "con alias": no (reutiliza la extracción sin alias)
- Facturas: 22 reales, 10 sintéticas
- Resultado global contra metas (solo metas de emparejamiento): ✓ cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | n/a (oráculo) | >= 90.0 % | n/a (oráculo) |
| sin alias | Líneas detectadas | n/a (oráculo) | >= 95.0 % | n/a (oráculo) |
| sin alias | Cantidad/precio/total exactos | n/a (oráculo) | >= 90.0 % | n/a (oráculo) |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 85.1 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | n/a (oráculo) | >= 95.0 % | n/a (oráculo) |
| con alias | Líneas detectadas | n/a (oráculo) | >= 95.0 % | n/a (oráculo) |
| con alias | Cantidad/precio/total exactos | n/a (oráculo) | >= 90.0 % | n/a (oráculo) |
| con alias | Emparejamiento correcto (conf. + dudosa) | 96.2 % | >= 90.0 % | ✓ |
| con alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| total | p95 tiempo (1 página) | n/a (oráculo) | <= 15.0 s | n/a (oráculo) |
| total | Costo medio por factura | n/a (oráculo) | <= $0.0100 | n/a (oráculo) |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 32 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 85.1 % | 0.0 % | 2/2 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| todas | con alias | 19 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 96.2 % | 0.0 % | 2/2 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| todas | total | 51 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 89.1 % | 0.0 % | 4/4 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| reales | sin alias | 22 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 81.1 % | 0.0 % | 2/2 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| reales | con alias | 13 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 95.6 % | 0.0 % | 2/2 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| reales | total | 35 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 86.0 % | 0.0 % | 4/4 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| sintéticas | sin alias | 10 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 94.6 % | 0.0 % | 0/0 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| sintéticas | con alias | 6 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 97.3 % | 0.0 % | 0/0 (FP 0) | n/a (oráculo) | n/a (oráculo) |
| sintéticas | total | 16 | n/a (oráculo) | n/a (oráculo) | n/a (oráculo) | 95.7 % | 0.0 % | 0/0 (FP 0) | n/a (oráculo) | n/a (oráculo) |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/5/0/1 | – | 0.0 s | – | – |
| f02 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 0.0 s | – | – |
| f03 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | ✓ detectado (f02) | 0.0 s | – | – |
| f04 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/2/0/2 | – | 0.0 s | – | – |
| f05 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/2 | – | 0.0 s | – | – |
| f06 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 0.0 s | – | – |
| f07 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 0/5/0/1 | – | 0.0 s | – | – |
| f08 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 0.0 s | – | – |
| f09 | sin alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 0/7/0/1 | – | 0.0 s | – | – |
| f10 | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/4/0/0 | – | 0.0 s | – | – |
| f11 | sin alias | P✓ F✓ N✓ T✓ | 3/0/0 | 2/2 | 0/1/0/1 | – | 0.0 s | – | – |
| f12 | sin alias | P✓ F✓ N✓ T✓ | 41/0/0 | 41/41 | 0/30/0/8 | – | 0.0 s | – | – |
| f13 | sin alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 0/2/0/0 | – | 0.0 s | – | – |
| f14 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 0.0 s | – | – |
| f15 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/1/0/2 | – | 0.0 s | – | – |
| f16 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/5/0/1 | ✓ detectado (f07) | 0.0 s | – | – |
| f17 | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 0.0 s | – | – |
| f18 | sin alias | P✓ F✓ N– T✓ | 1/0/0 | 1/1 | 0/0/0/0 | – | 0.0 s | – | – |
| f19 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/0/0/1 | – | 0.0 s | – | – |
| f20 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 0.0 s | – | – |
| f21 | sin alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | 0.0 s | – | – |
| f22 | sin alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/8/0/2 | – | 0.0 s | – | – |
| s01 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/7/0/0 | – | 0.0 s | – | – |
| s02 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | 0.0 s | – | – |
| s03 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 0.0 s | – | – |
| s04 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 7/0/0 | 7/7 | 0/4/0/2 | – | 0.0 s | – | – |
| s05 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | 0.0 s | – | – |
| s06 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | 0.0 s | – | – |
| s07 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | 0.0 s | – | – |
| s08 (sintética) | sin alias | P– F– N– T– | 0/0/0 | 0/0 | 0/0/0/0 | – | 0.0 s | – | – |
| s09 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/3/0/0 | – | 0.0 s | – | – |
| s10 (sintética) | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 0.0 s | – | – |
| f02 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 2/3/0/0 | – | (reutilizada) | – | – |
| f03 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 4/1/0/0 | ✓ detectado (f02) | (reutilizada) | – | – |
| f06 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 2/3/0/0 | – | (reutilizada) | – | – |
| f07 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 4/4 | 4/2/0/0 | – | (reutilizada) | – | – |
| f08 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 3/3/0/0 | – | (reutilizada) | – | – |
| f09 | con alias | P✓ F✓ N✓ T✓ | 9/0/0 | 9/9 | 4/4/0/0 | – | (reutilizada) | – | – |
| f10 | con alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 3/1/0/0 | – | (reutilizada) | – | – |
| f13 | con alias | P✓ F✓ N✓ T✓ | 2/0/0 | 2/2 | 1/1/0/0 | – | (reutilizada) | – | – |
| f14 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 2/3/0/0 | – | (reutilizada) | – | – |
| f16 | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 4/2/0/0 | ✓ detectado (f07) | (reutilizada) | – | – |
| f17 | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 3/1/0/1 | – | (reutilizada) | – | – |
| f20 | con alias | P✓ F✓ N✓ T✓ | 1/0/0 | 1/1 | 0/1/0/0 | – | (reutilizada) | – | – |
| f22 | con alias | P✓ F✓ N✓ T✓ | 11/0/0 | 11/11 | 0/8/0/2 | – | (reutilizada) | – | – |
| s02 (sintética) | con alias | P✓ F✓ N✓ T✓ | 14/0/0 | 14/14 | 0/14/0/0 | – | (reutilizada) | – | – |
| s05 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/0 | – | (reutilizada) | – | – |
| s06 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/4/0/1 | – | (reutilizada) | – | – |
| s07 (sintética) | con alias | P✓ F✓ N✓ T✓ | 5/0/0 | 5/5 | 0/5/0/0 | – | (reutilizada) | – | – |
| s09 (sintética) | con alias | P✓ F✓ N✓ T✓ | 4/0/0 | 4/4 | 0/3/0/0 | – | (reutilizada) | – | – |
| s10 (sintética) | con alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | (reutilizada) | – | – |

## Pares duplicados

| Bucket | Par | Detectado | Consistente | Cabecera distinta | Sin par (orig./dup.) | Valores distintos | Emparejamiento distinto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sin alias | f02 / f03 | ✓ (f02) | ✓ | – | 0/0 | 0 | 0 |
| sin alias | f07 / f16 | ✓ (f07) | ✓ | – | 0/0 | 0 | 0 |
| con alias | f02 / f03 | ✓ (f02) | ✗ | – | 0/0 | 0 | 2 |
| con alias | f07 / f16 | ✓ (f07) | ✓ | – | 0/0 | 0 | 0 |

## Casos "no inventar"

- f07 (sin alias): ✓ ninguna línea inventada.
- f09 (sin alias): ✓ ninguna línea inventada.
- f07 (con alias): ✓ ninguna línea inventada.
- f09 (con alias): ✓ ninguna línea inventada.

## Errores

Sin errores.
