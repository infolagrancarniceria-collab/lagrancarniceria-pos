import { Link } from "react-router-dom";
import { EstadoOffline } from "../components/EstadoOffline";

// Enlace con una descripción corta debajo — a pedido del usuario (su papá
// no encontró "Reporte de salidas" entre 9 botones iguales sin ninguna
// pista de qué hacía cada uno): ahora cada opción explica en una línea qué
// muestra, agrupadas por lo que se hace en cada una (registrar un
// movimiento vs. consultar algo ya registrado).
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

export default function Camara() {
  return (
    <div>
      <h1>Cámara frigorífica</h1>
      <EstadoOffline />

      <h2>Registrar un movimiento</h2>
      <div className="grilla-camara">
        <Opcion to="/camara/entrada" emoji="📥" titulo="Entrada de cajas" descripcion="Ingresar una factura o lote nuevo a cámara." />
        <Opcion to="/camara/salida" emoji="📤" titulo="Salida de cajas" descripcion="Escanear una caja y sacarla a sala de venta, merma, venta por mayor, etc." />
        <Opcion to="/camara/inventario" emoji="🔍" titulo="Inventario por escaneo" descripcion="Contar físicamente lo que hay y comparar contra lo esperado." />
      </div>

      <h2>Buscar y revisar</h2>
      <div className="grilla-camara">
        <Opcion
          to="/camara/reporte-salidas"
          emoji="📊"
          titulo="Reporte de salidas"
          descripcion="Buscar por rango de fechas qué salió de cámara, a qué destino y por cuánto."
        />
        <Opcion to="/camara/entradas" emoji="📋" titulo="Revisar entradas" descripcion="Ver o corregir las cajas que entraron en un rango de fechas." />
        <Opcion to="/camara/existencias" emoji="📦" titulo="Existencias" descripcion="Cuánto hay guardado ahora mismo, por producto." />
        <Opcion to="/camara/mayoristas" emoji="🤝" titulo="Ventas por mayor" descripcion="Ver, cobrar, editar o anular ventas al por mayor." />
        <Opcion to="/camara/ajustes-pendientes" emoji="⚠️" titulo="Ajustes pendientes" descripcion="Cajas que quedaron pendientes de revisar tras un conteo." />
        <Opcion to="/camara/importar" emoji="⬆️" titulo="Importar del sistema anterior" descripcion="Traer cajas ya cargadas en el archivo anterior." />
      </div>
    </div>
  );
}
