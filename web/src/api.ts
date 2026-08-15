export interface Usuario {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface Categoria {
  id: number;
  codigo: string;
  nombre: string;
  nivel: 1 | 2 | 3;
  padreId: number | null;
}

export type FlagBalanza = "NORMAL" | "PESABLE" | "IMPORTE";

export interface Producto {
  id: number;
  plu: string;
  descripcion: string;
  nombreCorto: string | null;
  marca: string | null;
  categoriaId: number;
  categoria: Categoria;
  precio: number;
  flagBalanza: FlagBalanza;
  codigoBarras: string | null;
  contenido: string | null;
  capacidadPorCaja: string | null;
  envase: string | null;
  impuestoAdicional: number | null;
  duracion: string | null;
  codigoProveedor: string | null;
  activo: boolean;
  stockActual: number;
  umbralStockBajo: number | null;
}

export interface FilaImportacionProductos {
  fila: number;
  plu: string;
  descripcion: string;
  precio: number | null;
  flagBalanza: string | null;
  categoriaCodigo: string | null;
  yaExiste: boolean;
  error: string | null;
}

export interface ProductoConStock extends Producto {
  bajoStock: boolean;
}

export interface ProductoConCosto extends Producto {
  ultimoCosto: number | null;
  ultimoCostoFecha: string | null;
}

// Margen (%) al estilo del sistema anterior (Gexus): markup sobre el costo,
// usando el precio de venta SIN IVA (el precio que carga el sistema incluye
// IVA). Confirmado reproduciendo un caso real: costo $11.190, precio venta
// $18.980 → 42,53% (mismo número que mostraba Gexus).
const IVA = 1.19;

export function calcularMargen(precioVenta: number, costo: number | null): number | null {
  if (!costo || costo <= 0) return null;
  const precioVentaNeto = precioVenta / IVA;
  return ((precioVentaNeto - costo) / costo) * 100;
}

export interface Comuna {
  id: number;
  nombre: string;
  costoEnvio: number;
  activo: boolean;
}

export interface ReporteDespachos {
  desde: string;
  hasta: string;
  cantidadDespachos: number;
  totalCostoEnvio: number;
  porComuna: { comuna: string; cantidadDespachos: number; totalCostoEnvio: number; totalVentas: number }[];
}

export interface Proveedor {
  id: number;
  nombre: string;
  contacto: string | null;
  activo: boolean;
}

export interface Gasto {
  id: number;
  fecha: string;
  categoria: string;
  descripcion: string | null;
  monto: number;
  usuarioId: number;
  usuario: Usuario;
}

export interface ReporteGastos {
  desde: string;
  hasta: string;
  total: number;
  totalPorCategoria: Record<string, number>;
}

export interface MovimientoInventario {
  id: number;
  productoId: number;
  producto: Producto;
  usuarioId: number;
  usuario: Usuario;
  tipo: "entrada" | "salida";
  motivo: string;
  cantidad: number;
  costoUnitario: number | null;
  proveedorId: number | null;
  proveedor: Proveedor | null;
  numeroFactura: string | null;
  fecha: string;
}

export interface ReporteInventario {
  desde: string;
  hasta: string;
  entradasTotal: number;
  salidasPorMotivo: Record<string, number>;
  topMerma: { productoId: number; plu: string; descripcion: string; cantidad: number }[];
}

export interface ReportePrecios {
  desde: string;
  hasta: string;
  totalCambios: number;
  porTipo: Record<string, number>;
  mayoresCambios: {
    productoId: number;
    plu: string;
    descripcion: string;
    precioAnterior: number;
    precioNuevo: number;
    variacionPorcentual: number;
    fecha: string;
  }[];
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  cantidadVentas: number;
  totalVentas: number;
  masVendidosPorCantidad: { productoId: number; plu: string; descripcion: string; cantidad: number; ingreso: number }[];
  masVendidosPorIngreso: { productoId: number; plu: string; descripcion: string; cantidad: number; ingreso: number }[];
}

export interface HistorialEntrada {
  id: number;
  productoId: number;
  producto: Producto;
  usuarioId: number;
  usuario: Usuario;
  precioAnterior: number;
  precioNuevo: number;
  tipoCambio: string;
  fecha: string;
}

export type MedioPago = "efectivo" | "tarjeta" | "credito";
export type MedioCobro = "efectivo" | "tarjeta";

export interface ItemVenta {
  id: number;
  ventaId: number;
  productoId: number;
  producto: Producto;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  anulado: boolean;
  usuarioAnulacionId: number | null;
  motivoAnulacion: string | null;
  fechaAnulacion: string | null;
}

export interface PagoVenta {
  id: number;
  ventaId: number;
  venta?: Venta;
  medio: MedioPago;
  monto: number;
  clienteNombre: string | null;
  cobrado: boolean;
  medioCobro: MedioCobro | null;
  sesionCajaCobroId: number | null;
  usuarioCobroId: number | null;
  fechaCobro: string | null;
}

export interface Venta {
  id: number;
  sesionCajaId: number;
  usuarioId: number;
  usuario?: Usuario;
  fecha: string;
  estado: "abierta" | "pagada" | "anulada";
  total: number;
  esDespacho: boolean;
  comunaId: number | null;
  comuna: Comuna | null;
  costoEnvio: number | null;
  descuentoTipo: "porcentaje" | "monto_fijo" | null;
  descuentoValor: number | null;
  items: ItemVenta[];
  pagos: PagoVenta[];
}

export interface SesionCaja {
  id: number;
  usuarioAperturaId: number;
  usuarioApertura?: Usuario;
  fondoFijoInicial: number;
  fechaApertura: string;
  estado: "abierta" | "cerrada";
  usuarioCierreId: number | null;
  usuarioCierre?: Usuario | null;
  efectivoContado: number | null;
  fechaCierre: string | null;
}

export interface ResumenSesion {
  sesion: SesionCaja;
  cantidadVentas: number;
  totalVentas: number;
  totalPorMedio: Record<string, number>;
  totalCobrosCredito: number;
  efectivoEsperado: number;
  diferencia: number | null;
}

export interface PropuestaAsistente {
  tipo: "propuesta";
  descripcion: string;
  accion: { tipo: string; datos: Record<string, unknown> };
  historial: unknown[];
}

export interface RespuestaTextoAsistente {
  tipo: "respuesta";
  texto: string;
  historial: unknown[];
}

export type RespuestaAsistente = PropuestaAsistente | RespuestaTextoAsistente;

export interface ConfiguracionBalanza {
  id: number;
  ip1: string;
  ip2: string;
  puerto: number;
  actualizadoEn: string;
}

export interface ResultadoEnvioBalanza {
  ip: string;
  exito: boolean;
  error?: string;
}

export interface ResultadoActualizarBalanza {
  cantidadProductos: number;
  resultados: ResultadoEnvioBalanza[];
}

class ApiError extends Error {}

async function manejarRespuesta<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let mensaje = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) mensaje = body.error;
    } catch {
      // sin cuerpo JSON, se usa el mensaje genérico
    }
    throw new ApiError(mensaje);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Si el servidor local queda trabado (ej. un archivo de bloqueo pegado tras
// un cierre inesperado), sin esto la pantalla se queda cargando para siempre
// sin avisar nada. Con el límite de tiempo, al menos se muestra un error
// claro en vez de un spinner infinito.
const TIEMPO_LIMITE_MS = 15000;

async function fetchConLimiteDeTiempo(
  url: string,
  init?: RequestInit,
  tiempoLimiteMs: number = TIEMPO_LIMITE_MS
): Promise<Response> {
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), tiempoLimiteMs);
  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new ApiError(
        "El programa no respondió a tiempo. Cierra el programa por completo (revisa que no quede ninguna copia abierta en el Administrador de tareas) y vuelve a abrirlo."
      );
    }
    throw e;
  } finally {
    clearTimeout(limite);
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetchConLimiteDeTiempo(url);
  return manejarRespuesta<T>(res);
}

async function post<T>(url: string, body: unknown, tiempoLimiteMs?: number): Promise<T> {
  const res = await fetchConLimiteDeTiempo(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    tiempoLimiteMs
  );
  return manejarRespuesta<T>(res);
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchConLimiteDeTiempo(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return manejarRespuesta<T>(res);
}

async function delConBody<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchConLimiteDeTiempo(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return manejarRespuesta<T>(res);
}

async function del<T>(url: string): Promise<T> {
  const res = await fetchConLimiteDeTiempo(url, { method: "DELETE" });
  return manejarRespuesta<T>(res);
}

export const api = {
  usuarios: {
    listar: () => get<Usuario[]>("/api/usuarios"),
    crear: (nombre: string) => post<Usuario>("/api/usuarios", { nombre }),
  },
  categorias: {
    listar: () => get<Categoria[]>("/api/categorias"),
    crear: (data: { codigo: string; nombre: string; nivel: 1 | 2 | 3; padreId: number | null }) =>
      post<Categoria>("/api/categorias", data),
  },
  productos: {
    listar: (params: { buscar?: string; categoriaId?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.buscar) qs.set("buscar", params.buscar);
      if (params.categoriaId) qs.set("categoriaId", String(params.categoriaId));
      const query = qs.toString();
      return get<Producto[]>(`/api/productos${query ? `?${query}` : ""}`);
    },
    obtener: (id: number) => get<ProductoConCosto>(`/api/productos/${id}`),
    crear: (data: Omit<Producto, "id" | "categoria" | "activo" | "stockActual">) =>
      post<Producto>("/api/productos", data),
    actualizar: (
      id: number,
      data: Omit<Producto, "id" | "categoria" | "activo" | "precio" | "stockActual">
    ) => put<Producto>(`/api/productos/${id}`, data),
    eliminar: (id: number) => del<void>(`/api/productos/${id}`),
    categorizarMasivo: (productoIds: number[], categoriaId: number) =>
      post<{ actualizados: number }>("/api/productos/categorizar-masivo", { productoIds, categoriaId }),
    eliminarMasivo: (productoIds: number[]) =>
      post<{ eliminados: number }>("/api/productos/eliminar-masivo", { productoIds }),
    importarCsv: async (archivo: File, confirmar: boolean) => {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("confirmar", String(confirmar));
      const res = await fetch("/api/productos/importar-csv", { method: "POST", body: form });
      return manejarRespuesta<{
        previsualizacion: boolean;
        creados?: number;
        filas: FilaImportacionProductos[];
      }>(res);
    },
  },
  precios: {
    cambiarIndividual: (data: { productoId: number; precioNuevo: number; usuarioId: number }) =>
      post<Producto>("/api/precios/individual", data),
    masivoCategoria: (data: {
      categoriaId: number;
      tipo: "porcentaje" | "monto_fijo";
      valor: number;
      usuarioId: number;
      confirmar: boolean;
    }) =>
      post<{
        previsualizacion: boolean;
        cambios: { productoId: number; plu: string; descripcion: string; precioActual: number; precioNuevo: number }[];
      }>("/api/precios/masivo-categoria", data),
    masivoCsv: async (archivo: File, usuarioId: number, confirmar: boolean) => {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("usuarioId", String(usuarioId));
      form.append("confirmar", String(confirmar));
      const res = await fetch("/api/precios/masivo-csv", { method: "POST", body: form });
      return manejarRespuesta<{
        previsualizacion: boolean;
        aplicados?: number;
        filas: {
          fila: number;
          plu: string;
          precioNuevo: number | null;
          productoId: number | null;
          descripcion: string | null;
          precioActual: number | null;
          error: string | null;
        }[];
      }>(res);
    },
  },
  historial: {
    listar: (productoId?: number) =>
      get<HistorialEntrada[]>(`/api/historial${productoId ? `?productoId=${productoId}` : ""}`),
  },
  proveedores: {
    listar: () => get<Proveedor[]>("/api/proveedores"),
    crear: (data: { nombre: string; contacto?: string | null }) =>
      post<Proveedor>("/api/proveedores", data),
  },
  comunas: {
    listar: () => get<Comuna[]>("/api/comunas"),
    crear: (data: { nombre: string; costoEnvio: number }) => post<Comuna>("/api/comunas", data),
    actualizar: (id: number, data: { nombre: string; costoEnvio: number }) =>
      put<Comuna>(`/api/comunas/${id}`, data),
    eliminar: (id: number) => del<void>(`/api/comunas/${id}`),
  },
  inventario: {
    stock: (soloBajo = false, categoriaId?: number) => {
      const qs = new URLSearchParams();
      if (soloBajo) qs.set("bajo", "true");
      if (categoriaId) qs.set("categoriaId", String(categoriaId));
      const query = qs.toString();
      return get<ProductoConStock[]>(`/api/inventario/stock${query ? `?${query}` : ""}`);
    },
    entrada: (data: {
      productoId: number;
      cantidad: number;
      motivo: "compra" | "ajuste";
      proveedorId?: number | null;
      costoUnitario?: number | null;
      numeroFactura?: string | null;
      usuarioId: number;
    }) => post<Producto>("/api/inventario/entrada", data),
    salida: (data: {
      productoId: number;
      cantidad: number;
      motivo: "venta" | "descarte" | "ajuste";
      usuarioId: number;
    }) => post<Producto>("/api/inventario/salida", data),
    movimientos: (params: { productoId?: number; tipo?: "entrada" | "salida"; numeroFactura?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.productoId) qs.set("productoId", String(params.productoId));
      if (params.tipo) qs.set("tipo", params.tipo);
      if (params.numeroFactura) qs.set("numeroFactura", params.numeroFactura);
      const query = qs.toString();
      return get<MovimientoInventario[]>(`/api/inventario/movimientos${query ? `?${query}` : ""}`);
    },
  },
  reportes: {
    inventario: (desde?: string, hasta?: string) => {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      return get<ReporteInventario>(`/api/reportes/inventario${query ? `?${query}` : ""}`);
    },
    precios: (desde?: string, hasta?: string) => {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      return get<ReportePrecios>(`/api/reportes/precios${query ? `?${query}` : ""}`);
    },
    ventas: (desde?: string, hasta?: string) => {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      return get<ReporteVentas>(`/api/reportes/ventas${query ? `?${query}` : ""}`);
    },
    despachos: (desde?: string, hasta?: string) => {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      return get<ReporteDespachos>(`/api/reportes/despachos${query ? `?${query}` : ""}`);
    },
  },
  caja: {
    estadoClave: () => get<{ configurada: boolean }>("/api/caja/clave-supervisor/estado"),
    configurarClave: (data: { claveActual?: string; claveNueva: string }) =>
      post<void>("/api/caja/clave-supervisor", data),
    verificarClave: (clave: string) =>
      post<{ valida: boolean }>("/api/caja/clave-supervisor/verificar", { clave }),
    sesionActual: () => get<SesionCaja | null>("/api/caja/sesiones/actual"),
    sesiones: () => get<SesionCaja[]>("/api/caja/sesiones"),
    abrirSesion: (data: { fondoFijoInicial: number; usuarioId: number }) =>
      post<SesionCaja>("/api/caja/sesiones", data),
    resumenSesion: (id: number) => get<ResumenSesion>(`/api/caja/sesiones/${id}/resumen`),
    cerrarSesion: (id: number, data: { efectivoContado: number; usuarioId: number }) =>
      post<ResumenSesion>(`/api/caja/sesiones/${id}/cerrar`, data),
    ventaAbierta: () => get<Venta | null>("/api/caja/ventas/abierta"),
    obtenerVenta: (id: number) => get<Venta>(`/api/caja/ventas/${id}`),
    buscarVentas: (params: { desde?: string; hasta?: string; ventaId?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      if (params.ventaId) qs.set("ventaId", String(params.ventaId));
      const query = qs.toString();
      return get<Venta[]>(`/api/caja/ventas${query ? `?${query}` : ""}`);
    },
    crearVenta: (usuarioId: number) => post<Venta>("/api/caja/ventas", { usuarioId }),
    agregarItem: (ventaId: number, data: { productoId: number; cantidad: number }) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/items`, data),
    escanearCodigo: (ventaId: number, codigo: string) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/items/escanear`, { codigo }),
    anularItem: (
      ventaId: number,
      itemId: number,
      data: { clave?: string; usuarioId: number; motivo?: string }
    ) => delConBody<Venta>(`/api/caja/ventas/${ventaId}/items/${itemId}`, data),
    agregarPago: (ventaId: number, data: { medio: MedioPago; monto: number; clienteNombre?: string }) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/pagos`, data),
    quitarPago: (ventaId: number, pagoId: number) =>
      del<Venta>(`/api/caja/ventas/${ventaId}/pagos/${pagoId}`),
    confirmarVenta: (ventaId: number, usuarioId: number) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/confirmar`, { usuarioId }),
    cancelarVenta: (ventaId: number) => post<Venta>(`/api/caja/ventas/${ventaId}/cancelar`, {}),
    creditosPendientes: () => get<PagoVenta[]>("/api/caja/creditos-pendientes"),
    cobrarCredito: (pagoId: number, data: { medioCobro: MedioCobro; usuarioId: number }) =>
      post<PagoVenta>(`/api/caja/creditos/${pagoId}/cobrar`, data),
    actualizarDespacho: (ventaId: number, data: { esDespacho: boolean; comunaId?: number | null }) =>
      put<Venta>(`/api/caja/ventas/${ventaId}/despacho`, data),
    actualizarDescuento: (ventaId: number, data: { tipo: "porcentaje" | "monto_fijo" | null; valor: number | null }) =>
      put<Venta>(`/api/caja/ventas/${ventaId}/descuento`, data),
  },
  configuracion: {
    estadoIA: () => get<{ configurada: boolean }>("/api/configuracion/ia/estado"),
    guardarClaveIA: (claveApiAnthropic: string) =>
      post<void>("/api/configuracion/ia", { claveApiAnthropic }),
  },
  asistente: {
    enviarMensaje: (mensaje: string, historial: unknown[]) =>
      post<RespuestaAsistente>("/api/asistente/mensaje", { mensaje, historial }, 60000),
  },
  balanza: {
    configuracion: () => get<ConfiguracionBalanza>("/api/balanza/configuracion"),
    guardarConfiguracion: (data: { ip1: string; ip2: string; puerto: number }) =>
      post<ConfiguracionBalanza>("/api/balanza/configuracion", data),
    actualizar: () => post<ResultadoActualizarBalanza>("/api/balanza/actualizar", {}),
  },
  gastos: {
    listar: (params: { desde?: string; hasta?: string; categoria?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      if (params.categoria) qs.set("categoria", params.categoria);
      const query = qs.toString();
      return get<Gasto[]>(`/api/gastos${query ? `?${query}` : ""}`);
    },
    reporte: (desde?: string, hasta?: string) => {
      const qs = new URLSearchParams();
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      const query = qs.toString();
      return get<ReporteGastos>(`/api/gastos/reporte${query ? `?${query}` : ""}`);
    },
    crear: (data: { fecha?: string; categoria: string; descripcion?: string | null; monto: number; usuarioId: number }) =>
      post<Gasto>("/api/gastos", data),
    eliminar: (id: number) => del<void>(`/api/gastos/${id}`),
  },
};

export function formatoCLP(valor: number): string {
  return valor.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
}
