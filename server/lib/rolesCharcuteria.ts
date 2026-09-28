import { prisma } from "../db";
import { hashClave, verificarClaveConLimite } from "./clave";

// Roles del módulo de charcutería únicamente — el resto del sistema sigue
// sin roles (cualquier usuario activo + la ClaveSupervisor compartida para
// lo puntual). "admin" ve costos/márgenes y autoriza cambios de vencimiento;
// "produccion" crea lotes y envasa, sin ver márgenes; "caja" solo vende (ya
// puede hacerlo con el resto del sistema, esto no le agrega nada nuevo).
export const ROLES_CHARCUTERIA = ["admin", "produccion", "caja"] as const;
export type RolCharcuteria = (typeof ROLES_CHARCUTERIA)[number];

export async function validarUsuarioActivo(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario || !usuario.activo) return null;
  return usuario;
}

// true si el rol del usuario está entre los permitidos para la acción — no
// lanza ni responde nada, cada ruta decide el mensaje/status según el caso.
export function tienePermiso(rol: string, rolesPermitidos: readonly RolCharcuteria[]): boolean {
  return (rolesPermitidos as readonly string[]).includes(rol);
}

// Configura o cambia el PIN personal de un usuario — mismo hash que
// ClaveSupervisor (scrypt), pero guardado en el propio Usuario porque es
// personal, no compartido.
export async function establecerClavePersonal(usuarioId: number, clave: string) {
  await prisma.usuario.update({ where: { id: usuarioId }, data: { hashClavePersonal: hashClave(clave) } });
}

// Verifica el PIN personal de un usuario contra el que tiene guardado —
// mismo límite de intentos por IP que ClaveSupervisor. Devuelve un motivo
// de rechazo listo para responder al cliente, o null si la clave es válida.
export async function verificarClavePersonal(
  usuarioId: number,
  clave: string,
  ip: string
): Promise<{ status: number; error: string } | null> {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) return { status: 400, error: "Usuario inválido" };
  if (!usuario.hashClavePersonal) {
    return { status: 400, error: "Este usuario todavía no configuró su clave personal (Configuración → Mi clave)" };
  }
  const resultado = verificarClaveConLimite(`${ip}:${usuarioId}`, clave, usuario.hashClavePersonal);
  if (resultado.bloqueado) {
    return { status: 429, error: `Demasiados intentos fallidos — espera ${resultado.segundosRestantes} segundos e intenta de nuevo` };
  }
  if (!resultado.valida) return { status: 403, error: "Clave incorrecta" };
  return null;
}
