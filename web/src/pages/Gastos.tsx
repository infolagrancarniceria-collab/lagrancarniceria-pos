import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type CategoriaGasto, type Gasto, type ReporteGastos } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { TecladoNumerico } from "../components/TecladoNumerico";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Gastos() {
  const { usuario } = useUsuario();
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [reporte, setReporte] = useState<ReporteGastos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Categorías de gasto — a pedido del usuario, ahora se "generan" a
  // propósito (lista manejada, ver CategoriaGasto) en vez de ser un campo
  // libre con solo sugerencias de lo ya usado. "Concepto" es la
  // sub-agrupación dentro de la categoría (ej. "Transportista" o
  // "Combustible" dentro de "Transporte") — esa sí queda como campo libre
  // con sugerencia, no hace falta mantener otra lista para algo tan chico.
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [categoria, setCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [nuevaCategoriaNombre, setNuevaCategoriaNombre] = useState("");
  const [concepto, setConcepto] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null);

  function cargarCategorias() {
    api.gastos.categorias().then(setCategorias).catch((e) => setError(e.message));
  }

  function cargar() {
    api.gastos.listar({ desde, hasta }).then(setGastos).catch((e) => setError(e.message));
    api.gastos.reporte(desde, hasta).then(setReporte).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargarCategorias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  async function crearCategoria() {
    if (!nuevaCategoriaNombre.trim()) return;
    try {
      const creada = await api.gastos.crearCategoria(nuevaCategoriaNombre.trim());
      cargarCategorias();
      setCategoria(creada.nombre);
      setNuevaCategoriaNombre("");
      setCreandoCategoria(false);
      mostrarToast("Categoría creada", creada.nombre);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Conceptos ya usados dentro de la categoría elegida — para sugerirlos
  // (no hace falta tipear "Transportista" de nuevo letra por letra cada
  // mes), sin mantener una lista aparte como con las categorías.
  const conceptosSugeridos = categoria.trim()
    ? Array.from(
        new Set(
          gastos
            .filter((g) => g.categoria.toLowerCase() === categoria.trim().toLowerCase() && g.concepto)
            .map((g) => g.concepto!.trim())
        )
      )
    : [];

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!usuario) return;
    if (!categoria.trim()) {
      setError("Falta la categoría");
      return;
    }
    if (!descripcion.trim()) {
      setError("Falta el nombre del gasto");
      return;
    }
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) {
      setError("El monto debe ser mayor a 0");
      return;
    }
    setGuardando(true);
    try {
      await api.gastos.crear({
        categoria: categoria.trim(),
        concepto: concepto.trim() || undefined,
        descripcion: descripcion.trim(),
        monto: montoNum,
        usuarioId: usuario.id,
      });
      setMensaje("Gasto registrado");
      mostrarToast(
        "Gasto registrado",
        `${descripcion.trim()} (${categoria.trim()}${concepto.trim() ? ` — ${concepto.trim()}` : ""}): ${formatoCLP(montoNum)}.`
      );
      setConcepto("");
      setDescripcion("");
      setMonto("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  // A pedido del usuario: ver al costado, mientras se tipea, cuánto se ha
  // gastado ya en la categoría elegida durante el período visible (no hace
  // falta pedir nada al servidor — "gastos" ya tiene cargado ese rango), y
  // desglosado por concepto (ej. "Transporte": Transportista $X, Combustible
  // $Y) para poder agrupar manualmente en vez de ver solo el total plano.
  const gastosCategoriaActual = categoria.trim()
    ? gastos.filter((g) => g.categoria.toLowerCase() === categoria.trim().toLowerCase())
    : [];
  const totalCategoriaActual = categoria.trim() ? gastosCategoriaActual.reduce((s, g) => s + g.monto, 0) : null;
  const desgloseConceptoActual = Array.from(
    gastosCategoriaActual.reduce((mapa, g) => {
      const clave = g.concepto?.trim() || "Sin concepto";
      return mapa.set(clave, (mapa.get(clave) ?? 0) + g.monto);
    }, new Map<string, number>())
  )
    .map(([concepto, total]) => ({ concepto, total }))
    .sort((a, b) => b.total - a.total);

  async function eliminar(id: number) {
    const confirmado = window.confirm("¿Eliminar este gasto?");
    if (!confirmado) return;
    try {
      await api.gastos.eliminar(id);
      mostrarToast("Gasto eliminado", undefined, "eliminado");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Gastos generales</h1>
      <p className="ayuda">
        Gastos del negocio que no son compra de mercadería (sueldos, luz, agua, arriendo, etc.) — la mercadería se
        sigue registrando en Inventario. Para ver estos gastos comparados contra ventas y compras, ve a{" "}
        <Link to="/reportes?tab=resumen">Reportes</Link>.
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {mensaje && <p className="exito">{mensaje}</p>}

      <div className="filtros">
        <label>
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      {reporte && (
        <div className="tarjeta">
          <h2>Resumen del período</h2>
          <p className="ayuda">Haz clic en una categoría para ver el desglose por concepto.</p>
          <table className="tabla">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(reporte.totalPorCategoria).map(([cat, totalCat]) => {
                const abierta = categoriaAbierta === cat;
                const conceptos = Object.entries(reporte.totalPorCategoriaYConcepto[cat] ?? {}).sort(
                  (a, b) => b[1] - a[1]
                );
                return (
                  <Fragment key={cat}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          onClick={() => setCategoriaAbierta(abierta ? null : cat)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                        >
                          {abierta ? "▼" : "▶"} {cat}
                        </button>
                      </td>
                      <td>{formatoCLP(totalCat)}</td>
                    </tr>
                    {abierta &&
                      conceptos.map(([conc, totalConc]) => (
                        <tr key={`${cat}-${conc}`}>
                          <td style={{ paddingLeft: "2rem" }} className="ayuda">
                            {conc}
                          </td>
                          <td className="ayuda">{formatoCLP(totalConc)}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {Object.keys(reporte.totalPorCategoria).length === 0 && (
                <tr>
                  <td colSpan={2}>Sin gastos registrados en este período.</td>
                </tr>
              )}
            </tbody>
          </table>
          <p>
            <strong>Total del período:</strong> {formatoCLP(reporte.total)}
          </p>
        </div>
      )}

      <div className="tarjeta fila-inline" style={{ alignItems: "flex-start" }}>
        <form onSubmit={registrar} onKeyDown={manejarEnterComoTab} className="fila-inline" style={{ flex: 1 }}>
          <h2 style={{ width: "100%" }}>Registrar gasto</h2>
          <input
            type="text"
            placeholder="Nombre del gasto (ej. Sueldo Juan, cuenta de luz octubre)"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            style={{ minWidth: "260px" }}
          />
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Categoría...</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          {!creandoCategoria ? (
            <button type="button" className="boton-chico" onClick={() => setCreandoCategoria(true)}>
              + Nueva categoría
            </button>
          ) : (
            <span className="fila-inline" style={{ gap: "0.4rem" }}>
              <input
                type="text"
                placeholder="Nombre de la categoría"
                value={nuevaCategoriaNombre}
                onChange={(e) => setNuevaCategoriaNombre(e.target.value)}
                autoFocus
              />
              <button type="button" onClick={crearCategoria}>
                Crear
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreandoCategoria(false);
                  setNuevaCategoriaNombre("");
                }}
              >
                Cancelar
              </button>
            </span>
          )}
          <input
            type="text"
            list="conceptos-gasto"
            placeholder="Concepto (opcional, ej. Transportista)"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
          />
          <datalist id="conceptos-gasto">
            {conceptosSugeridos.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input type="number" min="1" placeholder="Monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
          <TecladoNumerico valor={monto} onCambiar={setMonto} />
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar"}
          </button>
        </form>
        {totalCategoriaActual != null && (
          <div className="tarjeta tarjeta-mini">
            <strong>{categoria.trim()}</strong>
            <p style={{ fontSize: "1.2rem", margin: "0.25rem 0" }}>{formatoCLP(totalCategoriaActual)}</p>
            <p className="ayuda">
              ya gastado en esta categoría, {desde} a {hasta}
            </p>
            {desgloseConceptoActual.length > 0 && (
              <table className="tabla" style={{ marginTop: "0.5rem" }}>
                <tbody>
                  {desgloseConceptoActual.map((d) => (
                    <tr key={d.concepto}>
                      <td className="ayuda">{d.concepto}</td>
                      <td className="ayuda">{formatoCLP(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <table className="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Categoría</th>
            <th>Concepto</th>
            <th>Descripción</th>
            <th>Monto</th>
            <th>Registrado por</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {gastos.map((g) => (
            <tr key={g.id}>
              <td>{new Date(g.fecha).toLocaleDateString("es-CL")}</td>
              <td>{g.categoria}</td>
              <td>{g.concepto ?? "—"}</td>
              <td>{g.descripcion ?? "—"}</td>
              <td>{formatoCLP(g.monto)}</td>
              <td>{g.usuario.nombre}</td>
              <td>
                <button type="button" className="boton-quitar-item" title="Eliminar" onClick={() => eliminar(g.id)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {gastos.length === 0 && (
            <tr>
              <td colSpan={7}>No hay gastos registrados en este período.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
