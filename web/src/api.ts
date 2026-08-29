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
  precioMayor: number | null;
  // Costo ingresado a mano, solo usado como respaldo cuando no hay ninguna
  // compra real registrada — ver costoEfectivo en ProductoConCosto.
  costoReferencia: number | null;
  flagBalanza: FlagBalanza;
  codigoBarras: string | null;
  contenido: string | null;
  capacidadPorCaja: string | null;
  envase: string | null;
  impuestoAdicional: number | null;
  duracion: string | null;
  codigoProveedor: string | null;
  aplicaIvaCarne: boolean;
  activo: boolean;
  stockActual: number;
  umbralStockBajo: number | null;
  // --- Página web ---
  visibleEnWeb: boolean;
  disponibilidadWeb: "disponible" | "agotado" | "proximamente";
  featured: boolean;
  lowStock: boolean;
  promoPrecioUnitario: number | null;
  promoGramosMinimos: number | null;
  promoEtiqueta: string | null;
  descripcionCorta: string | null;
  familiaCorte: string | null;
}

export interface CorteOpcion {
  id: number;
  familia: string;
  nombre: string;
  orden: number;
}

export interface PedidoWebItem {
  plu: string;
  descripcion: string;
  corte: string | null;
  envasado: "Tradicional" | "Al vacío" | null;
  instrucciones: string | null;
  cantidad: number;
  unidad: "kg" | "unidad";
  // CLP/kg (cantidad en gramos) o CLP/unidad — mismo criterio que el
  // carrito de la web. Pedidos de antes de este cambio no lo traen: queda
  // undefined, y la pantalla que lo muestra debe manejar ese caso (no hay
  // forma de saber el precio de un pedido viejo con certeza).
  precioUnitario?: number;
}

export interface PedidoWebRegalo {
  id: number;
  pedidoWebId: number;
  productoId: number;
  producto: Producto;
  cantidad: number;
  agregadoPorId: number;
  agregadoPor: Usuario;
  agregadoEn: string;
}

export interface PedidoWeb {
  id: number;
  idWeb: string;
  fecha: string;
  clienteNombre: string;
  clienteTelefono: string;
  tipoEntrega: "retiro" | "despacho";
  clienteDireccion: string | null;
  comunaNombre: string | null;
  costoEnvio: number | null;
  fechaEntrega: string | null;
  medioPago: string | null;
  items: PedidoWebItem[];
  comentario: string | null;
  estado: "pendiente" | "atendido" | "anulado";
  atendidoPorId: number | null;
  atendidoEn: string | null;
  motivoAnulacion: string | null;
  anuladoPorId: number | null;
  anuladoEn: string | null;
  descuentoTipo: "porcentaje" | "monto" | null;
  descuentoValor: number | null;
  descuentoMotivo: string | null;
  regalos: PedidoWebRegalo[];
  // Id de la venta creada en Caja al enviar este pedido ("Enviar a Caja"),
  // o null si todavía no se ha enviado — ver Venta.origenPedidoWebId.
  ventaGeneradaId: number | null;
  sincronizadoEn: string;
}

export type FamiliaCamara = "Vacuno" | "Cerdo" | "Pollo" | "Otros";
export const FAMILIAS_CAMARA: FamiliaCamara[] = ["Vacuno", "Cerdo", "Pollo", "Otros"];

// Solo aplica (y es obligatorio) para familia "Vacuno".
export type ProcedenciaCamara = "Nacional" | "Brasil" | "Paraguay";
export const PROCEDENCIAS_VACUNO: ProcedenciaCamara[] = ["Nacional", "Brasil", "Paraguay"];

export interface CajaCamara {
  id: number;
  productoId: number;
  producto: Producto;
  loteId: number | null;
  lote?: LoteCamara | null;
  familiaNombre: string;
  procedencia: string | null;
  fechaIngreso: string;
  // Solo viene en la respuesta de "Revisar entradas" (GET /api/camara/cajas)
  // — cuándo salió por completo esta caja, si su estado actual es "salida".
  fechaSalida?: string | null;
  pesoInicialKg: number;
  saldoKg: number;
  costoNetoKg: number;
  estado: "en_camara" | "parcial" | "salida" | "ajuste_pendiente" | "anulada";
  pesoEstimado: boolean;
  creadoPorId: number;
  creadoPor: Usuario;
  version: number;
  creadoEn: string;
  actualizadoEn: string;
}

// Agrupa las cajas que se ingresaron juntas en una misma entrada — permite
// corregir, reimprimir o anular todas sus cajas de una vez.
export interface CorreccionLoteCamara {
  id: number;
  familiaAnterior: string;
  procedenciaAnterior: string | null;
  productoAnterior: string;
  pesoTotalAnteriorKg: number;
  costoAnteriorKg: number;
  familiaNueva: string;
  procedenciaNueva: string | null;
  productoNuevo: string;
  pesoTotalNuevoKg: number;
  costoNuevoKg: number;
  usuario: Usuario;
  creadoEn: string;
}

export interface LoteCamara {
  id: number;
  productoId: number;
  producto: Producto;
  familiaNombre: string;
  procedencia: string | null;
  cantidadCajas: number;
  pesoTotalKg: number;
  costoNetoKg: number;
  totalNeto: number;
  fechaIngreso: string;
  creadoPorId: number;
  creadoPor: Usuario;
  proveedorId: number | null;
  proveedor: Proveedor | null;
  numeroFactura: string | null;
  reconstruido: boolean;
  numerosCajas: string;
  bloqueado: boolean;
  cajas?: CajaCamara[];
  correcciones?: CorreccionLoteCamara[];
}

export interface ExistenciasCamara {
  totalCajas: number;
  totalKilos: number;
  totalValor: number;
  totalValorVenta: number;
  porProducto: {
    familia: string;
    producto: string;
    productoId: number;
    cajas: number;
    kilos: number;
    valorCosto: number;
    valorVenta: number;
    ultimosCostos: number[];
    bajoStock: boolean;
  }[];
  cajasEstancadas: {
    cajaId: number;
    numero: string;
    producto: string;
    familia: string;
    fechaIngreso: string;
    diasEnCamara: number;
  }[];
}

export interface ReporteSalidasCamara {
  desde: string;
  hasta: string;
  totalKilos: number;
  cajasDistintas: number;
  totalValor: number;
  porDestino: { destino: string; etiqueta: string; cajasDistintas: number; kilos: number; valor: number }[];
  ultimosMovimientos: {
    id: number;
    fecha: string;
    numero: string;
    producto: string;
    destino: string | null;
    etiquetaDestino: string;
    kilos: number;
  }[];
}

export type DestinoSalidaCamara = "sala_venta" | "produccion" | "merma" | "donacion" | "mayorista" | "otro";

export interface MovimientoCamara {
  id: number;
  cajaId: number;
  tipo: string;
  pesoKg: number;
  origen: string | null;
  destino: string | null;
  motivo: string | null;
  usuarioId: number;
  dispositivo: string | null;
  creadoEn: string;
}

export interface SalidaMayorista {
  id: number;
  fecha: string;
  productoId: number;
  producto: Producto;
  cantidadKg: number;
  precioTotal: number;
  estadoPago: "pagado" | "pendiente";
  clienteNombre: string | null;
  cajaCamaraId: number | null;
  cajaCamara: { costoNetoKg: number } | null;
  usuarioId: number;
  usuario: Usuario;
  observaciones: string | null;
  anulada: boolean;
  usuarioAnulacionId: number | null;
  usuarioAnulacion: Usuario | null;
  motivoAnulacion: string | null;
  fechaAnulacion: string | null;
}

export interface AvisoFifoCamara {
  hayMasAntigua: boolean;
  cajaMasAntigua: { id: number; numero: string; fechaIngreso: string } | null;
}

export interface ResultadoSalidaCamara {
  caja: CajaCamara;
  movimiento: MovimientoCamara;
  salidaMayorista: SalidaMayorista | null;
}

export interface SesionInventarioCamara {
  id: number;
  fechaInicio: string;
  fechaFin: string | null;
  iniciadoPorId: number;
  iniciadoPor: Usuario;
  finalizadoPorId: number | null;
  finalizadoPor: Usuario | null;
  estado: "abierta" | "finalizada" | "conciliada";
  observaciones: string | null;
  totalEsperadas?: number;
}

export interface EscaneoInventarioCamara {
  id: number;
  sesionId: number;
  cajaId: number;
  caja: CajaCamara;
  escaneadoEn: string;
  escaneadoPorId: number;
  escaneadoPor: Usuario;
  dispositivo: string | null;
  estadoAlEscanear: string;
  saldoAlEscanearKg: number;
}

export interface InventarioCamaraEsperado {
  id: number;
  sesionId: number;
  cajaId: number;
  caja: CajaCamara;
  saldoEsperadoKg: number;
  estadoEsperado: string;
}

export interface DetalleSesionInventarioCamara {
  sesion: SesionInventarioCamara;
  esperados: InventarioCamaraEsperado[];
  escaneos: EscaneoInventarioCamara[];
}

export interface ResultadoEscaneoInventarioCamara {
  escaneo: EscaneoInventarioCamara;
  caja: CajaCamara;
  esperada: boolean;
  yaEscaneada: boolean;
}

export interface ResultadoCierreSesionCamara {
  totalEsperadas: number;
  totalEscaneadas: number;
  faltantes: CajaCamara[];
  noEsperadas: CajaCamara[];
}

export interface ResultadoAjusteCamara {
  caja: CajaCamara;
  movimiento: MovimientoCamara;
}

export interface GrupoImportacionCamara {
  clave: string;
  familia: string;
  producto: string;
  cantidadCajas: number;
  productoIdSugerido: number | null;
  productoSugerido: string | null;
}

export interface PrevisualizacionImportacionCamara {
  totalCajas: number;
  cajasConConflicto: number[];
  grupos: GrupoImportacionCamara[];
}

export interface ResultadoImportacionCamara {
  importadas: number;
  omitidasPorConflicto: number[];
  omitidasPorProducto: number[];
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

export interface FilaImportacionCosto {
  fila: number;
  plu: string;
  costo: number | null;
  productoId: number | null;
  descripcion: string | null;
  error: string | null;
}

export interface ProductoConStock extends Producto {
  bajoStock: boolean;
}

// costoEfectivo: el costo real de la última compra si existe; si no, cae al
// costoReferencia ingresado a mano (ver Producto.costoReferencia) — es lo
// que hay que usar para calcular margen. costoEsEstimado avisa cuándo ese
// valor viene del costo a mano en vez de una compra real.
export interface ProductoConCosto extends Producto {
  ultimoCosto: number | null;
  ultimoCostoFecha: string | null;
  penultimoCosto: number | null;
  penultimoCostoFecha: string | null;
  ultimoCostoCamaraKg: number | null;
  ultimoCostoCamaraFecha: string | null;
  costoEfectivo: number | null;
  costoEsEstimado: boolean;
}

export interface ProductoConUltimoCosto extends Producto {
  ultimoCosto: number | null;
  costoEfectivo: number | null;
  costoEsEstimado: boolean;
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

// "Margen real" (guía de rentabilidad, Control de Precios) — misma resta
// que calcularMargen (venta neta − costo), pero dividida sobre la VENTA
// neta en vez del costo: el recargo (calcularMargen) dice cuánto se le
// sumó al costo para llegar al precio; el margen real dice qué porción del
// precio de venta neto es utilidad. Son dos lentes del mismo número, no
// dos cálculos independientes.
export function calcularMargenReal(precioVenta: number, costo: number | null): number | null {
  if (!costo || costo <= 0) return null;
  const precioVentaNeto = precioVenta / IVA;
  if (precioVentaNeto <= 0) return null;
  return ((precioVentaNeto - costo) / precioVentaNeto) * 100;
}

// Redondeo de pagos en efectivo a la decena más cercana (Ley N° 21.131,
// "Ley del Redondeo") — desde que se retiraron de circulación las monedas
// de $1 y $5, el monto a cobrar/entregar en efectivo se redondea a
// múltiplos de $10. Solo aplica a efectivo: tarjeta y crédito se cobran
// siempre al peso exacto.
export const TOLERANCIA_REDONDEO_EFECTIVO = 5;

export function redondearA10(monto: number): number {
  return Math.round(monto / 10) * 10;
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

export interface LineaFactura {
  producto: string;
  plu: string;
  cantidad: number;
  costoUnitario: number | null;
  subtotal: number;
}

export interface FacturaAgrupada {
  proveedorId: number;
  proveedor: string;
  numeroFactura: string;
  fecha: string;
  usuario: string;
  totalNeto: number;
  lineas: LineaFactura[];
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
  cantidadVentasOnline: number;
  totalVentasOnline: number;
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
  motivoAutorizacion: string | null;
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
  descuentoTipo: "porcentaje" | "monto_fijo" | null;
  descuentoValor: number | null;
  anulado: boolean;
  usuarioAnulacionId: number | null;
  usuarioAnulacion: Usuario | null;
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
  comentario: string | null;
  esDespacho: boolean;
  comunaId: number | null;
  comuna: Comuna | null;
  costoEnvio: number | null;
  descuentoTipo: "porcentaje" | "monto_fijo" | null;
  descuentoValor: number | null;
  usuarioAnulacionId: number | null;
  usuarioAnulacion?: Usuario | null;
  motivoAnulacion: string | null;
  fechaAnulacion: string | null;
  origenPedidoWebId: number | null;
  items: ItemVenta[];
  pagos: PagoVenta[];
}

export interface ItemVentaAnulado extends ItemVenta {
  venta: { id: number; fecha: string };
}

export interface ReporteAnulaciones {
  items: ItemVentaAnulado[];
  ventas: Venta[];
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
  fondoFijoSugerido: number | null;
  motivoAjusteFondo: string | null;
  usuarioAutorizoFondoId: number | null;
  usuarioAutorizoFondo?: Usuario | null;
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
  toolUseId: string;
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

interface EstadoDestinoRespaldo {
  ultimoEn: string | null;
  ok: boolean | null;
  error: string | null;
}

export interface EstadoRespaldo {
  rutaUsb: string | null;
  local: EstadoDestinoRespaldo;
  usb: EstadoDestinoRespaldo;
}

export interface ResultadoRespaldo {
  local: { ok: boolean; error?: string };
  usb: { ok: boolean; error?: string; omitido?: boolean } | null;
}

export interface AvisosCriticos {
  cajaSinCerrar: { sesionId: number; fechaApertura: string; usuario: string } | null;
  stockBajo: { cantidad: number };
  cajasEstancadas: { cantidad: number };
  ajustesPendientesCamara: { cantidad: number };
  pedidosWebPendientes: { cantidad: number };
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
    listar: (
      params: { buscar?: string; categoriaId?: number; stockNegativo?: boolean; incluirInactivos?: boolean } = {}
    ) => {
      const qs = new URLSearchParams();
      if (params.buscar) qs.set("buscar", params.buscar);
      if (params.categoriaId) qs.set("categoriaId", String(params.categoriaId));
      if (params.stockNegativo) qs.set("stockNegativo", "true");
      if (params.incluirInactivos) qs.set("incluirInactivos", "true");
      const query = qs.toString();
      return get<Producto[]>(`/api/productos${query ? `?${query}` : ""}`);
    },
    obtener: (id: number) => get<ProductoConCosto>(`/api/productos/${id}`),
    proximoPlu: () => get<{ plu: string }>("/api/productos/proximo-plu"),
    reactivar: (id: number) => post<Producto>(`/api/productos/${id}/reactivar`, {}),
    cambiarPrecioMayor: (id: number, precioMayor: number) =>
      put<Producto>(`/api/productos/${id}/precio-mayor`, { precioMayor }),
    listarConCosto: (params: { buscar?: string; categoriaId?: number; incluirInactivos?: boolean } = {}) => {
      const qs = new URLSearchParams();
      if (params.buscar) qs.set("buscar", params.buscar);
      if (params.categoriaId) qs.set("categoriaId", String(params.categoriaId));
      if (params.incluirInactivos) qs.set("incluirInactivos", "true");
      qs.set("incluirCosto", "true");
      return get<ProductoConUltimoCosto[]>(`/api/productos?${qs.toString()}`);
    },
    margenes: (params: { categoriaId?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.categoriaId) qs.set("categoriaId", String(params.categoriaId));
      const query = qs.toString();
      return get<ProductoConCosto[]>(`/api/productos/margenes${query ? `?${query}` : ""}`);
    },
    crear: (
      data: Omit<
        Producto,
        "id" | "categoria" | "activo" | "stockActual" | "visibleEnWeb" | "disponibilidadWeb" | "featured" | "lowStock"
      >
    ) => post<Producto>("/api/productos", data),
    actualizar: (
      id: number,
      data: Omit<
        Producto,
        | "id"
        | "categoria"
        | "activo"
        | "precio"
        | "stockActual"
        | "visibleEnWeb"
        | "disponibilidadWeb"
        | "featured"
        | "lowStock"
      >
    ) => put<Producto>(`/api/productos/${id}`, data),
    eliminar: (id: number) => del<void>(`/api/productos/${id}`),
    actualizarVisibilidadWeb: (
      id: number,
      data: {
        visibleEnWeb?: boolean;
        disponibilidadWeb?: "disponible" | "agotado" | "proximamente";
        featured?: boolean;
        lowStock?: boolean;
      }
    ) => put<Producto>(`/api/productos/${id}/web`, data),
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
    // Actualiza el costo de referencia de productos que YA existen (a
    // diferencia de importarCsv, que solo crea productos nuevos) — para
    // cargar de una vez los costos del sistema anterior.
    importarCostosCsv: async (archivo: File, confirmar: boolean) => {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("confirmar", String(confirmar));
      const res = await fetch("/api/productos/importar-costos-csv", { method: "POST", body: form });
      return manejarRespuesta<{
        previsualizacion: boolean;
        actualizados?: number;
        filas: FilaImportacionCosto[];
      }>(res);
    },
  },
  precios: {
    cambiarIndividual: (data: {
      productoId: number;
      precioNuevo: number;
      usuarioId: number;
      clave?: string;
      motivoAutorizacion?: string;
    }) => post<Producto>("/api/precios/individual", data),
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
  cortes: {
    listar: () => get<CorteOpcion[]>("/api/cortes"),
    crear: (data: { familia: string; nombre: string; orden?: number }) =>
      post<CorteOpcion>("/api/cortes", data),
    actualizar: (id: number, data: { familia: string; nombre: string; orden?: number }) =>
      put<CorteOpcion>(`/api/cortes/${id}`, data),
    eliminar: (id: number) => del<void>(`/api/cortes/${id}`),
  },
  pedidosWeb: {
    listar: (estado?: "pendiente" | "atendido" | "anulado") =>
      get<PedidoWeb[]>(`/api/pedidos-web${estado ? `?estado=${estado}` : ""}`),
    marcarAtendido: (id: number, usuarioId: number) =>
      put<PedidoWeb>(`/api/pedidos-web/${id}/atender`, { usuarioId }),
    anular: (id: number, usuarioId: number, clave: string, motivo: string) =>
      put<PedidoWeb>(`/api/pedidos-web/${id}/anular`, { usuarioId, clave, motivo }),
    aplicarDescuento: (
      id: number,
      usuarioId: number,
      descuento: { descuentoTipo: "porcentaje" | "monto"; descuentoValor: number; descuentoMotivo: string | null } | null
    ) =>
      put<PedidoWeb>(`/api/pedidos-web/${id}/descuento`, {
        usuarioId,
        descuentoTipo: descuento?.descuentoTipo ?? null,
        descuentoValor: descuento?.descuentoValor ?? null,
        descuentoMotivo: descuento?.descuentoMotivo ?? null,
      }),
    agregarRegalo: (id: number, usuarioId: number, productoId: number, cantidad: number) =>
      post<PedidoWeb>(`/api/pedidos-web/${id}/regalos`, { usuarioId, productoId, cantidad }),
    quitarRegalo: (id: number, regaloId: number, usuarioId: number) =>
      delConBody<PedidoWeb>(`/api/pedidos-web/${id}/regalos/${regaloId}`, { usuarioId }),
    enviarACaja: (id: number, usuarioId: number) =>
      post<{ pedido: PedidoWeb; ventaId: number }>(`/api/pedidos-web/${id}/enviar-a-caja`, { usuarioId }),
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
    entradaFactura: (data: {
      proveedorId: number;
      numeroFactura: string;
      fecha?: string;
      usuarioId: number;
      lineas: { productoId: number; cantidad: number; costoUnitario: number }[];
    }) => post<{ movimientos: MovimientoInventario[] }>("/api/inventario/entrada-factura", data),
    facturas: (params: { desde?: string; hasta?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      const query = qs.toString();
      return get<FacturaAgrupada[]>(`/api/inventario/facturas${query ? `?${query}` : ""}`);
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
    fondoSugerido: () => get<{ fondoSugerido: number | null }>("/api/caja/sesiones/fondo-sugerido"),
    abrirSesion: (data: {
      fondoFijoInicial: number;
      usuarioId: number;
      clave?: string;
      motivoAjusteFondo?: string;
      usuarioAutorizoId?: number;
    }) => post<SesionCaja>("/api/caja/sesiones", data),
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
      data: { clave: string; usuarioId: number; motivo?: string }
    ) => delConBody<Venta>(`/api/caja/ventas/${ventaId}/items/${itemId}`, data),
    agregarPago: (ventaId: number, data: { medio: MedioPago; monto: number; clienteNombre?: string }) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/pagos`, data),
    quitarPago: (ventaId: number, pagoId: number) =>
      del<Venta>(`/api/caja/ventas/${ventaId}/pagos/${pagoId}`),
    confirmarVenta: (ventaId: number, usuarioId: number) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/confirmar`, { usuarioId }),
    cancelarVenta: (ventaId: number, data: { clave: string; usuarioId: number; motivo?: string }) =>
      post<Venta>(`/api/caja/ventas/${ventaId}/cancelar`, data),
    creditosPendientes: () => get<PagoVenta[]>("/api/caja/creditos-pendientes"),
    cobrarCredito: (pagoId: number, data: { medioCobro: MedioCobro; usuarioId: number }) =>
      post<PagoVenta>(`/api/caja/creditos/${pagoId}/cobrar`, data),
    actualizarComentario: (ventaId: number, comentario: string | null) =>
      put<Venta>(`/api/caja/ventas/${ventaId}/comentario`, { comentario }),
    actualizarDespacho: (ventaId: number, data: { esDespacho: boolean; comunaId?: number | null }) =>
      put<Venta>(`/api/caja/ventas/${ventaId}/despacho`, data),
    actualizarDescuento: (ventaId: number, data: { tipo: "porcentaje" | "monto_fijo" | null; valor: number | null }) =>
      put<Venta>(`/api/caja/ventas/${ventaId}/descuento`, data),
    actualizarDescuentoItem: (
      ventaId: number,
      itemId: number,
      data: { tipo: "porcentaje" | "monto_fijo" | null; valor: number | null }
    ) => put<Venta>(`/api/caja/ventas/${ventaId}/items/${itemId}/descuento`, data),
    anulaciones: (params: { desde?: string; hasta?: string }) => {
      const query = new URLSearchParams();
      if (params.desde) query.set("desde", params.desde);
      if (params.hasta) query.set("hasta", params.hasta);
      return get<ReporteAnulaciones>(`/api/caja/anulaciones?${query.toString()}`);
    },
  },
  configuracion: {
    estadoIA: () => get<{ configurada: boolean }>("/api/configuracion/ia/estado"),
    guardarClaveIA: (claveApiAnthropic: string) =>
      post<void>("/api/configuracion/ia", { claveApiAnthropic }),
    direccionRed: () => get<{ direcciones: string[]; puerto: number }>("/api/configuracion/direccion-red"),
    estadoRespaldo: () => get<EstadoRespaldo>("/api/configuracion/respaldo"),
    guardarRutaUsbRespaldo: (rutaUsb: string | null) =>
      put<void>("/api/configuracion/respaldo/ruta-usb", { rutaUsb }),
    respaldarAhora: () => post<ResultadoRespaldo>("/api/configuracion/respaldo/ahora", {}),
    estadoSyncWeb: () =>
      get<{ configurada: boolean; webSyncUrl: string | null }>("/api/configuracion/sync-web/estado"),
    guardarSyncWeb: (data: { webSyncUrl: string; syncApiKey: string }) =>
      post<void>("/api/configuracion/sync-web", data),
  },
  avisos: {
    obtener: () => get<AvisosCriticos>("/api/avisos"),
  },
  asistente: {
    enviarMensaje: (mensaje: string, historial: unknown[]) =>
      post<RespuestaAsistente>("/api/asistente/mensaje", { mensaje, historial }, 60000),
    resolverPropuesta: (historial: unknown[], toolUseId: string, resultado: string) =>
      post<{ historial: unknown[] }>("/api/asistente/resolver", { historial, toolUseId, resultado }),
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
  camara: {
    entradaLote: (data: {
      productoId: number;
      familia: FamiliaCamara;
      procedencia?: ProcedenciaCamara;
      cantidadCajas: number;
      pesoTotalKg?: number;
      pesoIndividualKg?: number;
      costoNetoKg: number;
      usuarioId: number;
    }) => post<CajaCamara[]>("/api/camara/cajas", data),
    entradaFactura: (data: {
      proveedorId: number;
      numeroFactura: string;
      fecha?: string;
      usuarioId: number;
      lineas: {
        productoId: number;
        familia: FamiliaCamara;
        procedencia?: ProcedenciaCamara;
        cantidadCajas: number;
        pesoTotalKg?: number;
        pesoIndividualKg?: number;
        costoNetoKg: number;
      }[];
      confirmarDuplicado?: boolean;
    }) => post<{ cajas: CajaCamara[] }>("/api/camara/cajas/factura", data),
    // De solo lectura — se llama ANTES de guardar (al elegir proveedor o
    // salir del campo N° de factura) para avisar de entrada si esa factura
    // ya se cargó antes, sin esperar a que el guardado la rechace.
    verificarDuplicadoFactura: (proveedorId: number, numeroFactura: string) => {
      const qs = new URLSearchParams({ proveedorId: String(proveedorId), numeroFactura });
      return get<{
        duplicado: boolean;
        lotes: { id: number; producto: string; cantidadCajas: number; pesoTotalKg: number; fechaIngreso: string }[];
      }>(`/api/camara/cajas/factura/verificar-duplicado?${qs.toString()}`);
    },
    obtenerCaja: (id: number) => get<CajaCamara>(`/api/camara/cajas/${id}`),
    avisoFifo: (cajaId: number) => get<AvisoFifoCamara>(`/api/camara/cajas/${cajaId}/fifo`),
    // Desde la pantalla de Salida de cámara, la salida se manda con
    // web/src/lib/colaOffline.ts (ejecutarOEncolar) en vez de este método —
    // necesita una clave de idempotencia para poder reintentarse sola sin
    // duplicar si el celular se queda sin conexión a mitad de camino (ver
    // "Modo sin conexión del celular" en CLAUDE.md). Este método directo
    // se mantiene para el otro llamador legítimo: confirmar una propuesta
    // del Asistente de IA, que siempre corre con conexión (no pasa por el
    // flujo de escaneo del celular).
    salida: (
      cajaId: number,
      data: {
        destino: DestinoSalidaCamara;
        pesoKg?: number;
        motivo?: string;
        usuarioId: number;
        version: number;
        mayorista?: { clienteNombre?: string; precioTotal: number; estadoPago: "pagado" | "pendiente" };
      }
    ) => post<ResultadoSalidaCamara>(`/api/camara/cajas/${cajaId}/salida`, data),
    mayoristas: (params: { desde?: string; hasta?: string; estadoPago?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      if (params.estadoPago) qs.set("estadoPago", params.estadoPago);
      const query = qs.toString();
      return get<SalidaMayorista[]>(`/api/camara/mayoristas${query ? `?${query}` : ""}`);
    },
    marcarEstadoPagoMayorista: (id: number, estadoPago: "pagado" | "pendiente", usuarioId: number) =>
      put<SalidaMayorista>(`/api/camara/mayoristas/${id}/estado-pago`, { estadoPago, usuarioId }),
    editarMayorista: (
      id: number,
      data: { usuarioId: number; clienteNombre?: string | null; precioTotal: number; observaciones?: string | null }
    ) => put<SalidaMayorista>(`/api/camara/mayoristas/${id}`, data),
    anularMayorista: (id: number, data: { usuarioId: number; motivo: string; clave: string }) =>
      post<{ caja: CajaCamara; salida: SalidaMayorista }>(`/api/camara/mayoristas/${id}/anular`, data),
    cajas: (params: { estado?: string; desde?: string; hasta?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.estado) qs.set("estado", params.estado);
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      const query = qs.toString();
      return get<CajaCamara[]>(`/api/camara/cajas${query ? `?${query}` : ""}`);
    },
    anularEntrada: (cajaId: number, usuarioId: number, clave: string, motivo: string) =>
      post<ResultadoAjusteCamara>(`/api/camara/cajas/${cajaId}/anular-entrada`, { usuarioId, clave, motivo }),
    lotes: (params: { desde?: string; hasta?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      const query = qs.toString();
      return get<LoteCamara[]>(`/api/camara/lotes${query ? `?${query}` : ""}`);
    },
    obtenerLote: (id: number) => get<LoteCamara>(`/api/camara/lotes/${id}`),
    corregirLote: (
      id: number,
      data: {
        productoId: number;
        familia: FamiliaCamara;
        procedencia?: ProcedenciaCamara;
        pesoTotalKg: number;
        costoNetoKg: number;
        usuarioId: number;
      }
    ) => put<{ lote: LoteCamara; cajas: CajaCamara[] }>(`/api/camara/lotes/${id}`, data),
    anularLote: (id: number, usuarioId: number, clave: string, motivo: string) =>
      post<{ cajas: CajaCamara[] }>(`/api/camara/lotes/${id}/anular`, { usuarioId, clave, motivo }),
    existencias: (params: { desde?: string; hasta?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      const query = qs.toString();
      return get<ExistenciasCamara>(`/api/camara/existencias${query ? `?${query}` : ""}`);
    },
    reporteSalidas: (params: { desde?: string; hasta?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.desde) qs.set("desde", params.desde);
      if (params.hasta) qs.set("hasta", params.hasta);
      const query = qs.toString();
      return get<ReporteSalidasCamara>(`/api/camara/reporte-salidas${query ? `?${query}` : ""}`);
    },
    // Resolver un ajuste pendiente ("confirmar-falta"/"encontrada") también
    // pasa por ejecutarOEncolar en vez de un método acá, mismo motivo que
    // la salida.
    abrirSesionInventario: (usuarioId: number) =>
      post<SesionInventarioCamara>("/api/camara/inventario/sesiones", { usuarioId }),
    sesionesInventario: (params: { estado?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.estado) qs.set("estado", params.estado);
      const query = qs.toString();
      return get<SesionInventarioCamara[]>(`/api/camara/inventario/sesiones${query ? `?${query}` : ""}`);
    },
    detalleSesionInventario: (id: number) =>
      get<DetalleSesionInventarioCamara>(`/api/camara/inventario/sesiones/${id}`),
    escanearInventario: (sesionId: number, data: { codigo: string; usuarioId: number }) =>
      post<ResultadoEscaneoInventarioCamara>(`/api/camara/inventario/sesiones/${sesionId}/escanear`, data),
    cerrarSesionInventario: (sesionId: number, data: { usuarioId: number; observaciones?: string }) =>
      post<ResultadoCierreSesionCamara>(`/api/camara/inventario/sesiones/${sesionId}/cerrar`, data),
    previsualizarImportacion: (json: string) =>
      post<PrevisualizacionImportacionCamara>("/api/camara/importar-prototipo/previsualizar", { json }),
    confirmarImportacion: (data: { json: string; usuarioId: number; mapeo: { clave: string; productoId: number | null }[] }) =>
      post<ResultadoImportacionCamara>("/api/camara/importar-prototipo/confirmar", data),
  },
};

export function formatoCLP(valor: number): string {
  return valor.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
}

// Los ítems de PedidoWeb con unidad "kg" traen la cantidad en gramos (mismo
// criterio que usa la web en su carrito) — gramos bajo 1 kg, kilos con coma
// decimal desde 1 kg.
export function formatoPeso(gramos: number): string {
  if (gramos < 1000) return `${gramos} g`;
  const kilos = gramos / 1000;
  const texto = kilos.toFixed(1).replace(".", ",").replace(",0", "");
  return `${texto} kg`;
}
