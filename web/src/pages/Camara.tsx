import { Link } from "react-router-dom";

export default function Camara() {
  return (
    <div>
      <h1>Cámara frigorífica</h1>
      <p className="ayuda">
        Módulo en construcción, por etapas — por ahora están listas la entrada, la salida (con venta por mayor
        incluida), el inventario por escaneo y el importador del sistema anterior. Falta el modo sin conexión del
        celular.
      </p>
      <div className="fila-inline">
        <Link to="/camara/entrada" className="boton boton-primario">
          Entrada de cajas
        </Link>
        <Link to="/camara/salida" className="boton boton-primario">
          Salida de cajas
        </Link>
        <Link to="/camara/inventario" className="boton boton-primario">
          Inventario por escaneo
        </Link>
        <Link to="/camara/mayoristas" className="boton">
          Ventas por mayor
        </Link>
        <Link to="/camara/ajustes-pendientes" className="boton">
          Ajustes pendientes
        </Link>
        <Link to="/camara/importar" className="boton">
          Importar del sistema anterior
        </Link>
      </div>
    </div>
  );
}
