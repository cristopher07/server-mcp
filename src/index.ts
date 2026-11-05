import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { billeteras, transferencias } from './datos.js';
import {
  crearCotizacion,
  ejecutarTransferencia,
  obtenerEstadoCompletoBilletera,
} from './reglas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer(): McpServer {
  const server = new McpServer({ name: 'billeteras', version: '0.1.0' });

  // ============================================================================
  // TOOL 1: consultar_saldo (Paso 3)
  // ============================================================================
  server.registerTool(
    'consultar_saldo',
    {
      description: 'Saldo disponible de una billetera, en centavos.',
      inputSchema: z.object({
        billeteraId: z.string().describe('ID de la billetera, ej. W-001'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ billeteraId }) => {
      const b = billeteras.get(billeteraId);
      if (!b) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No existe ${billeteraId}. Válidas: ${[...billeteras.keys()]}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `${b.saldo} centavos ${b.moneda}`,
          },
        ],
      };
    }
  );

  // ============================================================================
  // TOOL 2: cotizar (Paso 7 — Resultados estructurados)
  // ============================================================================
  server.registerTool(
    'cotizar',
    {
      description:
        'Cotiza una conversión. Válida 60 s; pasa el cotizacionId a crear_transferencia.',
      inputSchema: z.object({
        origen: z.enum(['USD', 'EUR', 'COP']),
        destino: z.enum(['USD', 'EUR', 'COP']),
        monto: z.number().int().positive().describe('Centavos de origen'),
      }),
      outputSchema: z.object({
        cotizacionId: z.string(),
        tasa: z.number(),
        montoDestino: z.number().int(),
        expiraEn: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const c = crearCotizacion(args); // guarda con TTL de 60 s
      return {
        structuredContent: c,
        content: [{ type: 'text', text: JSON.stringify(c) }],
      };
    }
  );

  // ============================================================================
  // TOOL 3: crear_transferencia (Invariantes R1, R2, R3 + Errores de negocio)
  // ============================================================================
  server.registerTool(
    'crear_transferencia',
    {
      description:
        'Mueve dinero entre dos billeteras usando un cotizacionId vigente (< 60 s). Es idempotente mediante idempotenciaKey y nunca deja saldos en negativo.',
      inputSchema: z.object({
        origenId: z.string().describe('ID de la billetera origen, ej. W-001'),
        destinoId: z.string().describe('ID de la billetera destino, ej. W-002'),
        cotizacionId: z
          .string()
          .describe('ID de la cotización vigente emitida por la tool cotizar, ej. COT-001'),
        idempotenciaKey: z
          .string()
          .min(1)
          .describe('Clave única de idempotencia para evitar cobros duplicados'),
      }),
      outputSchema: z.object({
        transferenciaId: z.string(),
        idempotenciaKey: z.string(),
        origenId: z.string(),
        destinoId: z.string(),
        cotizacionId: z.string(),
        monedaOrigen: z.enum(['USD', 'EUR', 'COP']),
        monedaDestino: z.enum(['USD', 'EUR', 'COP']),
        montoDebitado: z.number().int(),
        montoAcreditado: z.number().int(),
        tasaAplicada: z.number(),
        saldoOrigenResultante: z.number().int(),
        saldoDestinoResultante: z.number().int(),
        creadaEn: z.string(),
        idempotente: z.boolean(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      const resultado = ejecutarTransferencia(args);
      if (!resultado.ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `${resultado.mensaje} Qué hacer: ${resultado.accionSugerida}`,
            },
          ],
        };
      }

      return {
        structuredContent: resultado.datos,
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultado.datos),
          },
        ],
      };
    }
  );

  // ============================================================================
  // RESOURCE 1: specs://SPEC-TRANSFER (Reglas de negocio para el modelo)
  // ============================================================================
  server.registerResource(
    'spec-transfer',
    'specs://SPEC-TRANSFER',
    {
      title: 'Especificación e Invariantes de Transferencias (SPEC-TRANSFER)',
      description: 'Reglas de negocio e invariantes obligatorias (R1, R2, R3) para operar billeteras.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const specTransferPath = path.resolve(__dirname, '../.specs/SPEC-TRANSFER.md');
      const specMcpPath = path.resolve(__dirname, '../.specs/SPEC-MCP.md');

      const [specTransfer, specMcp] = await Promise.all([
        fs.readFile(specTransferPath, 'utf-8'),
        fs.readFile(specMcpPath, 'utf-8'),
      ]);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: `${specMcp}\n\n---\n\n${specTransfer}`,
          },
        ],
      };
    }
  );

  // ============================================================================
  // RESOURCE 2: billetera://{id} (Estado completo de una billetera)
  // ============================================================================
  const billeteraTemplate = new ResourceTemplate('billetera://{id}', {
    list: async () => ({
      resources: [...billeteras.values()].map((b) => ({
        uri: `billetera://${b.id}`,
        name: `Billetera ${b.id} (${b.moneda})`,
        description: `Estado completo y movimientos de la billetera ${b.id}`,
        mimeType: 'application/json',
      })),
    }),
    complete: {
      id: (valor) =>
        [...billeteras.keys()].filter((id) =>
          id.toLowerCase().startsWith(valor.toLowerCase())
        ),
    },
  });

  server.registerResource(
    'billetera',
    billeteraTemplate,
    {
      title: 'Estado completo de una billetera',
      description: 'Consulta el saldo actual en centavos, moneda e historial de transferencias de una billetera.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawId = variables.id;
      const billeteraId = Array.isArray(rawId) ? rawId[0] ?? '' : String(rawId ?? '');
      const estado = obtenerEstadoCompletoBilletera(billeteraId);

      if (!estado) {
        throw new Error(
          `No existe la billetera ${billeteraId}. Válidas: ${[...billeteras.keys()].join(', ')}`
        );
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(estado, null, 2),
          },
        ],
      };
    }
  );

  // ============================================================================
  // PROMPT: auditar_transferencia (Revisión guiada contra invariantes)
  // ============================================================================
  server.registerPrompt(
    'auditar_transferencia',
    {
      title: 'Auditar transferencia contra invariantes',
      description:
        'Revisión guiada de una transferencia o billetera verificando el cumplimiento de las invariantes R1, R2 y R3.',
      argsSchema: z.object({
        transferenciaId: z
          .string()
          .optional()
          .describe('ID de la transferencia a auditar (ej. TRF-001)'),
        billeteraId: z
          .string()
          .optional()
          .describe('ID de la billetera a revisar (ej. W-001)'),
      }),
    },
    ({ transferenciaId, billeteraId }) => {
      const resumenBilleteras = [...billeteras.values()]
        .map((b) => `- ${b.id}: ${b.saldo} centavos ${b.moneda}`)
        .join('\n');

      const trf = transferenciaId ? transferencias.get(transferenciaId) : undefined;
      const detalleTransferencia = trf
        ? JSON.stringify(trf, null, 2)
        : transferenciaId
          ? `No se encontró la transferencia ${transferenciaId}.`
          : `Total de transferencias registradas: ${transferencias.size}`;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'Actúa como auditor financiero y verifica el cumplimiento estricto de las invariantes definidas en `specs://SPEC-TRANSFER`:',
                '1. R1: Ninguna billetera quedó con saldo negativo (saldo >= 0 centavos).',
                '2. R2: La transferencia utilizó una cotización vigente (< 60 segundos).',
                '3. R3: Se respetó la idempotencia mediante `idempotenciaKey`.',
                '',
                billeteraId ? `Billetera bajo revisión: ${billeteraId}` : '',
                'Estado actual de billeteras:',
                resumenBilleteras,
                '',
                'Datos de transferencia:',
                detalleTransferencia,
              ]
                .filter(Boolean)
                .join('\n'),
            },
          },
        ],
      };
    }
  );

  return server;
}

// Ejecutar por stdio cuando se invoca el archivo directamente
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  void serveStdio(createServer);
  console.error('billeteras MCP listo (stdio)'); // stderr
}

