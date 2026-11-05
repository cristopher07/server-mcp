// src/reglas.ts — Lógica de negocio e invariantes puras (sin dependencias de MCP)
import {
  Billetera,
  COTIZACION_TTL_MS,
  Moneda,
  TASAS_CAMBIO,
  Transferencia,
  billeteras,
  cotizaciones,
  idempotenciaIndex,
  siguienteCotizacionId,
  siguienteTransferenciaId,
  transferencias,
} from './datos.js';

export type CodigoErrorNegocio =
  | 'BILLETERA_NO_EXISTE'
  | 'BILLETERA_MISMA_ORIGEN_DESTINO'
  | 'MONTO_INVALIDO'
  | 'COTIZACION_NO_EXISTE'
  | 'COTIZACION_VENCIDA'
  | 'MONEDA_INCOMPATIBLE'
  | 'SALDO_INSUFICIENTE';

export interface ErrorNegocio {
  ok: false;
  codigo: CodigoErrorNegocio;
  mensaje: string;
  accionSugerida: string;
}

export interface ResultadoExito<T> {
  ok: true;
  datos: T;
}

export type ResultadoOperacion<T> = ResultadoExito<T> | ErrorNegocio;

export interface CrearCotizacionInput {
  origen: Moneda;
  destino: Moneda;
  monto: number; // centavos de origen
}

export interface CotizacionOutput {
  [key: string]: unknown;
  cotizacionId: string;
  tasa: number;
  montoDestino: number;
  expiraEn: string;
}

export interface CrearTransferenciaInput {
  origenId: string;
  destinoId: string;
  cotizacionId: string;
  idempotenciaKey: string;
}

export interface TransferenciaOutput extends Transferencia {
  [key: string]: unknown;
  idempotente: boolean;
}

/**
 * Consulta el saldo de una billetera validando que exista.
 */
export function obtenerBilletera(billeteraId: string): ResultadoOperacion<Billetera> {
  const b = billeteras.get(billeteraId);
  if (!b) {
    const validas = [...billeteras.keys()].join(', ');
    return {
      ok: false,
      codigo: 'BILLETERA_NO_EXISTE',
      mensaje: `No existe ${billeteraId}. Válidas: ${validas}`,
      accionSugerida: `Usa uno de los IDs de billetera válidos (${validas}).`,
    };
  }
  return { ok: true, datos: { ...b } };
}

/**
 * Crea una cotización congelada por 60 segundos (TTL = 60_000 ms).
 */
export function crearCotizacion(
  args: CrearCotizacionInput,
  ahoraMs: number = Date.now()
): CotizacionOutput {
  if (!Number.isInteger(args.monto) || args.monto <= 0) {
    throw new Error('El monto a cotizar debe ser un entero positivo en centavos.');
  }

  const tasa = TASAS_CAMBIO[args.origen][args.destino];
  const montoDestino = Math.max(1, Math.round(args.monto * tasa));
  const cotizacionId = siguienteCotizacionId();
  const expiraEnMs = ahoraMs + COTIZACION_TTL_MS;
  const expiraEn = new Date(expiraEnMs).toISOString();

  cotizaciones.set(cotizacionId, {
    cotizacionId,
    origen: args.origen,
    destino: args.destino,
    montoOrigen: args.monto,
    montoDestino,
    tasa,
    creadaEnMs: ahoraMs,
    expiraEnMs,
    expiraEn,
  });

  return {
    cotizacionId,
    tasa,
    montoDestino,
    expiraEn,
  };
}

/**
 * Ejecuta una transferencia entre dos billeteras garantizando:
 * - R1: Ninguna tool deja una billetera en negativo.
 * - R2: Toda transferencia usa una cotización < 60 s.
 * - R3: crear_transferencia es idempotente.
 */
export function ejecutarTransferencia(
  args: CrearTransferenciaInput,
  ahoraMs: number = Date.now()
): ResultadoOperacion<TransferenciaOutput> {
  const claveIdempotencia = args.idempotenciaKey.trim();

  // Invariante R3: Idempotencia — Si la clave ya se procesó, devolver la transferencia existente sin volver a cobrar.
  const transferenciaPreviaId = idempotenciaIndex.get(claveIdempotencia);
  if (transferenciaPreviaId) {
    const previa = transferencias.get(transferenciaPreviaId);
    if (previa) {
      return {
        ok: true,
        datos: {
          ...previa,
          idempotente: true,
        },
      };
    }
  }

  const billeteraOrigen = billeteras.get(args.origenId);
  if (!billeteraOrigen) {
    const validas = [...billeteras.keys()].join(', ');
    return {
      ok: false,
      codigo: 'BILLETERA_NO_EXISTE',
      mensaje: `[BILLETERA_NO_EXISTE] No existe la billetera de origen "${args.origenId}". Válidas: ${validas}.`,
      accionSugerida: `Verifica el ID de la billetera de origen. Opciones válidas: ${validas}.`,
    };
  }

  const billeteraDestino = billeteras.get(args.destinoId);
  if (!billeteraDestino) {
    const validas = [...billeteras.keys()].join(', ');
    return {
      ok: false,
      codigo: 'BILLETERA_NO_EXISTE',
      mensaje: `[BILLETERA_NO_EXISTE] No existe la billetera de destino "${args.destinoId}". Válidas: ${validas}.`,
      accionSugerida: `Verifica el ID de la billetera de destino. Opciones válidas: ${validas}.`,
    };
  }

  if (billeteraOrigen.id === billeteraDestino.id) {
    return {
      ok: false,
      codigo: 'BILLETERA_MISMA_ORIGEN_DESTINO',
      mensaje: `[BILLETERA_MISMA_ORIGEN_DESTINO] La billetera origen y destino no pueden ser la misma (${billeteraOrigen.id}).`,
      accionSugerida: 'Selecciona una billetera de destino distinta a la de origen.',
    };
  }

  const cotizacion = cotizaciones.get(args.cotizacionId);
  if (!cotizacion) {
    return {
      ok: false,
      codigo: 'COTIZACION_NO_EXISTE',
      mensaje: `[COTIZACION_NO_EXISTE] No existe la cotización "${args.cotizacionId}".`,
      accionSugerida: 'Llama primero a la tool "cotizar" para obtener un cotizacionId válido.',
    };
  }

  // Invariante R2: Toda transferencia usa una cotización < 60 s.
  const edadCotizacionMs = ahoraMs - cotizacion.creadaEnMs;
  if (edadCotizacionMs >= COTIZACION_TTL_MS || ahoraMs >= cotizacion.expiraEnMs) {
    return {
      ok: false,
      codigo: 'COTIZACION_VENCIDA',
      mensaje: `[COTIZACION_VENCIDA] La cotización "${args.cotizacionId}" expiró a los ${Math.floor(edadCotizacionMs / 1000)} s (máximo permitido: 60 s).`,
      accionSugerida: 'Invoca nuevamente la tool "cotizar" para congelar una tasa nueva por 60 s y reintenta.',
    };
  }

  // Validar correspondencia de monedas entre las billeteras y la cotización
  if (
    cotizacion.origen !== billeteraOrigen.moneda ||
    cotizacion.destino !== billeteraDestino.moneda
  ) {
    return {
      ok: false,
      codigo: 'MONEDA_INCOMPATIBLE',
      mensaje: `[MONEDA_INCOMPATIBLE] La cotización ${args.cotizacionId} es ${cotizacion.origen}->${cotizacion.destino}, pero las billeteras son ${billeteraOrigen.moneda}->${billeteraDestino.moneda}.`,
      accionSugerida: `Genera una nueva cotización con origen="${billeteraOrigen.moneda}" y destino="${billeteraDestino.moneda}".`,
    };
  }

  // Invariante R1: Ninguna tool deja una billetera en negativo.
  if (billeteraOrigen.saldo < cotizacion.montoOrigen) {
    return {
      ok: false,
      codigo: 'SALDO_INSUFICIENTE',
      mensaje: `[SALDO_INSUFICIENTE] La billetera ${billeteraOrigen.id} tiene ${billeteraOrigen.saldo} centavos ${billeteraOrigen.moneda}, pero la transferencia requiere ${cotizacion.montoOrigen} centavos ${billeteraOrigen.moneda}.`,
      accionSugerida: `Consulta el saldo con "consultar_saldo" y cotiza un monto menor o igual a ${billeteraOrigen.saldo} centavos.`,
    };
  }

  // Aplicar débito y crédito atómicamente en memoria
  billeteraOrigen.saldo -= cotizacion.montoOrigen;
  billeteraDestino.saldo += cotizacion.montoDestino;

  const transferenciaId = siguienteTransferenciaId();
  const registro: Transferencia = {
    transferenciaId,
    idempotenciaKey: claveIdempotencia,
    origenId: billeteraOrigen.id,
    destinoId: billeteraDestino.id,
    cotizacionId: cotizacion.cotizacionId,
    monedaOrigen: billeteraOrigen.moneda,
    monedaDestino: billeteraDestino.moneda,
    montoDebitado: cotizacion.montoOrigen,
    montoAcreditado: cotizacion.montoDestino,
    tasaAplicada: cotizacion.tasa,
    saldoOrigenResultante: billeteraOrigen.saldo,
    saldoDestinoResultante: billeteraDestino.saldo,
    creadaEn: new Date(ahoraMs).toISOString(),
  };

  transferencias.set(transferenciaId, registro);
  idempotenciaIndex.set(claveIdempotencia, transferenciaId);

  return {
    ok: true,
    datos: {
      ...registro,
      idempotente: false,
    },
  };
}

/**
 * Obtiene el estado completo de una billetera junto con su historial de transferencias.
 */
export function obtenerEstadoCompletoBilletera(billeteraId: string): {
  billetera: Billetera;
  saldoFormateado: string;
  transferenciasRelacionadas: Transferencia[];
} | null {
  const b = billeteras.get(billeteraId);
  if (!b) {
    return null;
  }

  const historial = [...transferencias.values()].filter(
    (t) => t.origenId === billeteraId || t.destinoId === billeteraId
  );

  return {
    billetera: { ...b },
    saldoFormateado: `${(b.saldo / 100).toFixed(2)} ${b.moneda} (${b.saldo} centavos)`,
    transferenciasRelacionadas: historial,
  };
}

