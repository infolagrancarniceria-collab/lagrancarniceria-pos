import { useLocation, useNavigate } from "react-router-dom";

// Flecha para volver a la pantalla anterior exactamente como estaba (mismo
// filtro, misma búsqueda) — a pedido del usuario, que tenía que rehacer el
// filtro de categoría en Productos cada vez que volvía de otra pantalla.
// Usa el historial real del navegador (navigate(-1)) en vez de un enlace
// fijo, así funciona sin importar desde dónde se llegó; las pantallas con
// filtros los guardan en la URL (ver hooks/useFiltrosUrl.ts) para que
// "volver" los recupere tal cual.
//
// "location.key" es "default" solo en la primerísima pantalla que carga el
// programa (ej. recién iniciada sesión) — ahí no hay ninguna pantalla
// anterior real a la que volver, así que el botón no se muestra.
export default function BotonVolver() {
  const location = useLocation();
  const navigate = useNavigate();

  if (location.key === "default") return null;

  return (
    <button
      type="button"
      className="boton-volver"
      onClick={() => navigate(-1)}
      title="Volver a la pantalla anterior"
    >
      ← Volver
    </button>
  );
}
