import { Link } from "react-router-dom";

export default function Camara() {
  return (
    <div>
      <h1>Cámara frigorífica</h1>
      <p className="ayuda">
        Módulo en construcción, por etapas — por ahora están listas la entrada y la salida de cajas (con venta por
        mayor incluida). El resto (inventario por escaneo, importador del sistema anterior, modo sin conexión) se
        va a ir agregando acá mismo.
      </p>
      <div className="fila-inline">
        <Link to="/camara/entrada" className="boton boton-primario">
          Entrada de cajas
        </Link>
        <Link to="/camara/salida" className="boton boton-primario">
          Salida de cajas
        </Link>
        <Link to="/camara/mayoristas" className="boton">
          Ventas por mayor
        </Link>
      </div>
    </div>
  );
}
