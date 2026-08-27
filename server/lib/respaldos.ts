import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";

// Cuántos respaldos diarios se conservan por destino antes de empezar a
// borrar los más viejos — evita que la carpeta de respaldos crezca sin
// límite con el tiempo.
const RESPALDOS_A_CONSERVAR = 30;
const PREFIJO_ARCHIVO = "respaldo-";

// Solo se usa cuando DATABASE_URL es relativo (caso de desarrollo,
// "file:./dev.db") — Prisma resuelve esas rutas relativas al propio
// schema.prisma, en la carpeta prisma/. En la app empaquetada,
// electron/main.js siempre deja DATABASE_URL como una ruta absoluta, así
// que este valor nunca llega a usarse ahí.
const CARPETA_PRISMA_FALLBACK = path.join(__dirname, "../../prisma");

// DATABASE_URL tiene el archivo real de la base de datos, pero Prisma no
// expone esa ruta directo — hay que sacarla del mismo string que usa para
// conectarse, para poder copiar el archivo.
function resolverRutaBaseDeDatos(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    throw new Error("DATABASE_URL no tiene el formato esperado (file:...)");
  }
  let ruta = url.slice("file:".length);
  if (!path.isAbsolute(ruta)) {
    ruta = path.join(CARPETA_PRISMA_FALLBACK, ruta);
  }
  return ruta;
}

// Fecha en formato AAAA-MM-DD, en hora LOCAL (no UTC) — usar
// toISOString().slice(0,10) se corre de día cerca de la medianoche en
// Chile (mismo tipo de bug ya encontrado y corregido antes para la fecha
// de una factura, ver parsearFechaSoloDia en reportes.ts). Exportada
// porque también la usa server/lib/avisos.ts para el mismo tipo de
// comparación ("¿esto es de hoy?").
export function fechaLocalYMD(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

interface ResultadoDestino {
  ok: boolean;
  error?: string;
}

function copiarA(rutaBaseDeDatos: string, carpetaDestino: string): ResultadoDestino {
  try {
    fs.mkdirSync(carpetaDestino, { recursive: true });
    const archivo = path.join(carpetaDestino, `${PREFIJO_ARCHIVO}${fechaLocalYMD(new Date())}.db`);
    fs.copyFileSync(rutaBaseDeDatos, archivo);
    limpiarRespaldosViejos(carpetaDestino);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function limpiarRespaldosViejos(carpeta: string): void {
  const patron = new RegExp(`^${PREFIJO_ARCHIVO}\\d{4}-\\d{2}-\\d{2}\\.db$`);
  const archivos = fs
    .readdirSync(carpeta)
    .filter((nombre) => patron.test(nombre))
    .sort(); // el formato AAAA-MM-DD ordena alfabético = ordena cronológico
  const sobrantes = archivos.length - RESPALDOS_A_CONSERVAR;
  for (let i = 0; i < sobrantes; i++) {
    fs.unlinkSync(path.join(carpeta, archivos[i]));
  }
}

// "Falta el de hoy" se compara por fecha calendario (no "hace 24 horas"),
// para que un PC que se prende y apaga a horas distintas cada día igual
// respalde una vez por día en vez de depender de dejarlo prendido
// exactamente 24 horas seguidas.
function faltaRespaldoDeHoy(ultimoEn: Date | null | undefined, ultimoOk: boolean | null | undefined): boolean {
  if (!ultimoOk || !ultimoEn) return true;
  return fechaLocalYMD(new Date()) !== fechaLocalYMD(ultimoEn);
}

export interface ResultadoRespaldo {
  local: ResultadoDestino;
  // null si no hay ninguna carpeta de USB configurada.
  usb: (ResultadoDestino & { omitido?: boolean }) | null;
}

// Respalda la base de datos: siempre a la carpeta local (al lado del
// archivo real de la base de datos), y además a la carpeta de USB si hay
// una configurada y está conectada ahora mismo — si no está conectada, no
// se trata como error real (no se actualiza la fecha del último intento),
// para que se vuelva a intentar solo la próxima vez que sí esté conectada.
// Con forzar=true (botón "Respaldar ahora") copia igual aunque ya se haya
// hecho el de hoy; sin forzar (chequeo automático) solo actúa si falta.
export async function ejecutarRespaldo(opciones: { forzar: boolean }): Promise<ResultadoRespaldo> {
  const config = await prisma.configuracionRespaldo.findFirst();
  const rutaBaseDeDatos = resolverRutaBaseDeDatos();
  const carpetaLocal = path.join(path.dirname(rutaBaseDeDatos), "respaldos");

  const datosAGuardar: Record<string, unknown> = {};

  let resultadoLocal: ResultadoDestino = {
    ok: config?.ultimoLocalOk ?? false,
    error: config?.ultimoLocalError ?? undefined,
  };
  if (opciones.forzar || faltaRespaldoDeHoy(config?.ultimoLocalEn, config?.ultimoLocalOk)) {
    resultadoLocal = copiarA(rutaBaseDeDatos, carpetaLocal);
    datosAGuardar.ultimoLocalEn = new Date();
    datosAGuardar.ultimoLocalOk = resultadoLocal.ok;
    datosAGuardar.ultimoLocalError = resultadoLocal.error ?? null;
  }

  let resultadoUsb: (ResultadoDestino & { omitido?: boolean }) | null = null;
  if (config?.rutaUsb) {
    if (opciones.forzar || faltaRespaldoDeHoy(config.ultimoUsbEn, config.ultimoUsbOk)) {
      if (fs.existsSync(config.rutaUsb)) {
        resultadoUsb = copiarA(rutaBaseDeDatos, config.rutaUsb);
        datosAGuardar.ultimoUsbEn = new Date();
        datosAGuardar.ultimoUsbOk = resultadoUsb.ok;
        datosAGuardar.ultimoUsbError = resultadoUsb.error ?? null;
      } else {
        resultadoUsb = { ok: false, omitido: true, error: "No se encontró esa carpeta — revisa que el USB/disco esté conectado" };
      }
    } else {
      resultadoUsb = { ok: config.ultimoUsbOk ?? false, error: config.ultimoUsbError ?? undefined };
    }
  }

  if (Object.keys(datosAGuardar).length > 0) {
    if (config) {
      await prisma.configuracionRespaldo.update({ where: { id: config.id }, data: datosAGuardar });
    } else {
      await prisma.configuracionRespaldo.create({ data: datosAGuardar });
    }
  }

  return { local: resultadoLocal, usb: resultadoUsb };
}

// Se llama al iniciar el servidor y después cada una hora — cada llamada
// revisa por su cuenta si ya tocaba el respaldo de hoy en cada destino, así
// que no hace falta coordinar un horario exacto.
export async function ejecutarRespaldoAutomaticoSiCorresponde(): Promise<void> {
  try {
    await ejecutarRespaldo({ forzar: false });
  } catch (e) {
    console.error("Error en el respaldo automático de la base de datos:", e);
  }
}
