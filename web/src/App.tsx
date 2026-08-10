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
import Inventario from "./pages/Inventario";
import RegistrarEntrada from "./pages/RegistrarEntrada";
import RegistrarSalida from "./pages/RegistrarSalida";
import MovimientosInventario from "./pages/MovimientosInventario";
import Proveedores from "./pages/Proveedores";
import Reportes from "./pages/Reportes";

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
            <Route path="/inventario" element={<Inventario />} />
            <Route path="/inventario/entrada" element={<RegistrarEntrada />} />
            <Route path="/inventario/salida" element={<RegistrarSalida />} />
            <Route path="/inventario/movimientos" element={<MovimientosInventario />} />
            <Route path="/proveedores" element={<Proveedores />} />
            <Route path="/reportes" element={<Reportes />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/productos" replace />} />
        <Route path="*" element={<Navigate to="/productos" replace />} />
      </Routes>
    </UsuarioProvider>
  );
}
