import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AvisosCriticos } from "../api";
import ModalAlerta from "../components/ModalAlerta";

// Pantalla que junta, en un solo lugar, todo lo que el sistema considera
// "crítico" y avisa proactivamente (badge en el menú + notificación nativa
// de Windows, ver Layout.tsx y lib/avisos.ts) — para no depender de entrar
// a cada pantalla por separado a revisar si hay algo pendiente.
export default function Avisos() {
  const [avisos, setAvisos] = useState<AvisosCriticos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.avisos
      .obtener()
      .then(setAvisos)
      .catch((e) => setError(e.message));
  }, []);

  const hayAlgo =
    avisos &&
    (avisos.cajaSinCerrar ||
      avisos.stockBajo.cantidad > 0 ||
      avisos.cajasEstancadas.cantidad > 0 ||
      avisos.ajustesPendientesCamara.cantidad > 0);

  return (
    <div>
      <h1>Avisos</h1>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {!avisos && !error && <p>Cargando...</p>}

      {avisos && !hayAlgo && <p className="exito">✓ Todo al día — no hay avisos pendientes.</p>}

      {avisos?.cajaSinCerrar && (
        <section className="tarjeta aviso-estancadas">
          <h2>🧮 Caja sin cerrar</h2>
          <p>
            Hay una caja abierta desde el{" "}
            <strong>{new Date(avisos.cajaSinCerrar.fechaApertura).toLocaleDateString("es-CL")}</strong> (la abrió{" "}
            {avisos.cajaSinCerrar.usuario}) — el cierre X/Z de ese día todavía no se hizo.
          </p>
          <Link to="/caja" className="boton boton-primario">
            Ir a Caja
          </Link>
        </section>
      )}

      {avisos && avisos.stockBajo.cantidad > 0 && (
        <section className="tarjeta aviso-estancadas">
          <h2>📦 Stock bajo</h2>
          <p>
            <strong>{avisos.stockBajo.cantidad}</strong> producto{avisos.stockBajo.cantidad === 1 ? "" : "s"} con
            stock igual o menor a su umbral configurado.
          </p>
          <Link to="/inventario?bajo=true" className="boton boton-primario">
            Ver en Inventario
          </Link>
        </section>
      )}

      {avisos && avisos.cajasEstancadas.cantidad > 0 && (
        <section className="tarjeta aviso-estancadas">
          <h2>❄️ Cajas de cámara estancadas</h2>
          <p>
            <strong>{avisos.cajasEstancadas.cantidad}</strong> caja{avisos.cajasEstancadas.cantidad === 1 ? "" : "s"}{" "}
            sin ningún movimiento hace más de una semana.
          </p>
          <Link to="/camara/existencias" className="boton boton-primario">
            Ver en Existencias de Cámara
          </Link>
        </section>
      )}

      {avisos && avisos.ajustesPendientesCamara.cantidad > 0 && (
        <section className="tarjeta aviso-estancadas">
          <h2>⚠️ Ajustes pendientes de cámara</h2>
          <p>
            <strong>{avisos.ajustesPendientesCamara.cantidad}</strong> caja
            {avisos.ajustesPendientesCamara.cantidad === 1 ? " quedó pendiente" : "s quedaron pendientes"} de revisar
            tras un conteo por escaneo.
          </p>
          <Link to="/camara/ajustes-pendientes" className="boton boton-primario">
            Ir a Ajustes pendientes
          </Link>
        </section>
      )}
    </div>
  );
}
