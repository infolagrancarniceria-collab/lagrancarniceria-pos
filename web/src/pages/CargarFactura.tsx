import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, calcularMargen, formatoCLP, type Producto, type Proveedor } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

interface LineaForm {
  id: number;
  producto: Producto | null;
  buscarProducto: string;
  resultados: Producto[];
  cantidad: string;
  costoUnitario: string;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineaVacia(id: number): LineaForm {
  return { id, producto: null, buscarProducto: "", resultados: [], cantidad: "", costoUnitario: "" };
}

// Formulario manual para cargar una factura completa de una sola vez — a
// pedido del usuario, como alternativa al asistente de IA cuando este no
// identifica bien los productos de una factura pegada como texto. Mismo
// resultado final: una entrada de inventario (motivo "compra") por línea,
// todas con el mismo proveedor y N° de factura, en una sola transacción.
export default function CargarFactura() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscarProveedor, setBuscarProveedor] = useState("");
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(null);

  const [numeroFactura, setNumeroFactura] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia(1)]);
  const [siguienteId, setSiguienteId] = useState(2);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
  }, []);

  const proveedoresFiltrados = buscarProveedor.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(buscarProveedor.trim().toLowerCase()))
    : proveedores;

  function actualizarLinea(id: number, cambios: Partial<LineaForm>) {
    setLineas((actual) => actual.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
  }

  function buscarProductoLinea(id: number, texto: string) {
    actualizarLinea(id, { buscarProducto: texto, producto: null });
    if (!texto.trim()) {
      actualizarLinea(id, { resultados: [] });
      return;
    }
    api.productos
      .listar({ buscar: texto })
      .then((resultados) => actualizarLinea(id, { resultados }))
      .catch((e) => setError(e.message));
  }

  function agregarLinea() {
    setLineas((actual) => [...actual, lineaVacia(siguienteId)]);
    setSiguienteId((n) => n + 1);
  }

  function quitarLinea(id: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.id !== id) : actual));
  }

  const totalFactura = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costoUnitario) || 0), 0);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario || !proveedorSeleccionado) {
      setError("Falta elegir el proveedor");
      return;
    }
    if (!numeroFactura.trim()) {
      setError("Falta el N° de factura");
      return;
    }
    const lineasValidas = lineas.filter((l) => l.producto);
    if (lineasValidas.length === 0) {
      setError("Agrega al menos una línea con un producto elegido");
      return;
    }
    for (const l of lineasValidas) {
      if (!Number(l.cantidad) || Number(l.cantidad) <= 0) {
        setError(`Falta la cantidad de "${l.producto!.descripcion}"`);
        return;
      }
      if (!Number(l.costoUnitario) || Number(l.costoUnitario) <= 0) {
        setError(`Falta el costo unitario de "${l.producto!.descripcion}"`);
        return;
      }
    }

    setGuardando(true);
    try {
      await api.inventario.entradaFactura({
        proveedorId: proveedorSeleccionado.id,
        numeroFactura: numeroFactura.trim(),
        fecha,
        usuarioId: usuario.id,
        lineas: lineasValidas.map((l) => ({
          productoId: l.producto!.id,
          cantidad: Number(l.cantidad),
          costoUnitario: Number(l.costoUnitario),
        })),
      });
      mostrarToast(
        "Factura cargada",
        `${lineasValidas.length} línea(s) de ${proveedorSeleccionado.nombre} — ${formatoCLP(totalFactura)}.`
      );
      navigate("/inventario/facturas");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Cargar factura</h1>
      <p className="ayuda">
        Registra todas las líneas de una factura de compra de una vez, con el mismo proveedor y N° de factura —
        alternativa al asistente de IA para cuando no identifica bien los productos.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Proveedor
          <div className="buscador-producto">
            <input
              type="text"
              placeholder="Buscar proveedor... (vacío = ver todos)"
              value={buscarProveedor}
              onChange={(e) => {
                setBuscarProveedor(e.target.value);
                setProveedorSeleccionado(null);
              }}
            />
            {!proveedorSeleccionado && (
              <div className="resultados-busqueda">
                {proveedoresFiltrados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                {proveedoresFiltrados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="resultado-item"
                    onClick={() => {
                      setProveedorSeleccionado(p);
                      setBuscarProveedor("");
                    }}
                  >
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
          {proveedorSeleccionado && (
            <p className="exito">
              Proveedor elegido: {proveedorSeleccionado.nombre}{" "}
              <button type="button" onClick={() => setProveedorSeleccionado(null)}>
                Cambiar
              </button>
            </p>
          )}
        </label>
        <label>
          N° de factura
          <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} required />
        </label>
        <label>
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </label>

        <div className="acciones-formulario">
          <h2>Líneas de la factura</h2>
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Costo unitario</th>
                <th>Subtotal</th>
                <th>Margen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                // El margen se calcula con el costo que se está escribiendo
                // AHORA en esta línea (no hace falta ninguna compra previa
                // registrada) — es lo que realmente importa al decidir si el
                // precio de venta sigue teniendo sentido con este costo nuevo.
                const margen = l.producto ? calcularMargen(l.producto.precio, Number(l.costoUnitario) || null) : null;
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="buscador-producto">
                        <input
                          type="text"
                          placeholder="Buscar por PLU o nombre..."
                          value={l.producto ? l.producto.descripcion : l.buscarProducto}
                          onChange={(e) => buscarProductoLinea(l.id, e.target.value)}
                        />
                        {!l.producto && l.buscarProducto.trim() && (
                          <div className="resultados-busqueda">
                            {l.resultados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                            {l.resultados.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className="resultado-item"
                                onClick={() => actualizarLinea(l.id, { producto: p, buscarProducto: "", resultados: [] })}
                              >
                                {p.plu} — {p.descripcion}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {l.producto && <p className="ayuda">Precio de venta: {formatoCLP(l.producto.precio)}</p>}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        className="input-chico"
                        value={l.cantidad}
                        onChange={(e) => actualizarLinea(l.id, { cantidad: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        className="input-chico"
                        value={l.costoUnitario}
                        onChange={(e) => actualizarLinea(l.id, { costoUnitario: e.target.value })}
                      />
                    </td>
                    <td>{formatoCLP((Number(l.cantidad) || 0) * (Number(l.costoUnitario) || 0))}</td>
                    <td>
                      {margen != null ? (
                        <span className={`margen-destacado ${margen < 0 ? "margen-negativo" : ""}`}>
                          {margen.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="ayuda">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="boton-quitar-item" title="Quitar línea" onClick={() => quitarLinea(l.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="boton" onClick={agregarLinea}>
            + Agregar línea
          </button>
        </div>

        <p>
          <strong>Total de la factura: {formatoCLP(totalFactura)}</strong>
        </p>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar factura"}
          </button>
          <button type="button" onClick={() => navigate("/inventario")}>
            Volver a inventario
          </button>
        </div>
      </form>
    </div>
  );
}
