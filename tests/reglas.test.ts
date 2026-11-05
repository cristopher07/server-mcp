import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { billeteras, reiniciarDatos } from '../src/datos.js';
import {
  crearCotizacion,
  ejecutarTransferencia,
  obtenerBilletera,
} from '../src/reglas.js';

describe('Invariantes de negocio en reglas.ts (SPEC-TRANSFER / SPEC-MCP)', () => {
  beforeEach(() => {
    reiniciarDatos();
  });

  it('Consulta el saldo de una billetera existente y rechaza una inexistente', () => {
    const ok = obtenerBilletera('W-001');
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.datos.saldo, 50_000);
      assert.equal(ok.datos.moneda, 'USD');
    }

    const fallo = obtenerBilletera('W-999');
    assert.equal(fallo.ok, false);
    if (!fallo.ok) {
      assert.equal(fallo.codigo, 'BILLETERA_NO_EXISTE');
      assert.match(fallo.mensaje, /W-001/);
    }
  });

  it('R1: Ninguna tool deja una billetera en negativo (SALDO_INSUFICIENTE)', () => {
    const ahora = 1_700_000_000_000;
    // W-001 tiene 50_000 centavos USD; intentamos transferir 60_000 centavos USD
    const cotizacion = crearCotizacion(
      { origen: 'USD', destino: 'EUR', monto: 60_000 },
      ahora
    );

    const resultado = ejecutarTransferencia(
      {
        origenId: 'W-001',
        destinoId: 'W-002',
        cotizacionId: cotizacion.cotizacionId,
        idempotenciaKey: 'idem-saldo-insuficiente',
      },
      ahora + 1_000
    );

    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.codigo, 'SALDO_INSUFICIENTE');
    }
    // El saldo de W-001 permanece intacto y no negativo
    assert.equal(billeteras.get('W-001')?.saldo, 50_000);
  });

  it('R2: Toda transferencia usa una cotización < 60 s (COTIZACION_VENCIDA)', () => {
    const t0 = 1_700_000_000_000;
    const cotizacion = crearCotizacion(
      { origen: 'USD', destino: 'EUR', monto: 10_000 },
      t0
    );

    // Intentamos usar la cotización exactamente a los 60 segundos (60_000 ms)
    const resultadoVencido = ejecutarTransferencia(
      {
        origenId: 'W-001',
        destinoId: 'W-002',
        cotizacionId: cotizacion.cotizacionId,
        idempotenciaKey: 'idem-cotizacion-vencida',
      },
      t0 + 60_000
    );

    assert.equal(resultadoVencido.ok, false);
    if (!resultadoVencido.ok) {
      assert.equal(resultadoVencido.codigo, 'COTIZACION_VENCIDA');
    }
    assert.equal(billeteras.get('W-001')?.saldo, 50_000);
  });

  it('R3: crear_transferencia es idempotente ante llamadas repetidas con la misma idempotenciaKey', () => {
    const t0 = 1_700_000_000_000;
    const cotizacion = crearCotizacion(
      { origen: 'USD', destino: 'EUR', monto: 10_000 },
      t0
    );

    const primera = ejecutarTransferencia(
      {
        origenId: 'W-001',
        destinoId: 'W-002',
        cotizacionId: cotizacion.cotizacionId,
        idempotenciaKey: 'idem-001',
      },
      t0 + 5_000
    );

    assert.equal(primera.ok, true);
    if (primera.ok) {
      assert.equal(primera.datos.idempotente, false);
      assert.equal(primera.datos.saldoOrigenResultante, 40_000);
    }

    // Segunda llamada con la misma clave de idempotencia: no debe volver a descontar saldo
    const segunda = ejecutarTransferencia(
      {
        origenId: 'W-001',
        destinoId: 'W-002',
        cotizacionId: cotizacion.cotizacionId,
        idempotenciaKey: 'idem-001',
      },
      t0 + 10_000
    );

    assert.equal(segunda.ok, true);
    if (primera.ok && segunda.ok) {
      assert.equal(segunda.datos.idempotente, true);
      assert.equal(segunda.datos.transferenciaId, primera.datos.transferenciaId);
      assert.equal(billeteras.get('W-001')?.saldo, 40_000);
    }
  });
});

