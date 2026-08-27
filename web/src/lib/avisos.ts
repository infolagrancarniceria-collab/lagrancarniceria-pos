import type { AvisosCriticos } from "../api";

export function contarAvisos(a: AvisosCriticos): number {
  return (
    (a.cajaSinCerrar ? 1 : 0) +
    (a.stockBajo.cantidad > 0 ? 1 : 0) +
    (a.cajasEstancadas.cantidad > 0 ? 1 : 0) +
    (a.ajustesPendientesCamara.cantidad > 0 ? 1 : 0)
  );
}

export interface DescripcionAviso {
  clave: string;
  texto: string;
}

export function listarAvisos(a: AvisosCriticos): DescripcionAviso[] {
  const lista: DescripcionAviso[] = [];
  if (a.cajaSinCerrar) {
    lista.push({
      clave: "cajaSinCerrar",
      texto: `Hay una caja sin cerrar desde el ${new Date(a.cajaSinCerrar.fechaApertura).toLocaleDateString(
        "es-CL"
      )} (la abrió ${a.cajaSinCerrar.usuario}).`,
    });
  }
  if (a.stockBajo.cantidad > 0) {
    lista.push({
      clave: "stockBajo",
      texto: `${a.stockBajo.cantidad} producto${a.stockBajo.cantidad === 1 ? "" : "s"} con stock bajo.`,
    });
  }
  if (a.cajasEstancadas.cantidad > 0) {
    lista.push({
      clave: "cajasEstancadas",
      texto: `${a.cajasEstancadas.cantidad} caja${
        a.cajasEstancadas.cantidad === 1 ? "" : "s"
      } de cámara sin movimiento hace más de una semana.`,
    });
  }
  if (a.ajustesPendientesCamara.cantidad > 0) {
    lista.push({
      clave: "ajustesPendientesCamara",
      texto: `${a.ajustesPendientesCamara.cantidad} ajuste${
        a.ajustesPendientesCamara.cantidad === 1 ? "" : "s"
      } de cámara pendiente${a.ajustesPendientesCamara.cantidad === 1 ? "" : "s"} de revisar.`,
    });
  }
  return lista;
}

const CLAVE_LOCALSTORAGE = "avisosNotificadosPorDia";

function hoyYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Notificación nativa del sistema operativo — a pedido del usuario, para
// enterarse aunque el programa esté minimizado. Como máximo una vez por
// tipo de aviso por día (guardado en localStorage, así que es "por
// navegador/PC" — cada equipo que lo tenga abierto avisa una vez), para no
// repetir la misma notificación cada vez que se vuelve a chequear (cada 5
// minutos, ver Layout.tsx). Si el aviso se resuelve y vuelve a aparecer
// otro día, se vuelve a notificar.
export function notificarNuevosAvisosSiCorresponde(avisos: AvisosCriticos): void {
  if (typeof Notification === "undefined") return;

  const lista = listarAvisos(avisos);
  if (lista.length === 0) return;

  let notificadosHoy: Record<string, string> = {};
  const guardado = localStorage.getItem(CLAVE_LOCALSTORAGE);
  if (guardado) {
    try {
      notificadosHoy = JSON.parse(guardado);
    } catch {
      notificadosHoy = {};
    }
  }

  const hoy = hoyYMD();
  const pendientes = lista.filter((aviso) => notificadosHoy[aviso.clave] !== hoy);
  if (pendientes.length === 0) return;

  function disparar() {
    for (const aviso of pendientes) {
      new Notification("La Gran Carnicería — Aviso", { body: aviso.texto });
      notificadosHoy[aviso.clave] = hoy;
    }
    localStorage.setItem(CLAVE_LOCALSTORAGE, JSON.stringify(notificadosHoy));
  }

  if (Notification.permission === "granted") {
    disparar();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permiso) => {
      if (permiso === "granted") disparar();
    });
  }
}
