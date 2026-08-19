import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Hash simple con sal aleatoria (scrypt, incluido en Node, sin dependencias
// nuevas) para la clave única de supervisor. No es un sistema de cuentas de
// usuario — solo evita guardar el PIN en texto plano en la base de datos.
export function hashClave(clave: string): string {
  const sal = randomBytes(16).toString("hex");
  const hash = scryptSync(clave, sal, 64).toString("hex");
  return `${sal}:${hash}`;
}

export function verificarClave(clave: string, hashGuardado: string): boolean {
  const [sal, hashOriginal] = hashGuardado.split(":");
  if (!sal || !hashOriginal) return false;
  const hashIntento = scryptSync(clave, sal, 64).toString("hex");
  const bufOriginal = Buffer.from(hashOriginal, "hex");
  const bufIntento = Buffer.from(hashIntento, "hex");
  if (bufOriginal.length !== bufIntento.length) return false;
  return timingSafeEqual(bufOriginal, bufIntento);
}

// --- Bloqueo tras varios intentos fallidos seguidos ---
//
// Revisión de seguridad (agosto 2026): como el servidor no pide ninguna
// otra credencial para hablarle a la API (se confía en que la red WiFi del
// local ya es de confianza — decisión tomada con el usuario), la clave de
// supervisor podía probarse las veces que se quisiera sin ningún freno.
// Este bloqueo en memoria (un solo proceso de servidor, no hace falta
// persistirlo — un reinicio del programa ya "resetea" el contador, lo
// cual es razonable) corta un intento de adivinarla a la fuerza, sin
// afectar el tipeo normal de alguien equivocándose una o dos veces.
const MAX_INTENTOS_FALLIDOS = 5;
const DURACION_BLOQUEO_MS = 60 * 1000;

interface EstadoIntentos {
  fallidos: number;
  bloqueadoHasta: number | null;
}

const intentosPorIdentificador = new Map<string, EstadoIntentos>();

function segundosBloqueadoRestantes(identificador: string): number | null {
  const estado = intentosPorIdentificador.get(identificador);
  if (!estado?.bloqueadoHasta) return null;
  const restanteMs = estado.bloqueadoHasta - Date.now();
  if (restanteMs <= 0) {
    intentosPorIdentificador.delete(identificador);
    return null;
  }
  return Math.ceil(restanteMs / 1000);
}

export interface ResultadoVerificacionClave {
  valida: boolean;
  bloqueado: boolean;
  segundosRestantes?: number;
}

// Envuelve verificarClave() con el bloqueo — usar esta versión en
// cualquier endpoint que reciba la clave de supervisor directo de una
// petición HTTP, pasando algo que identifique al equipo que la manda
// (ej. req.ip), para que el contador de intentos fallidos sea por equipo,
// no global (así un tablet que se equivoca no bloquea la caja principal).
export function verificarClaveConLimite(identificador: string, clave: string, hashGuardado: string): ResultadoVerificacionClave {
  const restante = segundosBloqueadoRestantes(identificador);
  if (restante != null) {
    return { valida: false, bloqueado: true, segundosRestantes: restante };
  }

  const valida = verificarClave(clave, hashGuardado);
  if (valida) {
    intentosPorIdentificador.delete(identificador);
    return { valida: true, bloqueado: false };
  }

  const estado = intentosPorIdentificador.get(identificador) ?? { fallidos: 0, bloqueadoHasta: null };
  estado.fallidos++;
  if (estado.fallidos >= MAX_INTENTOS_FALLIDOS) {
    estado.bloqueadoHasta = Date.now() + DURACION_BLOQUEO_MS;
  }
  intentosPorIdentificador.set(identificador, estado);
  return { valida: false, bloqueado: false };
}
