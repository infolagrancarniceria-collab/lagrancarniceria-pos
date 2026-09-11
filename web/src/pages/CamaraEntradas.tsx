import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type CajaCamara } from "../api";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";

const MOTIVOS_ANULAR_CAJA = ["Caja de prueba", "Entrada duplicada", "Datos incorrectos"];

function fechaHace(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  en_camara: "En cámara",
  parcial: "Parcial",
  salida: "Salida",
  ajuste_pendiente: "Ajuste pendiente",
  anulada: "Anulada",
};

// Pantalla para revisar las entradas de cámara de un rango de fechas — a
// pedido del usuario, tras hacer pruebas y no tener forma de corregir una
// entrada equivocada (ej. duplicada) sin arriesgar quedar con stock de más
// en cámara. "Anular" solo está disponible mientras la caja siga
// exactamente como se creó (sin ninguna salida registrada todavía) — si ya
// se le sacó algo, hay que corregirlo aparte (el servidor igual lo
// rechaza, esto solo evita el intento).
export default function CamaraEntradas() {
  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [cajas, setCajas] = useState<CajaCamara[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [anulandoId, setAnulandoId] = useState<number | null>(null);
  const [reimprimiendoId, setReimprimiendoId] = useState<number | null>(null);

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await api.camara.cajas({ desde, hasta });
      setCajas(resultado);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function puedeAnular(caja: CajaCamara): boolean {
    return caja.estado === "en_camara" && Math.abs(caja.saldoKg - caja.pesoInicialKg) < 0.0005;
  }

  async function confirmarAnulacion(usuarioAutorizaId: number, clave: string, motivo?: string) {
    if (anulandoId == null) return;
    setError(null);
    await api.camara.anularEntrada(anulandoId, usuarioAutorizaId, clave, motivo ?? "");
    mostrarToast("Entrada anulada", `Caja ${String(anulandoId).padStart(6, "0")}.`, "eliminado");
    setAnulandoId(null);
    await buscar();
  }

  // Reimprimir la etiqueta de una caja directamente desde esta pantalla —
  // antes solo se podía desde Cámara → Existencias, buscando el lote al que
  // pertenece la caja (varios pasos). Acá ya está la caja en pantalla, así
  // que basta con mostrar su etiqueta oculta (ver ".vale-oculto-hasta-
  // imprimir" en styles.css, mismo patrón que usa el vale de Punto de
  // Venta) y mandar a imprimir. El número original se conserva, no se crea
  // ninguna caja nueva.
  function reimprimir(id: number) {
    setReimprimiendoId(id);
    setTimeout(() => {
      imprimirEtiquetaCamara();
      setTimeout(() => setReimprimiendoId(null), 500);
    }, 0);
  }

  return (
    <div>
      {/* Todo lo que no sea la etiqueta oculta va acá adentro — sin esto, al
          reimprimir una caja el navegador imprimía la pantalla completa (esta
          tabla con todas las cajas del rango, no solo la etiqueta pedida). */}
      <div className="no-imprimir">
        <div className="encabezado-pantalla">
          <h1>Revisar entradas</h1>
          <Link to="/camara">Volver a Cámara</Link>
        </div>
        <p className="ayuda">
          Todas las cajas que entraron a cámara en el rango elegido. "Anular" solo está disponible para una caja que
          sigue tal cual se creó (sin ninguna salida registrada todavía) — pensado para corregir entradas de prueba o
          duplicadas antes de que se les saque algo.
        </p>
        {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}

        <form onSubmit={buscar} className="fila-inline">
          <label>
            Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label>
            Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <button type="submit">{cargando ? "Buscando..." : "Buscar"}</button>
        </form>

        <table className="tabla">
          <thead>
            <tr>
              <th>Caja</th>
              <th>Producto</th>
              <th>Familia</th>
              <th>Procedencia</th>
              <th>Ingreso</th>
              <th>Salida</th>
              <th>Peso inicial (kg)</th>
              <th>Saldo (kg)</th>
              <th>Costo/kg</th>
              <th>Estado</th>
              <th>Creó</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cajas.length === 0 && !cargando && (
              <tr>
                <td colSpan={12}>Sin cajas en este rango.</td>
              </tr>
            )}
            {cajas.map((c) => (
              <tr key={c.id}>
                <td>{String(c.id).padStart(6, "0")}</td>
                <td>{c.producto.descripcion}</td>
                <td>{c.familiaNombre}</td>
                <td>{c.procedencia ?? "—"}</td>
                <td>{new Date(c.fechaIngreso).toLocaleString("es-CL")}</td>
                <td>{c.fechaSalida ? new Date(c.fechaSalida).toLocaleString("es-CL") : "—"}</td>
                <td>{c.pesoInicialKg.toFixed(3)}</td>
                <td>{c.saldoKg.toFixed(3)}</td>
                <td>{formatoCLP(c.costoNetoKg)}</td>
                <td>{ETIQUETAS_ESTADO[c.estado] ?? c.estado}</td>
                <td>{c.creadoPor.nombre}</td>
                <td className="fila-inline">
                  <button type="button" className="boton" onClick={() => reimprimir(c.id)}>
                    Reimprimir
                  </button>
                  {puedeAnular(c) && (
                    <button type="button" className="boton" onClick={() => setAnulandoId(c.id)}>
                      Anular entrada
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reimprimiendoId != null && (
        <div className="vale-oculto-hasta-imprimir">
          {(() => {
            const caja = cajas.find((c) => c.id === reimprimiendoId);
            if (!caja) return null;
            return (
              <EtiquetaCamara
                numero={String(caja.id).padStart(6, "0")}
                producto={caja.producto.descripcion}
                familia={caja.familiaNombre}
                procedencia={caja.procedencia}
                fechaIngreso={caja.fechaIngreso}
                pesoInicialKg={caja.pesoInicialKg}
                pesoEstimado={caja.pesoEstimado}
                imprimiendo
              />
            );
          })()}
        </div>
      )}

      {anulandoId != null && (
        <ModalConfirmarClave
          titulo="Anular entrada"
          descripcion="La caja queda fuera de existencias. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={MOTIVOS_ANULAR_CAJA}
          onConfirmar={confirmarAnulacion}
          onCancelar={() => setAnulandoId(null)}
        />
      )}
    </div>
  );
}
