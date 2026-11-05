# .specs/SPEC-MCP.md

## Objetivo
Permitir que un agente opere billeteras sin violar las invariantes de SPEC-TRANSFER.

## Reglas
R1. Ninguna tool deja una billetera en negativo.
R2. Toda transferencia usa una cotización < 60 s.
R3. crear_transferencia es idempotente.

## Superficie del Servidor MCP (`billeteras`)

| Tipo | Nombre | Propósito |
| :--- | :--- | :--- |
| **Tool** | `consultar_saldo` | Saldo de una billetera en centavos (solo lectura). |
| **Tool** | `cotizar` | Congela tasa de conversión por 60 s y devuelve `cotizacionId`. |
| **Tool** | `crear_transferencia` | Mueve dinero entre billeteras con una cotización vigente e idempotencia. |
| **Resource** | `specs://SPEC-TRANSFER` | Reglas de negocio e invariantes para el modelo. |
| **Resource** | `billetera://{id}` | Estado completo de una billetera (saldo, moneda e historial). |
| **Prompt** | `auditar_transferencia` | Revisión guiada de una operación contra las invariantes R1, R2 y R3. |

