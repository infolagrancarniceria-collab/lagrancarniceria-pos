import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, formatoCLP, type ItemCharcuteria, type LoteProduccion } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

export default function CharcuteriaLoteDetalle() {
  const { id } = useParams();
  const loteId = Number(id);
  const { usuario } = useUsuario();
  const [lote, setLote] = useState<LoteProduccion | null>(null);
  const [insumosDisponibles, setInsumosDisponibles] = useState<ItemCharcuteria[]>([]);
  const [skusDelElaborado, setSkusDelElaborado] = useState<ItemCharcuteria[]>([]);
  const [envasesEtiquetas, setEnvasesEtiquetas] = useState<ItemCharcuteria[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Registrar insumo
  const [itemInsumoId, setItemInsumoId] = useState("");
  const [cantidadInsumo, setCantidadInsumo] = useState("");
  const [guardandoInsumo, setGuardandoInsumo] = useState(false);

  // Cerrar lote
  const [pesoSalidaKg, setPesoSalidaKg] = useState("");
  const [pesoEntradaKg, setPesoEntradaKg] = useState("");
  const [horasManoObra, setHorasManoObra] = useState("");
  const [costoHoraManoObra, setCostoHoraManoObra] = useState("");
  const [otrosCostosManuales, setOtrosCostosManuales] = useState("");
  const [parametrosReales, setParametrosReales] = useState("");
  const [cerrando, setCerrando] = useState(false);

  // Envasar
  const [skuId, setSkuId] = useState("");
  const [cantidadUnidades, setCantidadUnidades] = useState("");
  const [pesoUsadoG, setPesoUsadoG] = useState("");
  const [envaseItemId, setEnvaseItemId] = useState("");
  const [envasesConsumidos, setEnvasesConsumidos] = useState("");
  const [etiquetaItemId, setEtiquetaItemId] = useState("");
  const [etiquetasConsumidas, setEtiquetasConsumidas] = useState("");
  const [envasando, setEnvasando] = useState(false);

  // Editar vencimiento (admin)
  const [mostrarVencimiento, setMostrarVencimiento] = useState(false);
  const [vencimientoNuevo, setVencimientoNuevo] = useState("");
  const [motivoVencimiento, setMotivoVencimiento] = useState("");
  const [claveVencimiento, setClaveVencimiento] = useState("");
  const [guardandoVencimiento, setGuardandoVencimiento] = useState(false);

  // Anular
  const [mostrarAnular, setMostrarAnular] = useState(false);
  const [claveAnular, setClaveAnular] = useState("");
  const [anulando, setAnulando] = useState(false);

  function cargar() {
    api.charcuteria.lotes
      .obtener(loteId)
      .then((l) => {
        setLote(l);
        return l;
      })
      .then((l) => {
        api.charcuteria.items.listar().then((items) => {
          setInsumosDisponibles(items.filter((i) => ["materia_prima", "insumo"].includes(i.tipoItem)));
          setSkusDelElaborado(
            items.filter((i) => i.tipoItem === "producto_terminado" && i.productoElaboradoId === l.receta.productoElaboradoId)
          );
          setEnvasesEtiquetas(items.filter((i) => i.tipoItem === "envase_etiqueta"));
        });
      })
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, [loteId]);

  async function agregarInsumo(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !itemInsumoId || !cantidadInsumo) return;
    setGuardandoInsumo(true);
    setError(null);
    try {
      await api.charcuteria.lotes.agregarInsumo(loteId, { usuarioId: usuario.id, itemId: Number(itemInsumoId), cantidad: Number(cantidadInsumo) });
      mostrarToast("Insumo registrado");
      setItemInsumoId("");
      setCantidadInsumo("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoInsumo(false);
    }
  }

  async function cerrarLote(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !pesoSalidaKg) return;
    setCerrando(true);
    setError(null);
    try {
      await api.charcuteria.lotes.cerrar(loteId, {
        usuarioId: usuario.id,
        pesoSalidaKg: Number(pesoSalidaKg),
        pesoEntradaKg: pesoEntradaKg ? Number(pesoEntradaKg) : undefined,
        horasManoObra: horasManoObra ? Number(horasManoObra) : undefined,
        costoHoraManoObra: costoHoraManoObra ? Number(costoHoraManoObra) : undefined,
        otrosCostosManuales: otrosCostosManuales ? Number(otrosCostosManuales) : undefined,
        parametrosRealesProceso: parametrosReales.trim() || null,
      });
      mostrarToast("Lote cerrado", "Quedó terminado, con costo y merma calculados.");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCerrando(false);
    }
  }

  async function envasar(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !skuId || !cantidadUnidades || !pesoUsadoG) return;
    setEnvasando(true);
    setError(null);
    try {
      await api.charcuteria.lotes.envasar(loteId, {
        usuarioId: usuario.id,
        skuId: Number(skuId),
        cantidadUnidadesGeneradas: Number(cantidadUnidades),
        pesoRealTotalUsadoG: Number(pesoUsadoG),
        envaseItemId: envaseItemId ? Number(envaseItemId) : undefined,
        envasesConsumidos: envasesConsumidos ? Number(envasesConsumidos) : undefined,
        etiquetaItemId: etiquetaItemId ? Number(etiquetaItemId) : undefined,
        etiquetasConsumidas: etiquetasConsumidas ? Number(etiquetasConsumidas) : undefined,
      });
      mostrarToast("Envasado registrado");
      setSkuId("");
      setCantidadUnidades("");
      setPesoUsadoG("");
      setEnvaseItemId("");
      setEnvasesConsumidos("");
      setEtiquetaItemId("");
      setEtiquetasConsumidas("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnvasando(false);
    }
  }

  async function guardarVencimiento(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !vencimientoNuevo || !motivoVencimiento.trim() || !claveVencimiento) return;
    setGuardandoVencimiento(true);
    setError(null);
    try {
      await api.charcuteria.lotes.editarVencimiento(loteId, {
        usuarioId: usuario.id,
        clave: claveVencimiento,
        vencimientoNuevo: new Date(vencimientoNuevo).toISOString(),
        motivo: motivoVencimiento.trim(),
      });
      mostrarToast("Vencimiento actualizado");
      setMostrarVencimiento(false);
      setVencimientoNuevo("");
      setMotivoVencimiento("");
      setClaveVencimiento("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoVencimiento(false);
    }
  }

  async function anularLote() {
    if (!usuario || !claveAnular) return;
    setAnulando(true);
    setError(null);
    try {
      await api.charcuteria.lotes.anular(loteId, { usuarioId: usuario.id, clave: claveAnular });
      mostrarToast("Lote anulado", undefined, "eliminado");
      setMostrarAnular(false);
      setClaveAnular("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnulando(false);
    }
  }

  async function cerrarDefinitivo() {
    if (!usuario) return;
    try {
      await api.charcuteria.lotes.cerrarDefinitivo(loteId, usuario.id);
      mostrarToast("Lote cerrado definitivamente");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!lote) {
    return (
      <div>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
        <p>Cargando...</p>
      </div>
    );
  }

  const costoPorKg = lote.costoTotal && lote.pesoSalidaKg ? lote.costoTotal / lote.pesoSalidaKg : null;

  return (
    <div>
      <h1>
        Lote {lote.codigo} — {lote.receta.productoElaborado.nombre}
      </h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

      <div className="tarjeta">
        <p>
          <strong>Estado:</strong> {lote.estado} · <strong>Receta:</strong> v{lote.recetaVersion} · <strong>Responsable:</strong>{" "}
          {lote.responsable.nombre}
        </p>
        <p>
          <strong>Peso entrada:</strong> {lote.pesoEntradaKg ?? "—"} kg · <strong>Peso salida:</strong> {lote.pesoSalidaKg ?? "—"} kg ·{" "}
          <strong>Merma esperada:</strong> {lote.mermaEsperadaPct != null ? `${Math.round(lote.mermaEsperadaPct)}%` : "—"} ·{" "}
          <strong>Merma real:</strong> {lote.mermaRealPct != null ? `${lote.mermaRealPct}%` : "—"}
        </p>
        <p>
          <strong>Costo total:</strong> {lote.costoTotal != null ? formatoCLP(lote.costoTotal) : "—"} ·{" "}
          <strong>Costo por kg elaborado:</strong> {costoPorKg != null ? formatoCLP(Math.round(costoPorKg)) : "—"}
        </p>
        <p>
          <strong>Vencimiento:</strong> {lote.fechaVencimiento ? new Date(lote.fechaVencimiento).toLocaleDateString("es-CL") : "—"}{" "}
          {usuario && (
            <button type="button" onClick={() => setMostrarVencimiento((v) => !v)}>
              Editar (admin)
            </button>
          )}
        </p>
      </div>

      {mostrarVencimiento && (
        <form onSubmit={guardarVencimiento} onKeyDown={manejarEnterComoTab} className="formulario tarjeta">
          <h3>Editar vencimiento</h3>
          <p className="ayuda">Requiere tu clave personal (Charcutería → Mi clave) y queda con registro del cambio.</p>
          <div className="fila-inline">
            <label>
              Nueva fecha
              <input type="date" value={vencimientoNuevo} onChange={(e) => setVencimientoNuevo(e.target.value)} required />
            </label>
            <label>
              Motivo
              <input value={motivoVencimiento} onChange={(e) => setMotivoVencimiento(e.target.value)} required />
            </label>
            <label>
              Tu clave personal
              <input type="password" value={claveVencimiento} onChange={(e) => setClaveVencimiento(e.target.value)} required />
            </label>
          </div>
          <button type="submit" className="boton boton-primario" disabled={guardandoVencimiento}>
            {guardandoVencimiento ? "Guardando..." : "Guardar"}
          </button>
        </form>
      )}

      {lote.cambiosVencimiento.length > 0 && (
        <details>
          <summary>Historial de cambios de vencimiento ({lote.cambiosVencimiento.length})</summary>
          <ul>
            {lote.cambiosVencimiento.map((c) => (
              <li key={c.id}>
                {new Date(c.creadoEn).toLocaleString("es-CL")} — {c.usuario.nombre}: de{" "}
                {c.vencimientoAnterior ? new Date(c.vencimientoAnterior).toLocaleDateString("es-CL") : "—"} a{" "}
                {new Date(c.vencimientoNuevo).toLocaleDateString("es-CL")} ({c.motivo})
              </li>
            ))}
          </ul>
        </details>
      )}

      {lote.estado === "en_proceso" && (
        <div className="tarjeta">
          <h2>Registrar insumo consumido</h2>
          <form onSubmit={agregarInsumo} onKeyDown={manejarEnterComoTab} className="fila-inline">
            <select value={itemInsumoId} onChange={(e) => setItemInsumoId(e.target.value)} required>
              <option value="">— ítem —</option>
              {insumosDisponibles.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre} (stock: {i.stockActual} {i.unidadMedida === "gramos" ? "g" : "un."})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Cantidad"
              value={cantidadInsumo}
              onChange={(e) => setCantidadInsumo(e.target.value)}
              required
            />
            <button type="submit" className="boton boton-primario" disabled={guardandoInsumo}>
              {guardandoInsumo ? "Guardando..." : "Agregar"}
            </button>
          </form>
        </div>
      )}

      <table className="tabla">
        <thead>
          <tr>
            <th>Insumo consumido</th>
            <th>Cantidad</th>
            <th>Costo unitario</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {lote.insumosConsumidos.map((i) => (
            <tr key={i.id}>
              <td>{i.item.nombre}</td>
              <td>
                {i.cantidad} {i.item.unidadMedida === "gramos" ? "g" : "un."}
              </td>
              <td>{formatoCLP(i.costoUnitarioAlMomento)}</td>
              <td>{formatoCLP(Math.round(i.cantidad * i.costoUnitarioAlMomento))}</td>
            </tr>
          ))}
          {lote.insumosConsumidos.length === 0 && (
            <tr>
              <td colSpan={4}>Sin insumos registrados todavía.</td>
            </tr>
          )}
        </tbody>
      </table>

      {lote.estado === "en_proceso" && (
        <div className="tarjeta">
          <h2>Cerrar lote</h2>
          <form onSubmit={cerrarLote} onKeyDown={manejarEnterComoTab} className="formulario">
            <div className="fila-inline">
              <label>
                Peso de entrada (kg) — vacío = usa lo acumulado por insumos
                <input type="number" min="0.01" step="0.01" value={pesoEntradaKg} onChange={(e) => setPesoEntradaKg(e.target.value)} />
              </label>
              <label>
                Peso de salida real (kg)
                <input type="number" min="0.01" step="0.01" value={pesoSalidaKg} onChange={(e) => setPesoSalidaKg(e.target.value)} required />
              </label>
            </div>
            <div className="fila-inline">
              <label>
                Horas de mano de obra
                <input type="number" min="0" step="0.1" value={horasManoObra} onChange={(e) => setHorasManoObra(e.target.value)} />
              </label>
              <label>
                Costo por hora
                <input type="number" min="0" value={costoHoraManoObra} onChange={(e) => setCostoHoraManoObra(e.target.value)} />
              </label>
              <label>
                Otros costos manuales
                <input type="number" min="0" value={otrosCostosManuales} onChange={(e) => setOtrosCostosManuales(e.target.value)} />
              </label>
            </div>
            <label>
              Parámetros reales del proceso
              <textarea value={parametrosReales} onChange={(e) => setParametrosReales(e.target.value)} rows={2} />
            </label>
            <button type="submit" className="boton boton-primario" disabled={cerrando}>
              {cerrando ? "Cerrando..." : "Cerrar lote"}
            </button>
          </form>
        </div>
      )}

      {(lote.estado === "terminado" || lote.estado === "envasado") && (
        <div className="tarjeta">
          <h2>Envasar</h2>
          <form onSubmit={envasar} onKeyDown={manejarEnterComoTab} className="formulario">
            <div className="fila-inline">
              <label>
                SKU
                <select value={skuId} onChange={(e) => setSkuId(e.target.value)} required>
                  <option value="">— elegir —</option>
                  {skusDelElaborado
                    .filter((s) => s.formatoGramos != null)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre} ({s.formatoGramos} g)
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Unidades generadas
                <input type="number" min="1" value={cantidadUnidades} onChange={(e) => setCantidadUnidades(e.target.value)} required />
              </label>
              <label>
                Peso real usado (g)
                <input type="number" min="1" value={pesoUsadoG} onChange={(e) => setPesoUsadoG(e.target.value)} required />
              </label>
            </div>
            <div className="fila-inline">
              <label>
                Envase
                <select value={envaseItemId} onChange={(e) => setEnvaseItemId(e.target.value)}>
                  <option value="">—</option>
                  {envasesEtiquetas.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Envases consumidos
                <input type="number" min="1" value={envasesConsumidos} onChange={(e) => setEnvasesConsumidos(e.target.value)} />
              </label>
              <label>
                Etiqueta
                <select value={etiquetaItemId} onChange={(e) => setEtiquetaItemId(e.target.value)}>
                  <option value="">—</option>
                  {envasesEtiquetas.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Etiquetas consumidas
                <input type="number" min="1" value={etiquetasConsumidas} onChange={(e) => setEtiquetasConsumidas(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="boton boton-primario" disabled={envasando}>
              {envasando ? "Guardando..." : "Registrar envasado"}
            </button>
          </form>
        </div>
      )}

      {lote.stockPorSku.length > 0 && (
        <table className="tabla">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {lote.stockPorSku.map((s) => (
              <tr key={s.skuId}>
                <td>{s.sku.nombre}</td>
                <td>{s.saldoUnidades} un.</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="acciones-formulario">
        {(lote.estado === "terminado" || lote.estado === "envasado") && (
          <button type="button" onClick={cerrarDefinitivo}>
            Cerrar definitivamente
          </button>
        )}
        {lote.estado !== "anulado" && lote.estado !== "cerrado" && !mostrarAnular && (
          <button type="button" onClick={() => setMostrarAnular(true)}>
            Anular lote
          </button>
        )}
      </div>

      {mostrarAnular && (
        <div className="tarjeta fila-inline">
          <span>¿Anular este lote? Requiere clave de supervisor.</span>
          <input type="password" placeholder="Clave de supervisor" value={claveAnular} onChange={(e) => setClaveAnular(e.target.value)} />
          <button type="button" className="boton boton-primario" onClick={anularLote} disabled={anulando}>
            {anulando ? "Anulando..." : "Confirmar anulación"}
          </button>
          <button type="button" onClick={() => setMostrarAnular(false)} disabled={anulando}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
