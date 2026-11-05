// src/datos.ts (en memoria, solo para el taller)
export type Moneda = 'USD' | 'EUR' | 'COP';

export interface Billetera {
  id: string;
  moneda: Moneda;
  saldo: number; // centavos
}

export interface Cotizacion {
  cotizacionId: string;
  origen: Moneda;
  destino: Moneda;
  montoOrigen: number; // centavos
  montoDestino: number; // centavos
  tasa: number;
  creadaEnMs: number;
  expiraEnMs: number;
  expiraEn: string;
}

export interface Transferencia {
  transferenciaId: string;
  idempotenciaKey: string;
  origenId: string;
  destinoId: string;
  cotizacionId: string;
  monedaOrigen: Moneda;
  monedaDestino: Moneda;
  montoDebitado: number; // centavos
  montoAcreditado: number; // centavos
  tasaAplicada: number;
  saldoOrigenResultante: number; // centavos
  saldoDestinoResultante: number; // centavos
  creadaEn: string;
}

export const COTIZACION_TTL_MS = 60_000; // 60 segundos (Invariante R2)

export const TASAS_CAMBIO: Record<Moneda, Record<Moneda, number>> = {
  USD: { USD: 1, EUR: 0.92, COP: 4_000 },
  EUR: { USD: 1.09, EUR: 1, COP: 4_350 },
  COP: { USD: 0.00025, EUR: 0.00023, COP: 1 },
};

const BILLETERAS_INICIALES: ReadonlyArray<readonly [string, Billetera]> = [
  ['W-001', { id: 'W-001', moneda: 'USD', saldo: 50_000 }],
  ['W-002', { id: 'W-002', moneda: 'EUR', saldo: 10_000 }],
  ['W-003', { id: 'W-003', moneda: 'COP', saldo: 200_000_000 }],
];

export const billeteras = new Map<string, Billetera>(
  BILLETERAS_INICIALES.map(([id, b]) => [id, { ...b }])
);

export const cotizaciones = new Map<string, Cotizacion>();
export const transferencias = new Map<string, Transferencia>();
export const idempotenciaIndex = new Map<string, string>(); // idempotenciaKey -> transferenciaId

let secuenciaCotizacion = 1;
let secuenciaTransferencia = 1;

export function siguienteCotizacionId(): string {
  const id = `COT-${String(secuenciaCotizacion).padStart(3, '0')}`;
  secuenciaCotizacion += 1;
  return id;
}

export function siguienteTransferenciaId(): string {
  const id = `TRF-${String(secuenciaTransferencia).padStart(3, '0')}`;
  secuenciaTransferencia += 1;
  return id;
}

/**
 * Restaura el estado en memoria a sus valores iniciales (útil para tests unitarios).
 */
export function reiniciarDatos(): void {
  billeteras.clear();
  for (const [id, b] of BILLETERAS_INICIALES) {
    billeteras.set(id, { ...b });
  }
  cotizaciones.clear();
  transferencias.clear();
  idempotenciaIndex.clear();
  secuenciaCotizacion = 1;
  secuenciaTransferencia = 1;
}

