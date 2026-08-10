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
