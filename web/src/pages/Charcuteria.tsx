import { Link } from "react-router-dom";

function Opcion({ to, emoji, titulo, descripcion }: { to: string; emoji: string; titulo: string; descripcion: string }) {
  return (
    <Link to={to} className="tarjeta tarjeta-mini enlace-camara">
      <strong>
        {emoji} {titulo}
      </strong>
      <p className="ayuda">{descripcion}</p>
    </Link>
  );
}

export default function Charcuteria() {
  return (
    <div>
      <h1>🥓 Charcutería</h1>
      <p className="ayuda">
        Submarca de charcutería y ahumados artesanales — gestión propia de costos, márgenes, stock y trazabilidad,
        separada de la carnicería aunque comparte el mismo local y equipo.
      </p>

      <h2>Catálogo y recetas</h2>
      <div className="grilla-camara">
        <Opcion
          to="/charcuteria/catalogo"
          emoji="📋"
          titulo="Catálogo"
          descripcion="Materia prima, insumos, envases/etiquetas, producto elaborado y SKU terminados."
        />
        <Opcion to="/charcuteria/recetas" emoji="📖" titulo="Recetas" descripcion="Fichas técnicas versionadas por producto elaborado." />
      </div>

      <h2>Producción</h2>
      <div className="grilla-camara">
        <Opcion
          to="/charcuteria/transferencias"
          emoji="🔄"
          titulo="Transferencias"
          descripcion="Materia prima que pasa de la carnicería a la charcutería."
        />
        <Opcion to="/charcuteria/lotes" emoji="🏭" titulo="Lotes de producción" descripcion="Crear, consumir insumos, cerrar y envasar lotes." />
      </div>

      <h2>Reportes</h2>
      <div className="grilla-camara">
        <Opcion
          to="/charcuteria/reportes/costo-margen"
          emoji="📊"
          titulo="Costo y margen"
          descripcion="Costo real y margen por SKU y por lote."
        />
        <Opcion
          to="/charcuteria/reportes/trazabilidad"
          emoji="🔍"
          titulo="Trazabilidad"
          descripcion="De un lote hacia su materia prima, o de una materia prima hacia los lotes/ventas que la usaron."
        />
        <Opcion
          to="/charcuteria/reportes/consolidado"
          emoji="🧮"
          titulo="Consolidado carnicería/charcutería"
          descripcion="Ventas por unidad de negocio en un rango de fechas."
        />
      </div>

      <h2>Configuración</h2>
      <div className="grilla-camara">
        <Opcion to="/charcuteria/mi-clave" emoji="🔑" titulo="Mi clave personal" descripcion="Configura tu PIN para acciones que lo pidan." />
        <Opcion
          to="/charcuteria/roles"
          emoji="🧑‍🍳"
          titulo="Roles"
          descripcion="Asignar admin/producción/caja a cada usuario (requiere clave de supervisor)."
        />
        <Opcion
          to="/charcuteria/configuracion"
          emoji="⚙️"
          titulo="Configuración"
          descripcion="Umbral de alerta de vencimiento (requiere clave de supervisor)."
        />
      </div>
    </div>
  );
}
