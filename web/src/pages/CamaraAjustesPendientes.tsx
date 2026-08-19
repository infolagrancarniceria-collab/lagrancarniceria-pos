import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CajaCamara, type ResultadoAjusteCamara } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { ejecutarOEncolar } from "../lib/colaOffline";
import { EstadoOffline } from "../components/EstadoOffline";

// Lista las cajas que quedaron marcadas "ajuste_pendiente" tras cerrar un
// conteo por escaneo (estaban esperadas y no se escanearon). Es una lista
// de pendientes: se resuelve confirmando que la caja realmente falta (sale
// de cámara con saldo 0) o marcándola como encontrada (vuelve a activarse
// con el saldo que tenía antes del conteo).
export default function CamaraAjustesPendientes() {
  const { usuario } = useUsuario();

  const [cajas, setCajas] = useState<CajaCamara[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [procesandoId, setProcesandoId] = useState<number | null>(null);

  function cargar() {
    setCargando(true);
    api.camara
      .cajas({ estado: "ajuste_pendiente" })
      .then(setCajas)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  async function resolver(cajaId: number, accion: "falta" | "encontrada") {
    if (!usuario) return;
    setError(null);
    setProcesandoId(cajaId);
    try {
      const claveIdempotencia = crypto.randomUUID();
      const numero = String(cajaId).padStart(6, "0");
      const url =
        accion === "falta" ? `/api/camara/cajas/${cajaId}/confirmar-falta` : `/api/camara/cajas/${cajaId}/encontrada`;
      await ejecutarOEncolar<ResultadoAjusteCamara>(
        url,
        { usuarioId: usuario.id, claveIdempotencia },
        claveIdempotencia,
        `${accion === "falta" ? "Confirmar falta" : "Marcar encontrada"} — caja ${numero}`
      );
      // Se saca de la lista tanto si se mandó al servidor como si quedó
      // guardada esperando conexión — desde la perspectiva de la persona,
      // ya quedó resuelta acá.
      setCajas((prev) => prev.filter((c) => c.id !== cajaId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcesandoId(null);
    }
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Ajustes pendientes (cámara)</h1>
        <Link to="/camara">Volver a Cámara</Link>
      </div>
      <p className="ayuda">
        Cajas que estaban esperadas en un conteo por escaneo y no se encontraron. Búscalas físicamente: si
        realmente no están, confirma que faltan (queda registrado como merma de inventario); si aparecen, márcalas
        como encontradas para que vuelvan a estar disponibles en cámara.
      </p>
      {error && <p className="error">{error}</p>}
      <EstadoOffline />
      {cargando && <p>Cargando...</p>}

      <table className="tabla">
        <thead>
          <tr>
            <th>Caja</th>
            <th>Producto</th>
            <th>Familia</th>
            <th>Saldo esperado (kg)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cajas.map((c) => (
            <tr key={c.id} className="fila-error">
              <td>{String(c.id).padStart(6, "0")}</td>
              <td>{c.producto.descripcion}</td>
              <td>{c.familiaNombre}</td>
              <td>{c.saldoKg.toFixed(3)}</td>
              <td className="fila-inline">
                <button
                  type="button"
                  className="boton"
                  disabled={procesandoId === c.id}
                  onClick={() => resolver(c.id, "encontrada")}
                >
                  Se encontró
                </button>
                <button
                  type="button"
                  className="boton boton-peligro"
                  disabled={procesandoId === c.id}
                  onClick={() => resolver(c.id, "falta")}
                >
                  Confirmar que falta
                </button>
              </td>
            </tr>
          ))}
          {cajas.length === 0 && !cargando && (
            <tr>
              <td colSpan={5}>No hay cajas pendientes de ajuste.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
