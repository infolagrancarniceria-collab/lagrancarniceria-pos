import { useEffect, useState } from "react";
import { api, type ItemCharcuteria, type Receta } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

interface FilaIngrediente {
  itemId: string;
  cantidadPorLoteBase: string;
  unidad: "gramos" | "unidad";
}

function filaVacia(): FilaIngrediente {
  return { itemId: "", cantidadPorLoteBase: "", unidad: "gramos" };
}

export default function CharcuteriaRecetas() {
  const { usuario } = useUsuario();
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [ingredientesDisponibles, setIngredientesDisponibles] = useState<ItemCharcuteria[]>([]);
  const [productosElaborados, setProductosElaborados] = useState<ItemCharcuteria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  const [productoElaboradoId, setProductoElaboradoId] = useState("");
  const [rendimientoEsperadoPct, setRendimientoEsperadoPct] = useState("");
  const [dosisSalesCurantesPorKg, setDosisSalesCurantesPorKg] = useState("");
  const [parametrosProceso, setParametrosProceso] = useState("");
  const [notas, setNotas] = useState("");
  const [filas, setFilas] = useState<FilaIngrediente[]>([filaVacia()]);
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    api.charcuteria.recetas.listar().then(setRecetas).catch((e) => setError(e.message));
    api.charcuteria.items.listar({ incluirInactivos: false }).then((items) => {
      setIngredientesDisponibles(items.filter((i) => i.tipoItem !== "producto_terminado"));
      setProductosElaborados(items.filter((i) => i.tipoItem === "producto_elaborado"));
    });
  }

  useEffect(cargar, []);

  function actualizarFila(i: number, cambios: Partial<FilaIngrediente>) {
    setFilas((actual) => actual.map((f, idx) => (idx === i ? { ...f, ...cambios } : f)));
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario) return;
    if (!productoElaboradoId || !rendimientoEsperadoPct) {
      setError("Falta el producto elaborado o el rendimiento esperado");
      return;
    }
    const ingredientes = filas
      .filter((f) => f.itemId && f.cantidadPorLoteBase)
      .map((f) => ({ itemId: Number(f.itemId), cantidadPorLoteBase: Number(f.cantidadPorLoteBase), unidad: f.unidad }));
    if (ingredientes.length === 0) {
      setError("Agrega al menos un ingrediente");
      return;
    }
    setGuardando(true);
    try {
      await api.charcuteria.recetas.crear({
        usuarioId: usuario.id,
        productoElaboradoId: Number(productoElaboradoId),
        rendimientoEsperadoPct: Number(rendimientoEsperadoPct),
        dosisSalesCurantesPorKg: dosisSalesCurantesPorKg ? Number(dosisSalesCurantesPorKg) : null,
        parametrosProceso: parametrosProceso.trim() || null,
        notas: notas.trim() || null,
        ingredientes,
      });
      mostrarToast("Receta creada", "Quedó como la versión activa.");
      setProductoElaboradoId("");
      setRendimientoEsperadoPct("");
      setDosisSalesCurantesPorKg("");
      setParametrosProceso("");
      setNotas("");
      setFilas([filaVacia()]);
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
      <h1>Recetas</h1>
      <p className="ayuda">
        Cada producto elaborado tiene una sola versión activa a la vez — crear una receta nueva para un producto que
        ya tenía una desactiva automáticamente la anterior (que queda de solo lectura).
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <button type="button" onClick={() => setMostrarForm((v) => !v)}>
        {mostrarForm ? "Cancelar" : "+ Nueva receta"}
      </button>

      {mostrarForm && (
        <form onSubmit={crear} onKeyDown={manejarEnterComoTab} className="formulario tarjeta">
          <div className="fila-inline">
            <label>
              Producto elaborado
              <select value={productoElaboradoId} onChange={(e) => setProductoElaboradoId(e.target.value)} required>
                <option value="">— elegir —</option>
                {productosElaborados.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rendimiento esperado (%)
              <input
                type="number"
                min="1"
                max="100"
                value={rendimientoEsperadoPct}
                onChange={(e) => setRendimientoEsperadoPct(e.target.value)}
                required
              />
            </label>
            <label>
              Sales curantes (g/kg)
              <input
                type="number"
                min="0"
                step="0.01"
                value={dosisSalesCurantesPorKg}
                onChange={(e) => setDosisSalesCurantesPorKg(e.target.value)}
              />
            </label>
          </div>
          <label>
            Parámetros de proceso (temperatura, tiempo de ahumado/cocción, reposo...)
            <textarea value={parametrosProceso} onChange={(e) => setParametrosProceso(e.target.value)} rows={2} />
          </label>
          <label>
            Notas
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </label>

          <h3>Ingredientes</h3>
          {filas.map((f, i) => (
            <div key={i} className="fila-inline">
              <select value={f.itemId} onChange={(e) => actualizarFila(i, { itemId: e.target.value })}>
                <option value="">— ingrediente —</option>
                {ingredientesDisponibles.map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {ing.nombre}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Cantidad por lote base"
                value={f.cantidadPorLoteBase}
                onChange={(e) => actualizarFila(i, { cantidadPorLoteBase: e.target.value })}
              />
              <select value={f.unidad} onChange={(e) => actualizarFila(i, { unidad: e.target.value as "gramos" | "unidad" })}>
                <option value="gramos">gramos</option>
                <option value="unidad">unidades</option>
              </select>
              <button type="button" onClick={() => setFilas((actual) => actual.filter((_, idx) => idx !== i))}>
                ✕
              </button>
            </div>
          ))}
          <div className="acciones-formulario">
            <button type="button" onClick={() => setFilas((actual) => [...actual, filaVacia()])}>
              + Agregar ingrediente
            </button>
          </div>

          <div className="acciones-formulario">
            <button type="submit" className="boton boton-primario" disabled={guardando}>
              {guardando ? "Guardando..." : "Crear receta"}
            </button>
          </div>
        </form>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th>Producto elaborado</th>
            <th>Versión</th>
            <th>Estado</th>
            <th>Rendimiento esperado</th>
            <th>Ingredientes</th>
          </tr>
        </thead>
        <tbody>
          {recetas.map((r) => (
            <tr key={r.id}>
              <td>{r.productoElaborado.nombre}</td>
              <td>v{r.version}</td>
              <td>{r.activa ? <span className="exito">Activa</span> : "Solo lectura"}</td>
              <td>{r.rendimientoEsperadoPct}%</td>
              <td>{r.ingredientes.map((i) => `${i.item.nombre} (${i.cantidadPorLoteBase}${i.unidad === "gramos" ? "g" : "un."})`).join(", ")}</td>
            </tr>
          ))}
          {recetas.length === 0 && (
            <tr>
              <td colSpan={5}>Sin recetas todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
