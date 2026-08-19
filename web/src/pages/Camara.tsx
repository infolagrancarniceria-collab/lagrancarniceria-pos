import { Link } from "react-router-dom";

export default function Camara() {
  return (
    <div>
      <h1>Cámara frigorífica</h1>
      <p className="ayuda">
        Módulo en construcción, por etapas — por ahora solo está lista la entrada de cajas. El resto (salida,
        inventario por escaneo, mayorista, reportes) se va a ir agregando acá mismo.
      </p>
      <div className="fila-inline">
        <Link to="/camara/entrada" className="boton boton-primario">
          Entrada de cajas
        </Link>
      </div>
    </div>
  );
}
