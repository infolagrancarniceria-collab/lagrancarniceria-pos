import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Producto } from "../api";
import { useUsuario } from "../context/UsuarioContext";

const etiquetasMotivo: Record<string, string> = {
  venta: "Venta",
  descarte: "Descarte / merma",
  ajuste: "Ajuste (ej. conteo físico encontró menos stock)",
};

export default function RegistrarSalida() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoId, setProductoId] = useState<number | "">("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState<"venta" | "descarte" | "ajuste">("descarte");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.productos.listar().then(setProductos).catch((e) => setError(e.message));
  }, []);

  const productoSeleccionado = productos.find((p) => p.id === productoId);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!productoId || !usuario) {
      setError("Falta elegir un producto");
      return;
    }
    const cant = Number(cantidad);
    if (!cant || cant <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }
    setGuardando(true);
    try {
      await api.inventario.salida({
        productoId: Number(productoId),
        cantidad: cant,
        motivo,
        usuarioId: usuario.id,
      });
      setMensaje("Salida registrada — el stock quedó actualizado");
      setCantidad("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Registrar salida / merma</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <form onSubmit={guardar} className="formulario">
        <label>
          Producto
          <select value={productoId} onChange={(e) => setProductoId(e.target.value ? Number(e.target.value) : "")} required>
            <option value="">Elegir producto...</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.plu} — {p.descripcion} (stock: {p.stockActual})
              </option>
            ))}
          </select>
        </label>
        {productoSeleccionado && <p className="ayuda">Stock actual: {productoSeleccionado.stockActual}</p>}
        <label>
          Cantidad
          <input type="number" min="0.01" step="0.01" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
        </label>
        <label>
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as "venta" | "descarte" | "ajuste")}>
            {Object.entries(etiquetasMotivo).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar salida"}
          </button>
          <button type="button" onClick={() => navigate("/inventario")}>
            Volver a inventario
          </button>
        </div>
      </form>
    </div>
  );
}
