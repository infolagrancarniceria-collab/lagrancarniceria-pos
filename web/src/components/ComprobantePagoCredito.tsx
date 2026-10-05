import { formatoCLP, type PagoVenta } from "../api";

const etiquetaOrigen: Record<string, string> = { credito: "Crédito", transferencia: "Transferencia", pedido_web: "Pedido online" };
const etiquetaMedioCobro: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", condonado: "Dado de baja (no se cobró)" };

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
      <h3>
        {pago.medioCobro === "condonado" ? "Deuda dada de baja" : "Comprobante de pago"} —{" "}
        {etiquetaOrigen[pago.medio] ?? pago.medio}
      </h3>
      <p>
        <strong>{pago.medioCobro === "condonado" ? "NO COBRADO — DADO DE BAJA" : "PAGADO"}</strong>
      </p>
      <p>Cliente: {pago.clienteNombre ?? "—"}</p>
      <p>Monto {pago.medioCobro === "condonado" ? "condonado" : "cobrado"}: {formatoCLP(pago.monto)}</p>
      <p>{pago.medioCobro === "condonado" ? "Resolución" : "Pagado con"}: {etiquetaMedioCobro[pago.medioCobro ?? ""] ?? pago.medioCobro ?? "—"}</p>
      {pago.medioCobro === "condonado" && pago.motivoCondonacion && <p>Motivo: {pago.motivoCondonacion}</p>}
      <p>Fecha: {pago.fechaCobro ? new Date(pago.fechaCobro).toLocaleString("es-CL") : "—"}</p>
      {pago.usuarioCobro && <p>Registrado por: {pago.usuarioCobro.nombre}</p>}
      <p>
        Venta original: #{pago.ventaId}
        {pago.venta ? ` — ${new Date(pago.venta.fecha).toLocaleDateString("es-CL")}` : ""}
      </p>
    </div>
  );
}
