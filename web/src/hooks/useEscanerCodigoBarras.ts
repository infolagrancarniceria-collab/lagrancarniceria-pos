import { useEffect, useRef } from "react";

const INTERVALO_MAXIMO_MS = 30;
const LARGO_MINIMO = 4;

// Detecta un lector de código de barras tipo "teclado" (escribe cada
// carácter muchísimo más rápido que una persona, y termina con Enter) sin
// importar qué campo tenga el foco en ese momento — así el cajero no tiene
// que hacer clic en ningún campo especial antes de escanear. Si las teclas
// llegan con pausas normales de tipeo humano, se ignoran y el Enter se deja
// pasar como cualquier otro (para no interferir con el resto de la pantalla).
export function useEscanerCodigoBarras(onEscanear: (codigo: string) => void, activo: boolean = true) {
  const bufferRef = useRef("");
  const ultimoTiempoRef = useRef(0);

  useEffect(() => {
    if (!activo) return;

    function manejarTecla(e: KeyboardEvent) {
      if (e.key === "Enter") {
        if (bufferRef.current.length >= LARGO_MINIMO) {
          e.preventDefault();
          e.stopPropagation();
          onEscanear(bufferRef.current);
          bufferRef.current = "";
        }
        return;
      }

      if (e.key.length !== 1) return; // ignora Shift, Tab, flechas, etc.

      const ahora = performance.now();
      if (ahora - ultimoTiempoRef.current > INTERVALO_MAXIMO_MS) {
        bufferRef.current = ""; // pausa larga: tipeo humano normal, no un lector
      }
      bufferRef.current += e.key;
      ultimoTiempoRef.current = ahora;
    }

    window.addEventListener("keydown", manejarTecla, true);
    return () => window.removeEventListener("keydown", manejarTecla, true);
  }, [onEscanear, activo]);
}
