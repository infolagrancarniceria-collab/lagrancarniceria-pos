import { Navigate, Outlet } from "react-router-dom";
import { useUsuario } from "../context/UsuarioContext";

export default function RequireUsuario() {
  const { usuario } = useUsuario();
  if (!usuario) return <Navigate to="/login" replace />;
  return <Outlet />;
}
