import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatoCLP, type CajaCamara } from "../api";
import { useUsuario } from "../context/UsuarioContext";

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
  const { usuario } = useUsuario();

  const [desde, setDesde] = useState(fechaHace(30));
  const [hasta, setHasta] = useState(hoy());
  const [cajas, setCajas] = useState<CajaCamara[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const [anulandoId, setAnulandoId] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [guardandoAnulacion, setGuardandoAnulacion] = useState(false);

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

  async function confirmarAnulacion(cajaId: number) {
    if (!usuario) return;
    if (!motivo.trim()) {
      setError("Indica el motivo de la anulación");
      return;
    }
    setError(null);
    setGuardandoAnulacion(true);
    try {
      await api.camara.anularEntrada(cajaId, usuario.id, motivo.trim());
      setAnulandoId(null);
      setMotivo("");
      await buscar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardandoAnulacion(false);
    }
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Revisar entradas</h1>
        <Link to="/camara">Volver a Cámara</Link>
      </div>
      <p className="ayuda">
        Todas las cajas que entraron a cámara en el rango elegido. "Anular" solo está disponible para una caja que
        sigue tal cual se creó (sin ninguna salida registrada todavía) — pensado para corregir entradas de prueba o
        duplicadas antes de que se les saque algo.
      </p>
      {error && <p className="error">{error}</p>}

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
            <th>Ingreso</th>
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
              <td colSpan={10}>Sin cajas en este rango.</td>
            </tr>
          )}
          {cajas.map((c) => (
            <tr key={c.id}>
              <td>{String(c.id).padStart(6, "0")}</td>
              <td>{c.producto.descripcion}</td>
              <td>{c.familiaNombre}</td>
              <td>{new Date(c.fechaIngreso).toLocaleString("es-CL")}</td>
              <td>{c.pesoInicialKg.toFixed(3)}</td>
              <td>{c.saldoKg.toFixed(3)}</td>
              <td>{formatoCLP(c.costoNetoKg)}</td>
              <td>{ETIQUETAS_ESTADO[c.estado] ?? c.estado}</td>
              <td>{c.creadoPor.nombre}</td>
              <td>
                {puedeAnular(c) &&
                  (anulandoId === c.id ? (
                    <span className="fila-inline">
                      <input
                        type="text"
                        placeholder="Motivo de la anulación"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        style={{ width: "12rem" }}
                      />
                      <button
                        type="button"
                        className="boton boton-peligro"
                        disabled={guardandoAnulacion}
                        onClick={() => confirmarAnulacion(c.id)}
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        className="boton"
                        disabled={guardandoAnulacion}
                        onClick={() => {
                          setAnulandoId(null);
                          setMotivo("");
                        }}
                      >
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="boton"
                      onClick={() => {
                        setAnulandoId(c.id);
                        setMotivo("");
                      }}
                    >
                      Anular entrada
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
