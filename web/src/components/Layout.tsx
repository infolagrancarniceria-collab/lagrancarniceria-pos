import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useUsuario } from "../context/UsuarioContext";
import { modoCajaActivo } from "../lib/modoCaja";
import { modoCamaraActivo } from "../lib/modoCamara";
import { ToastHost } from "./ToastHost";

export default function Layout() {
  const { usuario, setUsuario } = useUsuario();
  const navigate = useNavigate();
  const modoCaja = modoCajaActivo();
  const modoCamara = modoCamaraActivo();

  function cambiarUsuario() {
    setUsuario(null);
    navigate("/login");
  }

  // App instalada desde el celular (ver modoCamara.ts) — pantalla angosta,
  // pensada para usarse de pie con el celular en la mano: sin la barra
  // lateral de todo el sistema, solo una tira arriba con el nombre y
  // "Cambiar usuario". El contenido (Salida de cámara) ocupa todo el resto.
  if (modoCamara) {
    return (
      <div className="layout-camara-app">
        <header className="topbar-camara-app">
          <span>❄️ La Gran Carnicería</span>
          <button type="button" onClick={cambiarUsuario} title="Cambiar usuario">
            ↩️
          </button>
        </header>
        <main className="contenido">
          <Outlet />
        </main>
        <ToastHost />
      </div>
    );
  }

  // Ítem de navegación con emoji + etiqueta separados en spans propios —
  // en "modo caja exclusiva" (.sidebar-compacta) el CSS esconde solo la
  // etiqueta, dejando una barra angosta de puros íconos (con el nombre
  // completo como title, para quien pase el mouse por encima).
  function Item({ to, emoji, etiqueta }: { to: string; emoji: string; etiqueta: string }) {
    return (
      <NavLink to={to} title={etiqueta}>
        <span className="nav-emoji">{emoji}</span>
        <span className="nav-etiqueta">{etiqueta}</span>
      </NavLink>
    );
  }

  return (
    <div className="layout">
      <header className={`sidebar${modoCaja ? " sidebar-compacta" : ""}`}>
        <div className="marca">{modoCaja ? "LGC" : "La Gran Carnicería"}</div>
        <nav>
          {modoCaja ? (
            <>
              <Item to="/caja" emoji="🧮" etiqueta="Caja" />
              <Item to="/caja/creditos" emoji="🤝" etiqueta="Créditos" />
              <Item to="/configuracion" emoji="⚙️" etiqueta="Configuración" />
            </>
          ) : (
            <>
              <Item to="/productos" emoji="🥩" etiqueta="Productos" />
              <Item to="/productos/margenes" emoji="🧩" etiqueta="Combos" />
              <Item to="/cambio-masivo" emoji="💲" etiqueta="Cambio masivo" />
              <Item to="/historial" emoji="🕘" etiqueta="Historial" />
              <Item to="/categorias" emoji="🗂️" etiqueta="Categorías" />
              <Item to="/inventario" emoji="📦" etiqueta="Inventario" />
              <Item to="/reportes" emoji="📊" etiqueta="Reportes" />
              <Item to="/gastos" emoji="🧾" etiqueta="Gastos" />
              <Item to="/caja" emoji="🧮" etiqueta="Caja" />
              <Item to="/caja/creditos" emoji="🤝" etiqueta="Créditos" />
              <Item to="/camara" emoji="❄️" etiqueta="Cámara" />
              <Item to="/asistente" emoji="🤖" etiqueta="Asistente" />
              <Item to="/balanza" emoji="⚖️" etiqueta="Balanza" />
              <Item to="/configuracion" emoji="⚙️" etiqueta="Configuración" />
            </>
          )}
        </nav>
        <div className="usuario-actual">
          <span className="nav-etiqueta" title={usuario?.nombre}>
            {usuario?.nombre}
          </span>
          <button type="button" onClick={cambiarUsuario} title="Cambiar usuario">
            <span className="nav-emoji-boton">↩️</span>
            <span className="nav-etiqueta">Cambiar usuario</span>
          </button>
        </div>
      </header>
      <main className="contenido">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}
