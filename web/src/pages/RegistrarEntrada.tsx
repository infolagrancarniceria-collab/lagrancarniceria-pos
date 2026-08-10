import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Producto, type Proveedor } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

export default function RegistrarEntrada() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productoId, setProductoId] = useState<number | "">("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState<"compra" | "ajuste">("compra");
  const [proveedorId, setProveedorId] = useState<number | "">("");
  const [costoUnitario, setCostoUnitario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.productos.listar().then(setProductos).catch((e) => setError(e.message));
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
  }, []);

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
      await api.inventario.entrada({
        productoId: Number(productoId),
        cantidad: cant,
        motivo,
        proveedorId: proveedorId ? Number(proveedorId) : null,
        costoUnitario: costoUnitario ? Number(costoUnitario) : null,
        usuarioId: usuario.id,
      });
      setMensaje("Entrada registrada — el stock quedó actualizado");
      setCantidad("");
      setCostoUnitario("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Registrar entrada de mercadería</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Producto
          <select value={productoId} onChange={(e) => setProductoId(e.target.value ? Number(e.target.value) : "")} required>
            <option value="">Elegir producto...</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.plu} — {p.descripcion}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cantidad
          <input type="number" min="0.01" step="0.01" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
        </label>
        <label>
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as "compra" | "ajuste")}>
            <option value="compra">Compra a proveedor</option>
            <option value="ajuste">Ajuste (ej. conteo físico encontró más stock)</option>
          </select>
        </label>
        {motivo === "compra" && (
          <>
            <label>
              Proveedor
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Sin especificar</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Costo unitario
              <input
                type="number"
                min="0"
                value={costoUnitario}
                onChange={(e) => setCostoUnitario(e.target.value)}
                placeholder="opcional"
              />
            </label>
          </>
        )}

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar entrada"}
          </button>
          <button type="button" onClick={() => navigate("/inventario")}>
            Volver a inventario
          </button>
        </div>
      </form>
    </div>
  );
}
