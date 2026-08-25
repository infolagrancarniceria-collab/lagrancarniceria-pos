interface Props {
  mensaje: string;
  onCerrar: () => void;
}

// Ventana emergente para errores — a pedido del usuario, que perdía de
// vista el mensaje de error (aparecía como texto arriba de la pantalla,
// fácil de no notar en un formulario largo) hasta bajar/subir a buscarlo.
// Mismo lenguaje visual que ya usa el aviso de Vuelto en Punto de venta
// (modal bloqueante, cifra/mensaje grande, un solo botón para cerrar), acá
// en rojo para que se lea como una alerta. Reemplaza el patrón anterior
// `{error && <p className="error">{error}</p>}` en todas las pantallas.
export default function ModalAlerta({ mensaje, onCerrar }: Props) {
  return (
    <div className="modal-fondo no-imprimir">
      <div className="modal-alerta">
        <div className="modal-alerta-etiqueta">⚠ Atención</div>
        <p className="modal-alerta-mensaje">{mensaje}</p>
        <button type="button" className="boton boton-primario" onClick={onCerrar} autoFocus>
          Entendido
        </button>
      </div>
    </div>
  );
}
