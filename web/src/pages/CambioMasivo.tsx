import { useEffect, useState } from "react";
import { api, formatoCLP, type Categoria } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";

interface CambioCategoria {
  productoId: number;
  plu: string;
  descripcion: string;
  precioActual: number;
  precioNuevo: number;
}

interface FilaCsv {
  fila: number;
  plu: string;
  precioNuevo: number | null;
  productoId: number | null;
  descripcion: string | null;
  precioActual: number | null;
  error: string | null;
}

export default function CambioMasivo() {
  const { usuario } = useUsuario();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [tipo, setTipo] = useState<"porcentaje" | "monto_fijo">("porcentaje");
  const [valor, setValor] = useState("");
  const [previewCategoria, setPreviewCategoria] = useState<CambioCategoria[] | null>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewCsv, setPreviewCsv] = useState<FilaCsv[] | null>(null);

  useEffect(() => {
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  async function previsualizarCategoria(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!categoriaId || !valor || !usuario) return;
    try {
      const resultado = await api.precios.masivoCategoria({
        categoriaId: Number(categoriaId),
        tipo,
        valor: Number(valor),
        usuarioId: usuario.id,
        confirmar: false,
      });
      setPreviewCategoria(resultado.cambios);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function aplicarCategoria() {
    if (!categoriaId || !valor || !usuario) return;
    const confirmado = window.confirm(`¿Aplicar el cambio a ${previewCategoria?.length ?? 0} productos?`);
    if (!confirmado) return;
    try {
      await api.precios.masivoCategoria({
        categoriaId: Number(categoriaId),
        tipo,
        valor: Number(valor),
        usuarioId: usuario.id,
        confirmar: true,
      });
      setMensaje("Precios actualizados correctamente");
      setPreviewCategoria(null);
      setValor("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function previsualizarCsv(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!archivo || !usuario) return;
    try {
      const resultado = await api.precios.masivoCsv(archivo, usuario.id, false);
      setPreviewCsv(resultado.filas);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function aplicarCsv() {
    if (!archivo || !usuario) return;
    const validas = previewCsv?.filter((f) => !f.error).length ?? 0;
    const confirmado = window.confirm(`¿Aplicar el cambio a ${validas} productos válidos del archivo?`);
    if (!confirmado) return;
    try {
      const resultado = await api.precios.masivoCsv(archivo, usuario.id, true);
      setMensaje(`Precios actualizados: ${resultado.aplicados} productos`);
      setPreviewCsv(null);
      setArchivo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Cambio masivo de precios</h1>
      {error && <p className="error">{error}</p>}
      {mensaje && <p className="exito">{mensaje}</p>}

      <section className="tarjeta">
        <h2>Por categoría</h2>
        <form onSubmit={previsualizarCategoria} onKeyDown={manejarEnterComoTab} className="fila-inline">
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Elegir categoría...</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {"— ".repeat(c.nivel - 1)}
                {c.codigo} {c.nombre}
              </option>
            ))}
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "porcentaje" | "monto_fijo")}>
            <option value="porcentaje">Porcentaje (%)</option>
            <option value="monto_fijo">Monto fijo ($)</option>
          </select>
          <input
            type="number"
            placeholder={tipo === "porcentaje" ? "ej. 5 (sube 5%) o -10 (baja 10%)" : "ej. 500 o -200"}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
          <button type="submit">Previsualizar</button>
        </form>

        {previewCategoria && (
          <>
            <table className="tabla">
              <thead>
                <tr>
                  <th>PLU</th>
                  <th>Descripción</th>
                  <th>Precio actual</th>
                  <th>Precio nuevo</th>
                </tr>
              </thead>
              <tbody>
                {previewCategoria.map((c) => (
                  <tr key={c.productoId}>
                    <td>{c.plu}</td>
                    <td>{c.descripcion}</td>
                    <td>{formatoCLP(c.precioActual)}</td>
                    <td>{formatoCLP(c.precioNuevo)}</td>
                  </tr>
                ))}
                {previewCategoria.length === 0 && (
                  <tr>
                    <td colSpan={4}>No hay productos en esa categoría.</td>
                  </tr>
                )}
              </tbody>
            </table>
            {previewCategoria.length > 0 && (
              <button type="button" className="boton boton-primario" onClick={aplicarCategoria}>
                Confirmar y aplicar
              </button>
            )}
          </>
        )}
      </section>

      <section className="tarjeta">
        <h2>Desde planilla CSV</h2>
        <p className="ayuda">
          El archivo debe ser CSV con dos columnas: <code>plu</code> y <code>precio_nuevo</code>.
        </p>
        <form onSubmit={previsualizarCsv} onKeyDown={manejarEnterComoTab} className="fila-inline">
          <input type="file" accept=".csv" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          <button type="submit" disabled={!archivo}>
            Previsualizar
          </button>
        </form>

        {previewCsv && (
          <>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>PLU</th>
                  <th>Descripción</th>
                  <th>Precio actual</th>
                  <th>Precio nuevo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {previewCsv.map((f) => (
                  <tr key={f.fila} className={f.error ? "fila-error" : ""}>
                    <td>{f.fila}</td>
                    <td>{f.plu}</td>
                    <td>{f.descripcion ?? "—"}</td>
                    <td>{f.precioActual != null ? formatoCLP(f.precioActual) : "—"}</td>
                    <td>{f.precioNuevo != null ? formatoCLP(f.precioNuevo) : "—"}</td>
                    <td>{f.error ?? "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewCsv.some((f) => !f.error) && (
              <button type="button" className="boton boton-primario" onClick={aplicarCsv}>
                Confirmar y aplicar filas válidas
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
