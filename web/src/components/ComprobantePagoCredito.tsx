import { formatoCLP, type PagoVenta } from "../api";

const etiquetaOrigen: Record<string, string> = { credito: "Crédito", transferencia: "Transferencia", pedido_web: "Pedido online" };
const etiquetaMedioCobro: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta" };

interface Props {
  pago: PagoVenta;
  onImprimir?: () => void;
  onCerrar: () => void;
}

// Respaldo imprimible de que un crédito o transferencia pendiente quedó
// cobrado — mismo mecanismo y misma estructura que el vale de venta (ver
// ValeVenta): el bloque ".vale" ya se ve bien solo, como una tarjeta, así
// que no necesita un modal aparte encima (un modal "position: fixed" no es
// confiable al imprimir).
export default function ComprobantePagoCredito({ pago, onImprimir, onCerrar }: Props) {
  return (
    <div className="vale">
      <div className="no-imprimir fila-inline">
        {onImprimir && (
          <button type="button" className="boton boton-primario" onClick={onImprimir}>
            Imprimir comprobante
          </button>
        )}
        <button type="button" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
      <h2>La Gran Carnicería</h2>
      <h3>Comprobante de pago — {etiquetaOrigen[pago.medio] ?? pago.medio}</h3>
      <p>
        <strong>PAGADO</strong>
      </p>
      <p>Cliente: {pago.clienteNombre ?? "—"}</p>
      <p>Monto cobrado: {formatoCLP(pago.monto)}</p>
      <p>Pagado con: {etiquetaMedioCobro[pago.medioCobro ?? ""] ?? pago.medioCobro ?? "—"}</p>
      <p>Fecha de cobro: {pago.fechaCobro ? new Date(pago.fechaCobro).toLocaleString("es-CL") : "—"}</p>
      {pago.usuarioCobro && <p>Registrado por: {pago.usuarioCobro.nombre}</p>}
      <p>
        Venta original: #{pago.ventaId}
        {pago.venta ? ` — ${new Date(pago.venta.fecha).toLocaleDateString("es-CL")}` : ""}
      </p>
    </div>
  );
}
