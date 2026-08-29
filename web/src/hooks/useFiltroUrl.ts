import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// Guarda un filtro (texto, categoría, rango de fechas, etc.) en la URL
// (?clave=valor) en vez de solo en el estado del componente — así, al
// volver con la flecha "← Volver" (BotonVolver.tsx), la pantalla recupera
// exactamente el mismo filtro que tenía antes, sin tener que volver a
// elegirlo (a pedido del usuario: tenía que rehacer el filtro de categoría
// en Productos cada vez que volvía de otra pantalla).
//
// Usa "replace" (no "push") al escribir: cambiar un filtro reemplaza la
// URL actual en el historial en vez de agregar una entrada nueva — si no,
// escribir letra por letra en un buscador llenaría el historial con
// entradas intermedias, y la flecha "Volver" tendría que pasar por todas
// esas en vez de ir directo a la pantalla anterior real.
//
// Trabaja siempre con texto (igual que la URL) — cada pantalla convierte a
// número/booleano si lo necesita, para no complicar el hook con tipos.
export function useFiltroUrl(clave: string, valorPorDefecto = ""): [string, (valor: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const valor = searchParams.get(clave) ?? valorPorDefecto;

  const establecer = useCallback(
    (nuevoValor: string) => {
      setSearchParams(
        (previos) => {
          const siguiente = new URLSearchParams(previos);
          if (nuevoValor === "" || nuevoValor === valorPorDefecto) {
            siguiente.delete(clave);
          } else {
            siguiente.set(clave, nuevoValor);
          }
          return siguiente;
        },
        { replace: true }
      );
    },
    [clave, valorPorDefecto, setSearchParams]
  );

  return [valor, establecer];
}
