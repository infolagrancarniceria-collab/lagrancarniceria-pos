// Avisos flotantes (arriba a la derecha) para confirmar visualmente
// acciones importantes (crear, cargar, eliminar) — antes solo había un
// texto chico en la pantalla, fácil de no notar. Sin dependencias
// externas: un pub/sub simple a nivel de módulo, con un componente
// <ToastHost /> montado una sola vez en Layout.tsx que se suscribe y
// dibuja los avisos activos, sin importar en qué pantalla se dispare
// mostrarToast().
export type TipoToast = "exito" | "eliminado";

export interface ToastItem {
  id: number;
  texto: string;
  sub?: string;
  tipo: TipoToast;
}

let items: ToastItem[] = [];
let listeners: ((items: ToastItem[]) => void)[] = [];
let contador = 0;

function emitir() {
  listeners.forEach((l) => l(items));
}

export function mostrarToast(texto: string, sub?: string, tipo: TipoToast = "exito") {
  const id = ++contador;
  items = [...items, { id, texto, sub, tipo }];
  emitir();
  setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    emitir();
  }, 4200);
}

export function suscribirToasts(listener: (items: ToastItem[]) => void): () => void {
  listeners.push(listener);
  listener(items);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
