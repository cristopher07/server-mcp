import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../src/index.js';
import { reiniciarDatos } from '../src/datos.js';

async function crearSesionMcp() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new StdioServerTransport(stdin, stdout);
  const server = createServer();
  await server.connect(transport);

  let buffer = '';
  const colaRespuestas: Array<(msg: Record<string, unknown>) => void> = [];

  stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lineas = buffer.split('\n');
    buffer = lineas.pop() ?? '';
    for (const linea of lineas) {
      const limpia = linea.trim();
      if (!limpia) continue;
      const json = JSON.parse(limpia) as Record<string, unknown>;
      const resolver = colaRespuestas.shift();
      if (resolver) resolver(json);
    }
  });

  const enviarRpc = (mensaje: Record<string, unknown>): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      colaRespuestas.push(resolve);
      stdin.write(`${JSON.stringify(mensaje)}\n`);
    });

  // Handshake initialize
  await enviarRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
  );

  return {
    enviarRpc,
    cerrar: async () => {
      stdin.end();
      await server.close();
    },
  };
}

describe('Protocolo MCP completo (3 tools, 2 resources, 1 prompt)', () => {
  beforeEach(() => {
    reiniciarDatos();
  });

  it('Lista las 3 tools, los 2 resources y el prompt correctamente', async () => {
    const sesion = await crearSesionMcp();
    try {
      const toolsRes = (await sesion.enviarRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })) as { result: { tools: Array<{ name: string }> } };

      const nombresTools = toolsRes.result.tools.map((t) => t.name).sort();
      assert.deepEqual(nombresTools, [
        'consultar_saldo',
        'cotizar',
        'crear_transferencia',
      ]);

      const resourcesRes = (await sesion.enviarRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/list',
        params: {},
      })) as { result: { resources: Array<{ uri: string }> } };
      assert.equal(
        resourcesRes.result.resources.some((r) => r.uri === 'specs://SPEC-TRANSFER'),
        true
      );
      assert.equal(
        resourcesRes.result.resources.some((r) => r.uri === 'billetera://W-001'),
        true
      );

      const promptsRes = (await sesion.enviarRpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'prompts/list',
        params: {},
      })) as { result: { prompts: Array<{ name: string }> } };
      assert.deepEqual(
        promptsRes.result.prompts.map((p) => p.name),
        ['auditar_transferencia']
      );
    } finally {
      await sesion.cerrar();
    }
  });

  it('Ejecuta flujo completo MCP: consultar_saldo -> cotizar -> crear_transferencia y maneja isError', async () => {
    const sesion = await crearSesionMcp();
    try {
      // 1. consultar_saldo con ID inválido devuelve isError: true
      const errSaldo = (await sesion.enviarRpc({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'consultar_saldo',
          arguments: { billeteraId: 'W-999' },
        },
      })) as { result: { isError?: boolean; content: Array<{ text: string }> } };
      assert.equal(errSaldo.result.isError, true);
      assert.match(errSaldo.result.content[0]?.text ?? '', /No existe W-999/);

      // 2. cotizar USD -> EUR
      const cotRes = (await sesion.enviarRpc({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'cotizar',
          arguments: { origen: 'USD', destino: 'EUR', monto: 10_000 },
        },
      })) as {
        result: {
          structuredContent: { cotizacionId: string; montoDestino: number };
        };
      };
      const cotizacionId = cotRes.result.structuredContent.cotizacionId;
      assert.equal(cotizacionId, 'COT-001');

      // 3. crear_transferencia usando cotizacionId
      const trfRes = (await sesion.enviarRpc({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'crear_transferencia',
          arguments: {
            origenId: 'W-001',
            destinoId: 'W-002',
            cotizacionId,
            idempotenciaKey: 'mcp-e2e-1',
          },
        },
      })) as {
        result: {
          structuredContent: {
            transferenciaId: string;
            saldoOrigenResultante: number;
          };
        };
      };
      assert.equal(trfRes.result.structuredContent.transferenciaId, 'TRF-001');
      assert.equal(trfRes.result.structuredContent.saldoOrigenResultante, 40_000);
    } finally {
      await sesion.cerrar();
    }
  });
});

