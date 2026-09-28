import { useEffect, useState } from "react";
import { api, formatoCLP, type ItemCharcuteria, type Producto, type TransferenciaInterna } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

export default function CharcuteriaTransferencias() {
  const { usuario } = useUsuario();
  const [transferencias, setTransferencias] = useState<TransferenciaInterna[]>([]);
  const [productosCarniceria, setProductosCarniceria] = useState<Producto[]>([]);
  const [itemsDestino, setItemsDestino] = useState<ItemCharcuteria[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [buscarOrigen, setBuscarOrigen] = useState("");
  const [productoOrigenId, setProductoOrigenId] = useState<number | null>(null);
  const [itemDestinoId, setItemDestinoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [precioPorKg, setPrecioPorKg] = useState("");
  const [precioSugerido, setPrecioSugerido] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    api.charcuteria.transferencias.listar().then(setTransferencias).catch((e) => setError(e.message));
    api.charcuteria.items.listar().then((items) => setItemsDestino(items.filter((i) => ["materia_prima", "insumo"].includes(i.tipoItem))));
  }

  useEffect(cargar, []);

  useEffect(() => {
    if (!buscarOrigen.trim()) {
      setProductosCarniceria([]);
      return;
    }
    const t = setTimeout(() => {
      api.productos.listar({ buscar: buscarOrigen }).then(setProductosCarniceria).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [buscarOrigen]);

  useEffect(() => {
    if (!productoOrigenId || !itemDestinoId) {
      setPrecioSugerido(null);
      return;
    }
    api.charcuteria.transferencias
      .precioSugerido(productoOrigenId, Number(itemDestinoId))
      .then((r) => setPrecioSugerido(r.sugerido))
      .catch(() => setPrecioSugerido(null));
  }, [productoOrigenId, itemDestinoId]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario || !productoOrigenId || !itemDestinoId || !cantidad) {
      setError("Completa producto de origen, ítem de destino y cantidad");
      return;
    }
    setGuardando(true);
    try {
      await api.charcuteria.transferencias.crear({
        usuarioId: usuario.id,
        productoOrigenId,
        itemDestinoId: Number(itemDestinoId),
        cantidad: Number(cantidad),
        precioPorKg: precioPorKg ? Number(precioPorKg) : undefined,
      });
      mostrarToast("Transferencia registrada", `${cantidad} kg transferidos a charcutería.`);
      setProductoOrigenId(null);
      setBuscarOrigen("");
      setItemDestinoId("");
      setCantidad("");
      setPrecioPorKg("");
      setPrecioSugerido(null);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const productoOrigen = productosCarniceria.find((p) => p.id === productoOrigenId);

  return (
    <div>
      <h1>Transferencias carnicería → charcutería</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={crear} onKeyDown={manejarEnterComoTab} className="formulario tarjeta">
        <label>
          Producto de carnicería (origen)
          <div className="buscador-producto">
            <input
              type="text"
              placeholder="Buscar por PLU o nombre..."
              value={productoOrigen ? productoOrigen.descripcion : buscarOrigen}
              onChange={(e) => {
                setBuscarOrigen(e.target.value);
                setProductoOrigenId(null);
              }}
            />
            {!productoOrigenId && buscarOrigen.trim() && (
              <div className="resultados-busqueda">
                {productosCarniceria.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                {productosCarniceria.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="resultado-item"
                    onClick={() => {
                      setProductoOrigenId(p.id);
                      setBuscarOrigen("");
                    }}
                  >
                    {p.plu} — {p.descripcion} (stock: {p.stockActual} kg)
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        <div className="fila-inline">
          <label>
            Ítem de destino (charcutería)
            <select value={itemDestinoId} onChange={(e) => setItemDestinoId(e.target.value)} required>
              <option value="">— elegir —</option>
              {itemsDestino.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cantidad (kg)
            <input type="number" min="0.01" step="0.01" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          </label>
          <label>
            Precio de transferencia ($/kg)
            <input
              type="number"
              min="1"
              placeholder={precioSugerido != null ? `Sugerido: ${formatoCLP(precioSugerido)}` : "Sin referencia — ingresar a mano"}
              value={precioPorKg}
              onChange={(e) => setPrecioPorKg(e.target.value)}
            />
          </label>
        </div>
        {precioSugerido == null && itemDestinoId && productoOrigenId && (
          <p className="error">No hay ningún precio de referencia para este ítem — debes ingresarlo a mano.</p>
        )}

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar transferencia"}
          </button>
        </div>
      </form>

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Origen</th>
            <th>Destino</th>
            <th>Cantidad</th>
            <th>Precio $/kg</th>
            <th>Total</th>
            <th>Responsable</th>
          </tr>
        </thead>
        <tbody>
          {transferencias.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.fecha).toLocaleString("es-CL")}</td>
              <td>{t.productoOrigen.descripcion}</td>
              <td>{t.itemDestino.nombre}</td>
              <td>{t.cantidad} kg</td>
              <td>{formatoCLP(t.precioPorKg)}</td>
              <td>{formatoCLP(Math.round(t.precioPorKg * t.cantidad))}</td>
              <td>{t.responsable.nombre}</td>
            </tr>
          ))}
          {transferencias.length === 0 && (
            <tr>
              <td colSpan={7}>Sin transferencias registradas todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
