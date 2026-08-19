// Cola local para acciones de cámara que cambian stock (salida de una
// caja, resolver un ajuste pendiente) hechas desde el celular cuando se
// aleja del wifi del local — casos ocasionales y breves, según lo
// confirmado con el usuario. Cada acción se intenta mandar al servidor de
// inmediato; si falla por falta de conexión (no por un rechazo real del
// servidor), queda guardada acá con una clave de idempotencia única y se
// reintenta sola apenas vuelve la señal — sin duplicar ni perder nada,
// porque el servidor devuelve el mismo resultado ya guardado si recibe dos
// veces la misma clave (ver claveIdempotencia en server/routes/camara.ts).
//
// Es una cola de ESTE dispositivo (localStorage), no compartida entre
// equipos — igual que "modo caja exclusiva" o la impresora elegida.

const CLAVE_COLA = "colaOfflineCamara";
const CLAVE_ERRORES = "colaOfflineCamaraErrores";

export interface AccionPendiente {
  id: string; // = claveIdempotencia
  url: string;
  body: Record<string, unknown>;
  creadaEn: string;
  descripcion: string; // para mostrarle a la persona qué queda pendiente de enviar
}

export interface AccionConError extends AccionPendiente {
  error: string;
}

function leer<T>(clave: string): T[] {
  try {
    const guardado = localStorage.getItem(clave);
    return guardado ? JSON.parse(guardado) : [];
  } catch {
    return [];
  }
}

function guardar<T>(clave: string, valor: T[]) {
  localStorage.setItem(clave, JSON.stringify(valor));
}

export function obtenerPendientes(): AccionPendiente[] {
  return leer<AccionPendiente>(CLAVE_COLA);
}

export function obtenerErrores(): AccionConError[] {
  return leer<AccionConError>(CLAVE_ERRORES);
}

export function descartarError(id: string) {
  guardar(
    CLAVE_ERRORES,
    leer<AccionConError>(CLAVE_ERRORES).filter((a) => a.id !== id)
  );
}

type ResultadoEnvio<T> = { estado: "ok"; datos: T } | { estado: "rechazado"; error: string } | { estado: "sin_conexion" };

async function enviar<T>(accion: AccionPendiente): Promise<ResultadoEnvio<T>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(accion.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accion.body),
    });
  } catch {
    return { estado: "sin_conexion" };
  }
  if (!respuesta.ok) {
    let mensaje = "El servidor rechazó la acción";
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      // sin cuerpo JSON — se deja el mensaje genérico
    }
    return { estado: "rechazado", error: mensaje };
  }
  const datos = (await respuesta.json()) as T;
  return { estado: "ok", datos };
}

let sincronizando = false;

// Reintenta todo lo pendiente. Se detiene apenas encuentra una que sigue
// sin conexión (las demás probablemente tampoco van a poder mandarse
// todavía). Las que el servidor rechaza de verdad (ej. la caja ya fue
// resuelta por otra persona mientras tanto) se sacan de la cola y quedan
// en "errores" para que la persona las revise a mano — no tiene sentido
// reintentarlas para siempre.
export async function sincronizarPendientes(): Promise<void> {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const pendientes = leer<AccionPendiente>(CLAVE_COLA);
    for (const accion of pendientes) {
      const resultado = await enviar(accion);
      if (resultado.estado === "sin_conexion") break;
      guardar(
        CLAVE_COLA,
        leer<AccionPendiente>(CLAVE_COLA).filter((a) => a.id !== accion.id)
      );
      if (resultado.estado === "rechazado") {
        guardar(CLAVE_ERRORES, [...leer<AccionConError>(CLAVE_ERRORES), { ...accion, error: resultado.error }]);
      }
    }
  } finally {
    sincronizando = false;
  }
}

// Intenta la acción de inmediato. Si el servidor la rechaza de verdad
// (ej. validación, conflicto de versión), lanza el error tal cual para que
// la pantalla lo muestre igual que siempre. Si falla por falta de
// conexión, la deja guardada para reintentar sola y devuelve
// {enviada:false} en vez de lanzar un error — desde la perspectiva de la
// persona, la acción quedó "hecha" (guardada en el celular).
export async function ejecutarOEncolar<T>(
  url: string,
  body: Record<string, unknown>,
  claveIdempotencia: string,
  descripcion: string
): Promise<{ enviada: true; datos: T } | { enviada: false }> {
  const accion: AccionPendiente = { id: claveIdempotencia, url, body, creadaEn: new Date().toISOString(), descripcion };
  const resultado = await enviar<T>(accion);
  if (resultado.estado === "ok") return { enviada: true, datos: resultado.datos };
  if (resultado.estado === "rechazado") throw new Error(resultado.error);
  guardar(CLAVE_COLA, [...leer<AccionPendiente>(CLAVE_COLA), accion]);
  return { enviada: false };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    sincronizarPendientes();
  });
}
