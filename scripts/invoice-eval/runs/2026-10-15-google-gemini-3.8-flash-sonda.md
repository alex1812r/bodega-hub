> Corrida: google / gemini-3.8-flash — sonda
> Pedido: --provider google --model gemini-3.8-flash; few-shot no; solo f01
> Caché de extracciones (scripts/invoice-eval/cache): 0 de caché, 0 llamadas nuevas, 1 llamadas con error (no cacheadas). Tokens y duración de las de caché son los de su llamada original.

# Banco de evaluación del escaneo: google / gemini-3.8-flash

- Fecha: 2026-10-16T03:04:23.477Z
- Few-shot en "con alias": no (reutiliza la extracción sin alias)
- Facturas: 1 reales, 0 sintéticas
- Resultado global contra metas: ✗ no cumple

## Metas (plan §10)

| Ámbito | Métrica | Valor | Meta | Resultado |
| --- | --- | --- | --- | --- |
| sin alias | Campos de cabecera | 0.0 % | >= 90.0 % | ✗ |
| sin alias | Líneas detectadas | 0.0 % | >= 95.0 % | ✗ |
| sin alias | Cantidad/precio/total exactos | 0.0 % | >= 90.0 % | ✗ |
| sin alias | Emparejamiento correcto (conf. + dudosa) | 0.0 % | >= 70.0 % | ✗ |
| sin alias | Confirmadas mal | 0.0 % | <= 2.0 % | ✓ |
| con alias | Campos de cabecera | – | >= 95.0 % | sin datos |
| con alias | Líneas detectadas | – | >= 95.0 % | sin datos |
| con alias | Cantidad/precio/total exactos | – | >= 90.0 % | sin datos |
| con alias | Emparejamiento correcto (conf. + dudosa) | – | >= 90.0 % | sin datos |
| con alias | Confirmadas mal | – | <= 2.0 % | sin datos |
| total | p95 tiempo (1 página) | – | <= 15.0 s | sin datos |
| total | Costo medio por factura | – | <= $0.0100 | sin datos |

## Global por bucket

| Ámbito | Bucket | Facturas | Cabecera | Líneas | Exactas | Emparejamiento | Confirmadas mal | Duplicados | p95 1 pág. | $ medio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| todas | sin alias | 1 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| todas | con alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| todas | total | 1 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| reales | sin alias | 1 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| reales | con alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| reales | total | 1 | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0.0 % | 0/0 (FP 0) | – | – |
| sintéticas | sin alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| sintéticas | con alias | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |
| sintéticas | total | 0 | – | – | – | – | – | 0/0 (FP 0) | – | – |

## Por factura

Cabecera: P proveedor, F fecha, N número, T total. Líneas: TP/FN/FP. Emparejamiento: confirmadas ok / dudosas ok / mal / sin emparejar.

| Factura | Bucket | Cabecera | Líneas | Exactas | Emparejamiento | Duplicado | Tiempo | Tokens in/out | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f01 | sin alias | error TIMEOUT | 0/6/0 | 0/6 | 0/0/0/0 | – | – | – | – |

## Pares duplicados

Sin pares evaluados.

## Casos "no inventar"

Sin casos en esta corrida.

## Errores

- f01 (sin alias) [TIMEOUT]: La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.


## Pendientes por medir (google/gemini-3.8-flash): 1

| Factura | Pasada | Motivo |
|---|---|---|
| f01 | sinAlias | timeout del modelo (TIMEOUT) |
