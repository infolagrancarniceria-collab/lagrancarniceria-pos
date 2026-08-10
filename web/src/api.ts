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

export interface ProductoConStock extends Producto {
  bajoStock: boolean;
}

export interface Proveedor {
  id: number;
  nombre: string;
  contacto: string | null;
  activo: boolean;
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
  fecha: string;
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

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return manejarRespuesta<T>(res);
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return manejarRespuesta<T>(res);
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return manejarRespuesta<T>(res);
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
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
    obtener: (id: number) => get<Producto>(`/api/productos/${id}`),
    crear: (data: Omit<Producto, "id" | "categoria" | "activo" | "stockActual">) =>
      post<Producto>("/api/productos", data),
    actualizar: (
      id: number,
      data: Omit<Producto, "id" | "categoria" | "activo" | "precio" | "stockActual">
    ) => put<Producto>(`/api/productos/${id}`, data),
    eliminar: (id: number) => del<void>(`/api/productos/${id}`),
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
  inventario: {
    stock: (soloBajo = false) =>
      get<ProductoConStock[]>(`/api/inventario/stock${soloBajo ? "?bajo=true" : ""}`),
    entrada: (data: {
      productoId: number;
      cantidad: number;
      motivo: "compra" | "ajuste";
      proveedorId?: number | null;
      costoUnitario?: number | null;
      usuarioId: number;
    }) => post<Producto>("/api/inventario/entrada", data),
    salida: (data: {
      productoId: number;
      cantidad: number;
      motivo: "venta" | "descarte" | "ajuste";
      usuarioId: number;
    }) => post<Producto>("/api/inventario/salida", data),
    movimientos: (params: { productoId?: number; tipo?: "entrada" | "salida" } = {}) => {
      const qs = new URLSearchParams();
      if (params.productoId) qs.set("productoId", String(params.productoId));
      if (params.tipo) qs.set("tipo", params.tipo);
      const query = qs.toString();
      return get<MovimientoInventario[]>(`/api/inventario/movimientos${query ? `?${query}` : ""}`);
    },
  },
};

export function formatoCLP(valor: number): string {
  return valor.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
}
