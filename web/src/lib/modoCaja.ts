// "Modo caja exclusiva": pensado para un PC del mesón que solo se usa para
// cobrar (ej. no queremos que alguien navegue por accidente a Productos o
// Reportes desde ahí). Es una preferencia guardada en ESTE navegador/PC
// (localStorage), no una cuenta ni un permiso real — solo esconde el resto
// del menú; alguien que escriba la dirección a mano igual puede entrar. Se
// activa/desactiva desde Configuración, en ese mismo equipo.
const CLAVE = "modoCajaExclusiva";

export function modoCajaActivo(): boolean {
  return localStorage.getItem(CLAVE) === "true";
}

export function setModoCajaActivo(activo: boolean) {
  localStorage.setItem(CLAVE, activo ? "true" : "false");
}
