import { Navigate, Route, Routes } from "react-router-dom";
import { UsuarioProvider } from "./context/UsuarioContext";
import RequireUsuario from "./components/RequireUsuario";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Productos from "./pages/Productos";
import ProductoForm from "./pages/ProductoForm";
import CambioMasivo from "./pages/CambioMasivo";
import Historial from "./pages/Historial";
import Categorias from "./pages/Categorias";

export default function App() {
  return (
    <UsuarioProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireUsuario />}>
          <Route element={<Layout />}>
            <Route path="/productos" element={<Productos />} />
            <Route path="/productos/nuevo" element={<ProductoForm />} />
            <Route path="/productos/:id" element={<ProductoForm />} />
            <Route path="/cambio-masivo" element={<CambioMasivo />} />
            <Route path="/historial" element={<Historial />} />
            <Route path="/categorias" element={<Categorias />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/productos" replace />} />
        <Route path="*" element={<Navigate to="/productos" replace />} />
      </Routes>
    </UsuarioProvider>
  );
}
