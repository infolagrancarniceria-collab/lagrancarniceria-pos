import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useUsuario } from "../context/UsuarioContext";

export default function Layout() {
  const { usuario, setUsuario } = useUsuario();
  const navigate = useNavigate();

  function cambiarUsuario() {
    setUsuario(null);
    navigate("/login");
  }

  return (
    <div className="layout">
      <header className="topbar">
        <div className="marca">La Gran Carnicería</div>
        <nav>
          <NavLink to="/productos">Productos</NavLink>
          <NavLink to="/cambio-masivo">Cambio masivo</NavLink>
          <NavLink to="/historial">Historial</NavLink>
          <NavLink to="/categorias">Categorías</NavLink>
          <NavLink to="/inventario">Inventario</NavLink>
          <NavLink to="/reportes">Reportes</NavLink>
          <NavLink to="/caja">Caja</NavLink>
          <NavLink to="/caja/creditos">Créditos</NavLink>
          <NavLink to="/asistente">Asistente</NavLink>
          <NavLink to="/balanza">Balanza</NavLink>
          <NavLink to="/configuracion">Configuración</NavLink>
        </nav>
        <div className="usuario-actual">
          <span>{usuario?.nombre}</span>
          <button type="button" onClick={cambiarUsuario}>
            Cambiar usuario
          </button>
        </div>
      </header>
      <main className="contenido">
        <Outlet />
      </main>
    </div>
  );
}
