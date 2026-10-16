> Corrida: google / gemini-3.8-flash — sonda-2
> Pedido: --provider google --model gemini-3.8-flash; few-shot no; solo f01
> Caché de extracciones (scripts/invoice-eval/cache): 0 de caché, 1 llamadas nuevas, 0 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.8-flash

- Fecha: 2026-10-16T03:35:49.727Z
- Few-shot en "con alias": no (reutiliza la extracción sin alias)
- Facturas: 1 reales, 0 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 100.0 % | >= 90.0 % | ✓ |
| sin alias | Líneas detectadas | 100.0 % | >= 95.0 % | ✓ |
| sin alias | Cantidad/precio/total exactos | 100.0 % | >= 90.0 % | ✓ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 100.0 % | >= 70.0 % | ✓ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | – | >= 95.0 % | sin datos |
| con alias | Líneas detectadas | – | >= 95.0 % | sin datos |
| con alias | Cantidad/precio/total exactos | – | >= 90.0 % | sin datos |
| con alias | Emparejamiento correcto (conf. + dudosa) | – | >= 90.0 % | sin datos |
| con alias | Confirmadas mal | – | <= 2.0 % | sin datos |
| total | p95 tiempo (1 página) | 41.6 s | <= 15.0 s | ✗ |
| total | Costo medio por factura | $0.0110 | <= $0.0100 | ✗ |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | 0/0 (FP 0) | 41.6 s | $0.0110 |
| todas | con alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| todas | total | 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | 0/0 (FP 0) | 41.6 s | $0.0110 |
| reales | sin alias | 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | 0/0 (FP 0) | 41.6 s | $0.0110 |
| reales | con alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| reales | total | 1 | 100.0 % | 100.0 % | 100.0 % | 100.0 % | 0.0 % | 0/0 (FP 0) | 41.6 s | $0.0110 |
| sintéticas | sin alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| sintéticas | con alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| sintéticas | total | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | P✓ F✓ N✓ T✓ | 6/0/0 | 6/6 | 0/6/0/0 | – | 41.6 s | 2427/2446 | $0.0110 |

## Pares duplicados

Sin pares evaluados.

## Casos "no inventar"

Sin casos en esta corrida.

## Errores

Sin errores.


## Pendientes por medir (google/gemini-3.8-flash)

Ninguna: todas las extracciones de la corrida están medidas.
