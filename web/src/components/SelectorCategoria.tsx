import type { Categoria } from "../api";

interface Props {
  categorias: Categoria[];
  value: number | "";
  onChange: (categoriaId: number | "") => void;
  // Si se pasa, el primer selector incluye una opción "todas" (para filtros
  // de listado) — si no se pasa, el primer selector exige elegir una
  // categoría concreta (para asignarle una a un producto).
  etiquetaTodas?: string;
  required?: boolean;
}

// Selector de categoría en 3 listas cortas (nivel 1 → nivel 2 → nivel 3) en
// vez de una sola lista larga con guiones indicando el nivel — con catálogos
// grandes esa lista se vuelve difícil de leer. Cada lista muestra solo las
// categorías hijas de lo elegido en la anterior, y se puede "parar" en
// cualquier nivel (ej. asignar directo a "Vacuno" sin elegir una subcategoría).
export default function SelectorCategoria({ categorias, value, onChange, etiquetaTodas, required }: Props) {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const seleccionada = value ? porId.get(value) ?? null : null;

  let nivel1Id: number | "" = "";
  let nivel2Id: number | "" = "";

  if (seleccionada) {
    if (seleccionada.nivel === 1) {
      nivel1Id = seleccionada.id;
    } else if (seleccionada.nivel === 2) {
      nivel2Id = seleccionada.id;
      nivel1Id = seleccionada.padreId ?? "";
    } else {
      nivel2Id = seleccionada.padreId ?? "";
      const padre2 = seleccionada.padreId ? porId.get(seleccionada.padreId) : undefined;
      nivel1Id = padre2?.padreId ?? "";
    }
  }

  const opcionesNivel1 = categorias.filter((c) => c.nivel === 1);
  const opcionesNivel2 = nivel1Id ? categorias.filter((c) => c.nivel === 2 && c.padreId === nivel1Id) : [];
  const opcionesNivel3 = nivel2Id ? categorias.filter((c) => c.nivel === 3 && c.padreId === nivel2Id) : [];

  return (
    <div className="selector-categoria-cascada">
      <select
        value={nivel1Id}
        required={required && !etiquetaTodas}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
      >
        <option value="">{etiquetaTodas ?? "Elegir categoría..."}</option>
        {opcionesNivel1.map((c) => (
          <option key={c.id} value={c.id}>
            {c.codigo} {c.nombre}
          </option>
        ))}
      </select>
      {opcionesNivel2.length > 0 && (
        <select value={nivel2Id} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : nivel1Id)}>
          <option value="">(toda la categoría "{porId.get(nivel1Id as number)?.nombre}")</option>
          {opcionesNivel2.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo} {c.nombre}
            </option>
          ))}
        </select>
      )}
      {opcionesNivel3.length > 0 && (
        <select
          value={seleccionada?.nivel === 3 ? seleccionada.id : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : nivel2Id)}
        >
          <option value="">(toda la categoría "{porId.get(nivel2Id as number)?.nombre}")</option>
          {opcionesNivel3.map((c) => (
            <option key={c.id} value={c.id}>
              {c.codigo} {c.nombre}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
