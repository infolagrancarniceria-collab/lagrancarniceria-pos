import { Navigate, Route, Routes } from "react-router-dom";
import { UsuarioProvider } from "./context/UsuarioContext";
import { modoCajaActivo } from "./lib/modoCaja";
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
import CargarFactura from "./pages/CargarFactura";
import Facturas from "./pages/Facturas";
import Proveedores from "./pages/Proveedores";
import Reportes from "./pages/Reportes";
import Caja from "./pages/Caja";
import ConfigurarClaveSupervisor from "./pages/ConfigurarClaveSupervisor";
import AbrirCaja from "./pages/AbrirCaja";
import PuntoDeVenta from "./pages/PuntoDeVenta";
import CerrarCaja from "./pages/CerrarCaja";
import SesionesCaja from "./pages/SesionesCaja";
import CreditosPendientes from "./pages/CreditosPendientes";
import BuscarVenta from "./pages/BuscarVenta";
import Anulaciones from "./pages/Anulaciones";
import Revisiones from "./pages/Revisiones";
import Gastos from "./pages/Gastos";
import Comunas from "./pages/Comunas";
import Configuracion from "./pages/Configuracion";
import Asistente from "./pages/Asistente";
import Balanza from "./pages/Balanza";
import Camara from "./pages/Camara";
import CamaraEntrada from "./pages/CamaraEntrada";
import CamaraSalida from "./pages/CamaraSalida";
import Mayoristas from "./pages/Mayoristas";
import CamaraInventario from "./pages/CamaraInventario";
import CamaraAjustesPendientes from "./pages/CamaraAjustesPendientes";
import CamaraImportar from "./pages/CamaraImportar";
import CamaraEntradas from "./pages/CamaraEntradas";
import CamaraExistencias from "./pages/CamaraExistencias";
import CamaraReporteSalidas from "./pages/CamaraReporteSalidas";

export default function App() {
  // En "modo caja exclusiva" (ver web/src/lib/modoCaja.ts), este PC arranca
  // directo en Caja en vez de Productos.
  const inicio = modoCajaActivo() ? "/caja" : "/productos";

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
            <Route path="/inventario/factura" element={<CargarFactura />} />
            <Route path="/inventario/facturas" element={<Facturas />} />
            <Route path="/inventario/revisiones" element={<Revisiones />} />
            <Route path="/proveedores" element={<Proveedores />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/caja" element={<Caja />} />
            <Route path="/caja/configurar-clave" element={<ConfigurarClaveSupervisor />} />
            <Route path="/caja/abrir" element={<AbrirCaja />} />
            <Route path="/caja/venta" element={<PuntoDeVenta />} />
            <Route path="/caja/cerrar" element={<CerrarCaja />} />
            <Route path="/caja/sesiones" element={<SesionesCaja />} />
            <Route path="/caja/creditos" element={<CreditosPendientes />} />
            <Route path="/caja/buscar" element={<BuscarVenta />} />
            <Route path="/caja/anulaciones" element={<Anulaciones />} />
            <Route path="/gastos" element={<Gastos />} />
            <Route path="/comunas" element={<Comunas />} />
            <Route path="/asistente" element={<Asistente />} />
            <Route path="/balanza" element={<Balanza />} />
            <Route path="/camara" element={<Camara />} />
            <Route path="/camara/entrada" element={<CamaraEntrada />} />
            <Route path="/camara/salida" element={<CamaraSalida />} />
            <Route path="/camara/mayoristas" element={<Mayoristas />} />
            <Route path="/camara/inventario" element={<CamaraInventario />} />
            <Route path="/camara/ajustes-pendientes" element={<CamaraAjustesPendientes />} />
            <Route path="/camara/importar" element={<CamaraImportar />} />
            <Route path="/camara/entradas" element={<CamaraEntradas />} />
            <Route path="/camara/existencias" element={<CamaraExistencias />} />
            <Route path="/camara/reporte-salidas" element={<CamaraReporteSalidas />} />
            <Route path="/configuracion" element={<Configuracion />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to={inicio} replace />} />
        <Route path="*" element={<Navigate to={inicio} replace />} />
      </Routes>
    </UsuarioProvider>
  );
}
