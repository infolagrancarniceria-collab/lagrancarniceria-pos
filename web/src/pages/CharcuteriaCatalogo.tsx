import { useEffect, useState } from "react";
import { api, formatoCLP, type ItemCharcuteria, type TipoItemCharcuteria } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const ETIQUETAS_TIPO: Record<TipoItemCharcuteria, string> = {
  materia_prima: "Materia prima",
  insumo: "Insumo",
  envase_etiqueta: "Envase/etiqueta",
  producto_elaborado: "Producto elaborado",
  producto_terminado: "Producto terminado (SKU)",
};

function formularioVacio() {
  return {
    codigo: "",
    nombre: "",
    tipoItem: "materia_prima" as TipoItemCharcuteria,
    unidadMedida: "gramos" as "gramos" | "unidad",
    formatoGramos: "",
    productoElaboradoId: "",
    linea: "" as "" | "tabla" | "fiestas",
    precioVenta: "",
    vidaUtilDias: "",
    ingredientes: "",
    alergenos: "",
    condicionesConservacion: "",
    sellosAltoEnTexto: "",
  };
}

export default function CharcuteriaCatalogo() {
  const { usuario } = useUsuario();
  const [items, setItems] = useState<ItemCharcuteria[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<TipoItemCharcuteria | "">("");
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(formularioVacio());
  const [guardando, setGuardando] = useState(false);

  const productosElaborados = items.filter((i) => i.tipoItem === "producto_elaborado" && i.activo);

  function cargar() {
    api.charcuteria.items
      .listar({ tipoItem: filtroTipo || undefined, buscar: buscar.trim() || undefined })
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    const t = setTimeout(cargar, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroTipo, buscar]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario) return;
    if (!form.codigo.trim() || !form.nombre.trim()) {
      setError("Falta el código o el nombre");
      return;
    }
    if (form.tipoItem === "producto_terminado" && !Number(form.precioVenta)) {
      setError("Falta el precio de venta");
      return;
    }
    setGuardando(true);
    try {
      await api.charcuteria.items.crear({
        usuarioId: usuario.id,
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        tipoItem: form.tipoItem,
        unidadMedida: form.unidadMedida,
        formatoGramos: form.formatoGramos ? Number(form.formatoGramos) : null,
        productoElaboradoId: form.productoElaboradoId ? Number(form.productoElaboradoId) : null,
        linea: form.linea || null,
        precioVenta: form.precioVenta ? Number(form.precioVenta) : undefined,
        vidaUtilDias: form.vidaUtilDias ? Number(form.vidaUtilDias) : null,
        ingredientes: form.ingredientes.trim() || null,
        alergenos: form.alergenos.trim() || null,
        condicionesConservacion: form.condicionesConservacion.trim() || null,
        sellosAltoEnTexto: form.sellosAltoEnTexto.trim() || null,
      });
      mostrarToast("Ítem creado", `${form.nombre} se agregó al catálogo.`);
      setForm(formularioVacio());
      setMostrarForm(false);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>Catálogo de charcutería</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="filtros">
        <input type="text" placeholder="Buscar por código o nombre..." value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoItemCharcuteria | "")}>
          <option value="">Todos los tipos</option>
          {Object.entries(ETIQUETAS_TIPO).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Cancelar" : "+ Nuevo ítem"}
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={crear} onKeyDown={manejarEnterComoTab} className="formulario tarjeta">
          <div className="fila-inline">
            <label>
              Código
              <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
            </label>
            <label>
              Nombre
              <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
            </label>
            <label>
              Tipo
              <select value={form.tipoItem} onChange={(e) => setForm({ ...form, tipoItem: e.target.value as TipoItemCharcuteria })}>
                {Object.entries(ETIQUETAS_TIPO).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Se mide en
              <select value={form.unidadMedida} onChange={(e) => setForm({ ...form, unidadMedida: e.target.value as "gramos" | "unidad" })}>
                <option value="gramos">Peso (gramos)</option>
                <option value="unidad">Unidades</option>
              </select>
            </label>
          </div>

          {form.tipoItem === "producto_elaborado" && (
            <div className="fila-inline">
              <label>
                Vida útil (días)
                <input type="number" min="1" value={form.vidaUtilDias} onChange={(e) => setForm({ ...form, vidaUtilDias: e.target.value })} />
              </label>
              <label>
                Ingredientes
                <input value={form.ingredientes} onChange={(e) => setForm({ ...form, ingredientes: e.target.value })} />
              </label>
              <label>
                Alérgenos
                <input value={form.alergenos} onChange={(e) => setForm({ ...form, alergenos: e.target.value })} />
              </label>
              <label>
                Conservación
                <input
                  value={form.condicionesConservacion}
                  onChange={(e) => setForm({ ...form, condicionesConservacion: e.target.value })}
                />
              </label>
              <label>
                Sellos "Alto en" (texto libre)
                <input value={form.sellosAltoEnTexto} onChange={(e) => setForm({ ...form, sellosAltoEnTexto: e.target.value })} />
              </label>
            </div>
          )}

          {form.tipoItem === "producto_terminado" && (
            <div className="fila-inline">
              <label>
                Producto elaborado de origen
                <select value={form.productoElaboradoId} onChange={(e) => setForm({ ...form, productoElaboradoId: e.target.value })}>
                  <option value="">— elegir —</option>
                  {productosElaborados.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Formato (g) — vacío = a granel
                <input
                  type="number"
                  min="1"
                  value={form.formatoGramos}
                  onChange={(e) => setForm({ ...form, formatoGramos: e.target.value })}
                />
              </label>
              <label>
                Línea
                <select value={form.linea} onChange={(e) => setForm({ ...form, linea: e.target.value as "" | "tabla" | "fiestas" })}>
                  <option value="">—</option>
                  <option value="tabla">Tabla</option>
                  <option value="fiestas">Fiestas</option>
                </select>
              </label>
              <label>
                Precio de venta (con IVA)
                <input
                  type="number"
                  min="1"
                  value={form.precioVenta}
                  onChange={(e) => setForm({ ...form, precioVenta: e.target.value })}
                  required
                />
              </label>
            </div>
          )}

          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Crear ítem"}
          </button>
        </form>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Stock</th>
            <th>Precio venta</th>
            <th>Costo ref.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{i.codigo}</td>
              <td>{i.nombre}</td>
              <td>{ETIQUETAS_TIPO[i.tipoItem]}</td>
              <td>
                {i.stockActual} {i.unidadMedida === "gramos" ? "g" : "un."}
              </td>
              <td>{i.productoEspejo ? formatoCLP(i.productoEspejo.precio) : "—"}</td>
              <td>{i.costoReferencia != null ? formatoCLP(i.costoReferencia) : "—"}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6}>Sin ítems en el catálogo todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
