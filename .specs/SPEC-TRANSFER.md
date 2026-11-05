# Especificación de Dominio: Transferencias entre Billeteras (SPEC-TRANSFER)

## 1. Modelo de Datos y Unidades
- **Unidades monetarias:** Todos los montos y saldos se expresan estrictamente en **centavos enteros** (`number` entero) para evitar errores de redondeo en punto flotante.
  - Ejemplo: `50_000` centavos de `USD` equivalen a `500.00 USD`.
- **Monedas soportadas (`Moneda`):** `'USD' | 'EUR' | 'COP'`.

## 2. Invariantes de Negocio Obligatorias
- **R1 — Prohibición de saldo negativo:** Ninguna operación puede dejar el saldo de una billetera por debajo de `0` centavos (`saldo >= 0`). Si el monto de origen de la cotización supera el saldo disponible en la billetera origen, la operación debe rechazarse con código `SALDO_INSUFICIENTE`.
- **R2 — Vigencia de cotización (< 60 segundos):** Toda transferencia requiere un `cotizacionId` emitido previamente por la herramienta `cotizar`. La cotización tiene un tiempo de vida (TTL) estricto de **60 segundos** desde su creación. Si han transcurrido `>= 60_000 ms`, debe rechazarse con código `COTIZACION_VENCIDA`.
- **R3 — Idempotencia en `crear_transferencia`:** Toda solicitud de transferencia incluye una clave `idempotenciaKey`. Si se recibe más de una llamada con la misma `idempotenciaKey`, el servidor **no** vuelve a debitar ni acreditar las billeteras; devuelve exactamente el resultado de la transferencia original marcando `idempotente: true`.

## 3. Códigos de Error de Negocio (`isError: true`)
Cuando una regla de negocio falla, las tools devuelven `isError: true` con un mensaje descriptivo que incluye el código y la acción sugerida para que el agente pueda recuperarse:
- `BILLETERA_NO_EXISTE`: El ID de billetera no existe; se listan los IDs válidos.
- `COTIZACION_NO_EXISTE`: El `cotizacionId` no fue encontrado; se indica llamar a `cotizar`.
- `COTIZACION_VENCIDA`: La cotización superó los 60 s de vigencia; se indica generar una nueva con `cotizar`.
- `MONEDA_INCOMPATIBLE`: Las monedas de la cotización no coinciden con las monedas de las billeteras origen/destino.
- `BILLETERA_MISMA_ORIGEN_DESTINO`: La billetera de origen y destino no pueden ser la misma.
- `SALDO_INSUFICIENTE`: El saldo disponible es menor al monto requerido por la cotización.

