import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  calcularMargen,
  formatoCLP,
  FAMILIAS_CAMARA,
  PROCEDENCIAS_VACUNO,
  type CajaCamara,
  type Categoria,
  type FamiliaCamara,
  type ProcedenciaCamara,
  type Producto,
  type ProductoConCosto,
  type Proveedor,
} from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara, imprimirEtiquetasLoteCamara } from "../lib/imprimir";
import { mostrarToast } from "../lib/toast";
import ModalAlerta from "../components/ModalAlerta";
import ParMargen from "../components/ParMargen";

// Pantalla única de ingreso de mercadería — a pedido del usuario, para no
// tener que elegir de entrada entre dos pantallas distintas ("Ingreso a
// cámara" vs. "Cargar factura") que en el fondo hacen lo mismo (cargar una
// factura de compra, línea por línea, con el mismo proveedor y N°). Ahora
// es UNA pantalla con un selector arriba: "Por kilo" (carne fresca, crea
// lotes de cámara con etiqueta y FEFO) o "Por unidad / congelados" (crea
// una entrada de inventario directa). Por debajo siguen siendo dos
// mecanismos distintos a propósito — unificar el modelo de datos habría
// significado tocar cómo cámara maneja lotes/vencimiento, mucho más riesgo
// por una ganancia que es puramente de qué tan fácil es encontrar la
// pantalla correcta.
type Modo = "kilo" | "unidad";

// --- Modo "Por kilo" (carne fresca → cámara) ---

interface LineaKilo {
  id: number;
  familia: FamiliaCamara;
  procedencia: ProcedenciaCamara | "";
  producto: Producto | null;
  buscarProducto: string;
  resultados: Producto[];
  info: ProductoConCosto | null;
  precioNuevo: string;
  precioMayorNuevo: string;
  cantidadCajas: string;
  modoPeso: "total" | "individual";
  pesoValor: string;
  costoNetoKg: string;
  aplicaIvaCarne: boolean;
}

function lineaKiloVacia(id: number): LineaKilo {
  return {
    id,
    familia: "Vacuno",
    procedencia: "",
    producto: null,
    buscarProducto: "",
    resultados: [],
    info: null,
    precioNuevo: "",
    precioMayorNuevo: "",
    cantidadCajas: "1",
    modoPeso: "individual",
    pesoValor: "",
    costoNetoKg: "",
    aplicaIvaCarne: false,
  };
}

// --- Modo "Por unidad / congelados" (inventario directo) ---

interface LineaUnidad {
  id: number;
  producto: Producto | null;
  buscarProducto: string;
  resultados: Producto[];
  cantidad: string;
  costoUnitario: string;
  aplicaIvaCarne: boolean;
  umbralStockBajo: string;
}

function lineaUnidadVacia(id: number): LineaUnidad {
  return {
    id,
    producto: null,
    buscarProducto: "",
    resultados: [],
    cantidad: "",
    costoUnitario: "",
    aplicaIvaCarne: false,
    umbralStockBajo: "",
  };
}

// Restricción del modo "Por unidad": solo productos que NO se venden
// pesados (flagBalanza !== "PESABLE") o que son de la categoría raíz
// "Congelados" — la carne fresca por peso va por el modo "Por kilo". Misma
// regla aplicada en el servidor (ver server/routes/inventario.ts,
// puedeCargarsePorFactura).
function calificaParaUnidad(p: Producto, categoriasPorId: Map<number, Categoria>): boolean {
  if (p.flagBalanza !== "PESABLE") return true;
  let actual = categoriasPorId.get(p.categoriaId);
  while (actual && actual.padreId !== null) {
    actual = categoriasPorId.get(actual.padreId);
  }
  return actual?.nombre === "Congelados";
}

// Impuestos de la factura, para poder comparar el total contra el papel
// real del proveedor — el neto ya se usaba para armar la entrada, esto es
// solo una calculadora en pantalla, no se guarda en ningún lado.
const TASA_IVA = 0.19;
const TASA_IVA_CARNE = 0.05;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Borrador en localStorage para no perder lo tipeado si hay que salir a
// atender la caja a mitad de cargar una factura — un solo borrador para
// toda la pantalla (incluye el modo y las líneas de AMBOS modos, no solo
// el activo) así que cambiar de modo a mitad de camino no pierde lo ya
// tipeado en el otro. Se guarda en cada cambio y se borra recién al
// registrar la factura con éxito.
const CLAVE_BORRADOR = "granCarniceria_borradorIngresoMercaderia_v1";

type LineaKiloBorrador = Pick<
  LineaKilo,
  "id" | "familia" | "procedencia" | "producto" | "cantidadCajas" | "modoPeso" | "pesoValor" | "costoNetoKg" | "aplicaIvaCarne" | "precioNuevo" | "precioMayorNuevo"
>;
type LineaUnidadBorrador = Pick<LineaUnidad, "id" | "producto" | "cantidad" | "costoUnitario" | "aplicaIvaCarne" | "umbralStockBajo">;

interface Borrador {
  modo: Modo;
  proveedorSeleccionado: Proveedor | null;
  numeroFactura: string;
  fecha: string;
  lineasKilo: LineaKiloBorrador[];
  lineasUnidad: LineaUnidadBorrador[];
}

function borradorEstaVacio(b: Borrador): boolean {
  return (
    !b.proveedorSeleccionado &&
    !b.numeroFactura.trim() &&
    b.lineasKilo.every((l) => !l.producto && !l.pesoValor && !l.costoNetoKg) &&
    b.lineasUnidad.every((l) => !l.producto && !l.cantidad && !l.costoUnitario)
  );
}

function cargarBorrador(): Borrador | null {
  try {
    const guardado = localStorage.getItem(CLAVE_BORRADOR);
    if (!guardado) return null;
    const borrador = JSON.parse(guardado) as Borrador;
    return borradorEstaVacio(borrador) ? null : borrador;
  } catch {
    return null;
  }
}

function guardarBorrador(b: Borrador) {
  try {
    if (borradorEstaVacio(b)) {
      localStorage.removeItem(CLAVE_BORRADOR);
    } else {
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    }
  } catch {
    // Si falla (ej. modo privado sin storage) se pierde el borrador, pero
    // no debe impedir seguir cargando la factura.
  }
}

function borrarBorrador() {
  try {
    localStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    // ver guardarBorrador
  }
}

export default function IngresoMercaderia() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const borrador = useMemo(() => cargarBorrador(), []);
  const lineasKiloIniciales: LineaKilo[] = borrador
    ? borrador.lineasKilo.map((l) => ({ ...l, buscarProducto: "", resultados: [], info: null }))
    : [lineaKiloVacia(1)];
  const lineasUnidadIniciales: LineaUnidad[] = borrador
    ? borrador.lineasUnidad.map((l) => ({ ...l, buscarProducto: "", resultados: [] }))
    : [lineaUnidadVacia(1)];

  const [modo, setModo] = useState<Modo>(borrador?.modo ?? "kilo");

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [buscarProveedor, setBuscarProveedor] = useState("");
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState<Proveedor | null>(
    borrador?.proveedorSeleccionado ?? null
  );
  // Crear un proveedor nuevo sin salir de esta pantalla.
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [nuevoProveedorNombre, setNuevoProveedorNombre] = useState("");
  const [nuevoProveedorContacto, setNuevoProveedorContacto] = useState("");
  const [creandoProveedorError, setCreandoProveedorError] = useState<string | null>(null);
  const [guardandoProveedor, setGuardandoProveedor] = useState(false);

  const [numeroFactura, setNumeroFactura] = useState(borrador?.numeroFactura ?? "");
  const [fecha, setFecha] = useState(borrador?.fecha ?? hoy());

  const [lineasKilo, setLineasKilo] = useState<LineaKilo[]>(lineasKiloIniciales);
  const [siguienteIdKilo, setSiguienteIdKilo] = useState(1 + Math.max(0, ...lineasKiloIniciales.map((l) => l.id)));
  const [lineasUnidad, setLineasUnidad] = useState<LineaUnidad[]>(lineasUnidadIniciales);
  const [siguienteIdUnidad, setSiguienteIdUnidad] = useState(1 + Math.max(0, ...lineasUnidadIniciales.map((l) => l.id)));
  const [borradorRestaurado] = useState(borrador != null);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cajasCreadas, setCajasCreadas] = useState<CajaCamara[] | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<number | null>(null);
  const [imprimiendoLote, setImprimiendoLote] = useState(false);

  // Aviso de posible factura duplicada (mismo proveedor + N° de factura ya
  // cargado antes) — solo aplica al modo "Por kilo" (cámara), que es el
  // que ya tenía esta revisión; "Por unidad" no la tenía antes y no es
  // parte de lo pedido ahora.
  const [avisoDuplicado, setAvisoDuplicado] = useState<{
    lotes: { id: number; producto: string; cantidadCajas: number; pesoTotalKg: number; fechaIngreso: string }[];
  } | null>(null);
  const [duplicadoConfirmado, setDuplicadoConfirmado] = useState(false);

  useEffect(() => {
    api.proveedores.listar().then(setProveedores).catch((e) => setError(e.message));
    api.categorias.listar().then(setCategorias).catch((e) => setError(e.message));
  }, []);

  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  // Re-pide el "info" (precio/margen/último costo) de cada línea de kilo
  // restaurada del borrador que ya tenía un producto elegido.
  useEffect(() => {
    if (!borrador) return;
    for (const l of lineasKiloIniciales) {
      if (l.producto && !l.info) {
        api.productos
          .obtener(l.producto.id)
          .then((info) => actualizarLineaKilo(l.id, { info }))
          .catch((e) => setError(e.message));
      }
    }
    // Solo al montar — las líneas del borrador ya están en el estado inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    guardarBorrador({
      modo,
      proveedorSeleccionado,
      numeroFactura,
      fecha,
      lineasKilo: lineasKilo.map((l) => ({
        id: l.id,
        familia: l.familia,
        procedencia: l.procedencia,
        producto: l.producto,
        cantidadCajas: l.cantidadCajas,
        modoPeso: l.modoPeso,
        pesoValor: l.pesoValor,
        costoNetoKg: l.costoNetoKg,
        aplicaIvaCarne: l.aplicaIvaCarne,
        precioNuevo: l.precioNuevo,
        precioMayorNuevo: l.precioMayorNuevo,
      })),
      lineasUnidad: lineasUnidad.map((l) => ({
        id: l.id,
        producto: l.producto,
        cantidad: l.cantidad,
        costoUnitario: l.costoUnitario,
        aplicaIvaCarne: l.aplicaIvaCarne,
        umbralStockBajo: l.umbralStockBajo,
      })),
    });
  }, [modo, proveedorSeleccionado, numeroFactura, fecha, lineasKilo, lineasUnidad]);

  function descartarBorrador() {
    borrarBorrador();
    setProveedorSeleccionado(null);
    setNumeroFactura("");
    setFecha(hoy());
    setLineasKilo([lineaKiloVacia(1)]);
    setSiguienteIdKilo(2);
    setLineasUnidad([lineaUnidadVacia(1)]);
    setSiguienteIdUnidad(2);
  }

  function verificarDuplicado(proveedorId: number, numeroFacturaTexto: string) {
    if (!proveedorId || !numeroFacturaTexto.trim()) return;
    api.camara
      .verificarDuplicadoFactura(proveedorId, numeroFacturaTexto.trim())
      .then((resultado) => {
        setAvisoDuplicado(resultado.duplicado ? { lotes: resultado.lotes } : null);
        setDuplicadoConfirmado(false);
      })
      .catch(() => {
        // Un fallo acá no debe bloquear cargar la factura — el guardado
        // igual vuelve a revisar por su cuenta como respaldo.
      });
  }

  function abrirCrearProveedor() {
    setNuevoProveedorNombre(buscarProveedor.trim());
    setNuevoProveedorContacto("");
    setCreandoProveedorError(null);
    setCreandoProveedor(true);
  }

  async function crearProveedor() {
    setCreandoProveedorError(null);
    if (!nuevoProveedorNombre.trim()) {
      setCreandoProveedorError("Falta el nombre del proveedor");
      return;
    }
    setGuardandoProveedor(true);
    try {
      const proveedor = await api.proveedores.crear({
        nombre: nuevoProveedorNombre.trim(),
        contacto: nuevoProveedorContacto.trim() || null,
      });
      setProveedores((actual) => [...actual, proveedor].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setProveedorSeleccionado(proveedor);
      setBuscarProveedor("");
      setCreandoProveedor(false);
      mostrarToast("Proveedor creado", proveedor.nombre);
    } catch (e) {
      setCreandoProveedorError((e as Error).message);
    } finally {
      setGuardandoProveedor(false);
    }
  }

  const proveedoresFiltrados = buscarProveedor.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(buscarProveedor.trim().toLowerCase()))
    : proveedores;

  // --- Modo "Por kilo" ---

  function actualizarLineaKilo(id: number, cambios: Partial<LineaKilo>) {
    setLineasKilo((actual) => actual.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
  }

  function buscarProductoLineaKilo(id: number, texto: string) {
    actualizarLineaKilo(id, { buscarProducto: texto, producto: null, info: null });
    if (!texto.trim()) {
      actualizarLineaKilo(id, { resultados: [] });
      return;
    }
    api.productos
      .listar({ buscar: texto })
      .then((resultados) => actualizarLineaKilo(id, { resultados }))
      .catch((e) => setError(e.message));
  }

  function elegirProductoKilo(id: number, producto: Producto) {
    actualizarLineaKilo(id, {
      producto,
      buscarProducto: "",
      resultados: [],
      aplicaIvaCarne: producto.aplicaIvaCarne,
    });
    api.productos
      .obtener(producto.id)
      .then((info) => actualizarLineaKilo(id, { info }))
      .catch((e) => setError(e.message));
  }

  async function cambiarPrecios(linea: LineaKilo) {
    if (!linea.info) return;
    const nuevoVenta = linea.precioNuevo ? Number(linea.precioNuevo) : null;
    const nuevoMayor = linea.precioMayorNuevo ? Number(linea.precioMayorNuevo) : null;
    if (!nuevoVenta && !nuevoMayor) return;
    try {
      let info = linea.info;
      if (nuevoVenta) {
        const actualizado = await api.precios.cambiarIndividual({
          productoId: info.id,
          precioNuevo: nuevoVenta,
          usuarioId: usuario!.id,
        });
        info = { ...info, precio: actualizado.precio };
      }
      if (nuevoMayor) {
        const actualizado = await api.productos.cambiarPrecioMayor(info.id, nuevoMayor);
        info = { ...info, precioMayor: actualizado.precioMayor };
      }
      actualizarLineaKilo(linea.id, { info, precioNuevo: "", precioMayorNuevo: "" });
      mostrarToast("Precio actualizado", info.descripcion);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function agregarLineaKilo() {
    setLineasKilo((actual) => [...actual, lineaKiloVacia(siguienteIdKilo)]);
    setSiguienteIdKilo((n) => n + 1);
  }

  function quitarLineaKilo(id: number) {
    setLineasKilo((actual) => (actual.length > 1 ? actual.filter((l) => l.id !== id) : actual));
  }

  function subtotalLineaKilo(l: LineaKilo): number {
    const cajas = Number(l.cantidadCajas) || 0;
    const peso = Number(l.pesoValor) || 0;
    const costo = Number(l.costoNetoKg) || 0;
    const kilos = l.modoPeso === "total" ? peso : peso * cajas;
    return Math.round(kilos * costo);
  }

  // --- Modo "Por unidad / congelados" ---

  function actualizarLineaUnidad(id: number, cambios: Partial<LineaUnidad>) {
    setLineasUnidad((actual) => actual.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
  }

  function buscarProductoLineaUnidad(id: number, texto: string) {
    actualizarLineaUnidad(id, { buscarProducto: texto, producto: null });
    if (!texto.trim()) {
      actualizarLineaUnidad(id, { resultados: [] });
      return;
    }
    api.productos
      .listar({ buscar: texto })
      .then((resultados) =>
        actualizarLineaUnidad(id, { resultados: resultados.filter((p) => calificaParaUnidad(p, categoriasPorId)) })
      )
      .catch((e) => setError(e.message));
  }

  function agregarLineaUnidad() {
    setLineasUnidad((actual) => [...actual, lineaUnidadVacia(siguienteIdUnidad)]);
    setSiguienteIdUnidad((n) => n + 1);
  }

  function quitarLineaUnidad(id: number) {
    setLineasUnidad((actual) => (actual.length > 1 ? actual.filter((l) => l.id !== id) : actual));
  }

  function subtotalLineaUnidad(l: LineaUnidad): number {
    return (Number(l.cantidad) || 0) * (Number(l.costoUnitario) || 0);
  }

  // --- Totales (de la línea activa) ---

  const totalNeto = modo === "kilo" ? lineasKilo.reduce((s, l) => s + subtotalLineaKilo(l), 0) : lineasUnidad.reduce((s, l) => s + subtotalLineaUnidad(l), 0);
  const subtotalCarne =
    modo === "kilo"
      ? lineasKilo.filter((l) => l.aplicaIvaCarne).reduce((s, l) => s + subtotalLineaKilo(l), 0)
      : lineasUnidad.filter((l) => l.aplicaIvaCarne).reduce((s, l) => s + subtotalLineaUnidad(l), 0);
  const iva = Math.round(totalNeto * TASA_IVA);
  const ivaCarne = Math.round(subtotalCarne * TASA_IVA_CARNE);
  const totalConImpuestos = totalNeto + iva + ivaCarne;

  function nuevaFactura() {
    borrarBorrador();
    setCajasCreadas(null);
    setProveedorSeleccionado(null);
    setBuscarProveedor("");
    setNumeroFactura("");
    setFecha(hoy());
    setLineasKilo([lineaKiloVacia(1)]);
    setSiguienteIdKilo(2);
    setLineasUnidad([lineaUnidadVacia(1)]);
    setSiguienteIdUnidad(2);
    setAvisoDuplicado(null);
    setDuplicadoConfirmado(false);
  }

  async function guardarKilo() {
    if (avisoDuplicado && !duplicadoConfirmado) {
      setError("Esta factura ya se cargó antes — revisa el aviso arriba y confirma si quieres seguir igual.");
      return;
    }
    for (const l of lineasKilo) {
      if (!l.producto) {
        setError("Falta elegir el producto de alguna línea");
        return;
      }
      if (l.familia === "Vacuno" && !l.procedencia) {
        setError(`Falta la procedencia de "${l.producto.descripcion}"`);
        return;
      }
      const cajas = Number(l.cantidadCajas);
      if (!cajas || cajas <= 0 || !Number.isInteger(cajas)) {
        setError(`Cantidad de cajas inválida en "${l.producto.descripcion}"`);
        return;
      }
      if (!Number(l.pesoValor) || Number(l.pesoValor) <= 0) {
        setError(`Falta el peso de "${l.producto.descripcion}"`);
        return;
      }
      if (!Number(l.costoNetoKg) || Number(l.costoNetoKg) <= 0) {
        setError(`Falta el costo neto por kilo de "${l.producto.descripcion}"`);
        return;
      }
    }

    const confirmado = window.confirm(
      `¿Registrar esta factura? ${lineasKilo.length} línea(s), total neto ${formatoCLP(totalNeto)}.`
    );
    if (!confirmado) return;

    setGuardando(true);
    try {
      const resultado = await api.camara.entradaFactura({
        proveedorId: proveedorSeleccionado!.id,
        numeroFactura: numeroFactura.trim(),
        fecha,
        usuarioId: usuario!.id,
        lineas: lineasKilo.map((l) => ({
          productoId: l.producto!.id,
          familia: l.familia,
          ...(l.familia === "Vacuno" ? { procedencia: l.procedencia as ProcedenciaCamara } : {}),
          cantidadCajas: Number(l.cantidadCajas),
          ...(l.modoPeso === "total" ? { pesoTotalKg: Number(l.pesoValor) } : { pesoIndividualKg: Number(l.pesoValor) }),
          costoNetoKg: Number(l.costoNetoKg),
        })),
        confirmarDuplicado: duplicadoConfirmado,
      });
      borrarBorrador();
      setCajasCreadas(resultado.cajas);
      mostrarToast(
        "Factura ingresada a cámara",
        `${lineasKilo.length} línea(s) de ${proveedorSeleccionado!.nombre} — ${formatoCLP(totalNeto)}.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarUnidad() {
    const lineasValidas = lineasUnidad.filter((l) => l.producto);
    if (lineasValidas.length === 0) {
      setError("Agrega al menos una línea con un producto elegido");
      return;
    }
    for (const l of lineasValidas) {
      if (!Number(l.cantidad) || Number(l.cantidad) <= 0) {
        setError(`Falta la cantidad de "${l.producto!.descripcion}"`);
        return;
      }
      if (!Number(l.costoUnitario) || Number(l.costoUnitario) <= 0) {
        setError(`Falta el costo unitario de "${l.producto!.descripcion}"`);
        return;
      }
      if (l.umbralStockBajo.trim() && (!Number.isInteger(Number(l.umbralStockBajo)) || Number(l.umbralStockBajo) < 0)) {
        setError(`El umbral de stock bajo de "${l.producto!.descripcion}" debe ser un número entero mayor o igual a 0`);
        return;
      }
    }

    setGuardando(true);
    try {
      await api.inventario.entradaFactura({
        proveedorId: proveedorSeleccionado!.id,
        numeroFactura: numeroFactura.trim(),
        fecha,
        usuarioId: usuario!.id,
        lineas: lineasValidas.map((l) => ({
          productoId: l.producto!.id,
          cantidad: Number(l.cantidad),
          costoUnitario: Number(l.costoUnitario),
          umbralStockBajo: l.umbralStockBajo.trim() ? Number(l.umbralStockBajo) : null,
        })),
      });
      mostrarToast(
        "Factura cargada",
        `${lineasValidas.length} línea(s) de ${proveedorSeleccionado!.nombre} — ${formatoCLP(totalNeto)}.`
      );
      borrarBorrador();
      navigate("/inventario/facturas");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usuario || !proveedorSeleccionado) {
      setError("Falta elegir el proveedor");
      return;
    }
    if (!numeroFactura.trim()) {
      setError("Falta el N° de factura");
      return;
    }
    if (modo === "kilo") await guardarKilo();
    else await guardarUnidad();
  }

  function imprimirEtiqueta(id: number) {
    setImprimiendoId(id);
    setTimeout(() => {
      imprimirEtiquetaCamara();
      setTimeout(() => setImprimiendoId(null), 500);
    }, 0);
  }

  function imprimirTodasLasEtiquetas() {
    if (!cajasCreadas || cajasCreadas.length < 2) return;
    const primera = String(cajasCreadas[0].id).padStart(6, "0");
    const ultima = String(cajasCreadas[cajasCreadas.length - 1].id).padStart(6, "0");
    const confirmado = window.confirm(
      `Se imprimirán ${cajasCreadas.length} etiquetas, desde la caja ${primera} hasta la ${ultima}.\n\nAntes de continuar verifica que "Copias" esté en 1.`
    );
    if (!confirmado) return;
    setImprimiendoLote(true);
    setTimeout(() => {
      imprimirEtiquetasLoteCamara();
      setTimeout(() => setImprimiendoLote(false), 500);
    }, 0);
  }

  // Pantalla de etiquetas tras registrar en modo "Por kilo" — el modo "Por
  // unidad" no genera cajas físicas, así que navega directo a Facturas
  // (ver guardarUnidad) y nunca llega a este estado.
  if (cajasCreadas) {
    return (
      <div>
        <div className="no-imprimir">
          <div className="encabezado-pantalla">
            <h1>Factura ingresada — {cajasCreadas.length} caja(s) registrada(s)</h1>
            <Link to="/camara" className="boton">
              Volver a Cámara
            </Link>
          </div>
          <p className="exito">Listo — imprime cada etiqueta con el botón correspondiente, o todas de una vez.</p>
          <div className="fila-inline">
            <button type="button" className="boton boton-primario" onClick={nuevaFactura}>
              Registrar otra factura
            </button>
            {cajasCreadas.length > 1 && (
              <button type="button" className="boton boton-peligro" onClick={imprimirTodasLasEtiquetas}>
                ⚡ Imprimir todas las etiquetas ({cajasCreadas.length})
              </button>
            )}
          </div>
        </div>

        <div className={`etiquetas-camara${imprimiendoLote ? " imprimiendo-lote" : ""}`}>
          {cajasCreadas.map((caja) => (
            <div key={caja.id} className="etiqueta-bloque">
              <EtiquetaCamara
                numero={String(caja.id).padStart(6, "0")}
                producto={caja.producto.descripcion}
                familia={caja.familiaNombre}
                procedencia={caja.procedencia}
                fechaIngreso={caja.fechaIngreso}
                pesoInicialKg={caja.pesoInicialKg}
                pesoEstimado={caja.pesoEstimado}
                imprimiendo={imprimiendoId === caja.id || imprimiendoLote}
              />
              <button type="button" className="boton no-imprimir" onClick={() => imprimirEtiqueta(caja.id)}>
                Imprimir caja {String(caja.id).padStart(6, "0")}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Ingreso de mercadería</h1>
        <Link to="/inventario" className="boton">
          Volver a inventario
        </Link>
      </div>
      <p className="ayuda">
        Una sola pantalla para cargar cualquier factura de compra. Elige cómo viene esta mercadería: por kilo (carne
        fresca, genera cajas con etiqueta para cámara) o por unidad/congelados (entra directo a inventario).
      </p>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {borradorRestaurado && (
        <p className="exito">
          Se restauró el borrador que habías dejado sin terminar.{" "}
          <button type="button" onClick={descartarBorrador}>
            Descartar y empezar de nuevo
          </button>
        </p>
      )}

      <div className="chips-categoria" role="radiogroup" aria-label="Cómo viene esta mercadería">
        <button
          type="button"
          className={`chip-categoria ${modo === "kilo" ? "activo" : ""}`}
          onClick={() => setModo("kilo")}
        >
          🥩 Por kilo (carne fresca)
        </button>
        <button
          type="button"
          className={`chip-categoria ${modo === "unidad" ? "activo" : ""}`}
          onClick={() => setModo("unidad")}
        >
          📦 Por unidad / congelados
        </button>
      </div>

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Proveedor
          <div className="buscador-producto">
            <input
              type="text"
              placeholder="Buscar proveedor... (vacío = ver todos)"
              value={buscarProveedor}
              onChange={(e) => {
                setBuscarProveedor(e.target.value);
                setProveedorSeleccionado(null);
              }}
            />
            {!proveedorSeleccionado && (
              <div className="resultados-busqueda">
                {proveedoresFiltrados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                {proveedoresFiltrados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="resultado-item"
                    onClick={() => {
                      setProveedorSeleccionado(p);
                      setBuscarProveedor("");
                      if (modo === "kilo") verificarDuplicado(p.id, numeroFactura);
                    }}
                  >
                    {p.nombre}
                  </button>
                ))}
                <button type="button" className="resultado-item" onClick={abrirCrearProveedor}>
                  + Nuevo proveedor{buscarProveedor.trim() ? `: "${buscarProveedor.trim()}"` : ""}
                </button>
              </div>
            )}
          </div>
          {proveedorSeleccionado && (
            <p className="exito">
              Proveedor elegido: {proveedorSeleccionado.nombre}{" "}
              <button type="button" onClick={() => setProveedorSeleccionado(null)}>
                Cambiar
              </button>
            </p>
          )}
          {creandoProveedor && (
            <div className="tarjeta-mini">
              <p>
                <strong>Nuevo proveedor</strong>
              </p>
              {creandoProveedorError && <p className="error">{creandoProveedorError}</p>}
              <label className="ayuda">
                Nombre
                <input
                  type="text"
                  value={nuevoProveedorNombre}
                  onChange={(e) => setNuevoProveedorNombre(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="ayuda">
                Contacto (opcional)
                <input type="text" value={nuevoProveedorContacto} onChange={(e) => setNuevoProveedorContacto(e.target.value)} />
              </label>
              <div className="fila-inline">
                <button type="button" className="boton boton-primario" onClick={crearProveedor} disabled={guardandoProveedor}>
                  {guardandoProveedor ? "Guardando..." : "Crear y elegir"}
                </button>
                <button type="button" onClick={() => setCreandoProveedor(false)} disabled={guardandoProveedor}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </label>
        <label>
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </label>
        <label>
          N° de factura
          <input
            value={numeroFactura}
            onChange={(e) => setNumeroFactura(e.target.value)}
            onBlur={(e) => modo === "kilo" && proveedorSeleccionado && verificarDuplicado(proveedorSeleccionado.id, e.target.value)}
            required
          />
        </label>

        {modo === "kilo" && avisoDuplicado && (
          <div className="tarjeta tarjeta-mini aviso-advertencia">
            <p>
              ⚠ <strong>Esta factura ya se cargó antes</strong> — mismo proveedor y N° de factura, en{" "}
              {avisoDuplicado.lotes.length === 1 ? "este lote" : "estos lotes"}:
            </p>
            <ul>
              {avisoDuplicado.lotes.map((l) => (
                <li key={l.id}>
                  {l.producto} — {l.cantidadCajas} caja(s), {l.pesoTotalKg.toFixed(2)} kg — ingresado el{" "}
                  {new Date(l.fechaIngreso).toLocaleDateString("es-CL")}
                </li>
              ))}
            </ul>
            {duplicadoConfirmado ? (
              <p className="exito">Confirmado — se va a ingresar igual, como una factura nueva y distinta.</p>
            ) : (
              <div className="fila-inline">
                <button type="button" className="boton boton-peligro" onClick={() => setDuplicadoConfirmado(true)}>
                  Sí, es una factura distinta — continuar de todas formas
                </button>
              </div>
            )}
          </div>
        )}

        {modo === "kilo" ? (
          <div className="acciones-formulario">
            <h2>Líneas de la factura</h2>
            {lineasKilo.map((l, i) => (
              <div key={l.id} className="tarjeta tarjeta-mini">
                <div className="fila-inline" style={{ justifyContent: "space-between" }}>
                  <strong>Línea {i + 1}</strong>
                  {lineasKilo.length > 1 && (
                    <button type="button" className="boton-quitar-item" onClick={() => quitarLineaKilo(l.id)}>
                      ✕
                    </button>
                  )}
                </div>

                <label>
                  Familia
                  <select
                    value={l.familia}
                    onChange={(e) => {
                      const nueva = e.target.value as FamiliaCamara;
                      actualizarLineaKilo(l.id, { familia: nueva, procedencia: nueva !== "Vacuno" ? "" : l.procedencia });
                    }}
                  >
                    {FAMILIAS_CAMARA.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>

                {l.familia === "Vacuno" && (
                  <label>
                    Procedencia
                    <select value={l.procedencia} onChange={(e) => actualizarLineaKilo(l.id, { procedencia: e.target.value as ProcedenciaCamara })}>
                      <option value="">Seleccione...</option>
                      {PROCEDENCIAS_VACUNO.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label>
                  Producto o corte
                  <div className="buscador-producto">
                    <input
                      type="text"
                      placeholder="Buscar por PLU o nombre..."
                      value={l.producto ? l.producto.descripcion : l.buscarProducto}
                      onChange={(e) => buscarProductoLineaKilo(l.id, e.target.value)}
                    />
                    {!l.producto && l.buscarProducto.trim() && (
                      <div className="resultados-busqueda">
                        {l.resultados.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                        {l.resultados.map((p) => (
                          <button key={p.id} type="button" className="resultado-item" onClick={() => elegirProductoKilo(l.id, p)}>
                            {p.plu} — {p.descripcion} ({p.categoria.nombre})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>

                {l.info && (
                  <div className="tarjeta-mini">
                    <p>
                      <strong>PLU:</strong> {l.info.plu} · <strong>Última compra en cámara:</strong>{" "}
                      {l.info.ultimoCostoCamaraKg != null ? `${formatoCLP(l.info.ultimoCostoCamaraKg)}/kg` : "sin datos"}
                    </p>
                    <p>
                      <strong>Precio venta:</strong> {formatoCLP(l.info.precio)} · <strong>Precio venta mayor:</strong>{" "}
                      {l.info.precioMayor != null ? formatoCLP(l.info.precioMayor) : "sin definir"}
                    </p>
                    {(() => {
                      const costoConHistorial = l.info!.ultimoCostoCamaraKg;
                      const costoEscrito = Number(l.costoNetoKg) || null;
                      const margenActual = costoConHistorial != null ? calcularMargen(l.info!.precio, costoConHistorial) : null;
                      const precioSugerido =
                        costoEscrito != null && margenActual != null
                          ? Math.max(1, Math.round(costoEscrito * (1 + margenActual / 100) * 1.19))
                          : null;
                      return (
                        <>
                          <div className="fila-inline">
                            {costoConHistorial != null && (
                              <div>
                                <p className="ayuda" style={{ margin: 0 }}>
                                  Margen actual (última compra en cámara, {formatoCLP(costoConHistorial)}/kg)
                                </p>
                                <ParMargen precio={l.info!.precio} costo={costoConHistorial} />
                              </div>
                            )}
                            {costoEscrito != null && (
                              <>
                                {costoConHistorial != null && "→"}
                                <div>
                                  <p className="ayuda" style={{ margin: 0 }}>
                                    Con el costo recién escrito ({formatoCLP(costoEscrito)}/kg)
                                  </p>
                                  <ParMargen precio={l.info!.precio} costo={costoEscrito} />
                                </div>
                              </>
                            )}
                          </div>
                          {precioSugerido != null && (
                            <p className="ayuda" style={{ margin: "4px 0 0 0" }}>
                              Precio sugerido (mismo % de recargo que antes): <strong>{formatoCLP(precioSugerido)}</strong>{" "}
                              <button type="button" className="boton-chico" onClick={() => actualizarLineaKilo(l.id, { precioNuevo: String(precioSugerido) })}>
                                Usar este precio
                              </button>
                            </p>
                          )}
                        </>
                      );
                    })()}
                    <div className="fila-inline">
                      <label className="ayuda">
                        Nuevo precio venta
                        <input type="number" min="1" className="input-chico" value={l.precioNuevo} onChange={(e) => actualizarLineaKilo(l.id, { precioNuevo: e.target.value })} />
                      </label>
                      <label className="ayuda">
                        Nuevo precio venta mayor
                        <input type="number" min="1" className="input-chico" value={l.precioMayorNuevo} onChange={(e) => actualizarLineaKilo(l.id, { precioMayorNuevo: e.target.value })} />
                      </label>
                      <button type="button" onClick={() => cambiarPrecios(l)}>
                        Actualizar precio(s)
                      </button>
                    </div>
                  </div>
                )}

                <label>
                  Cantidad de cajas
                  <input type="number" min="1" step="1" value={l.cantidadCajas} onChange={(e) => actualizarLineaKilo(l.id, { cantidadCajas: e.target.value })} />
                </label>

                <label>
                  ¿Cómo se sabe el peso?
                  <select value={l.modoPeso} onChange={(e) => actualizarLineaKilo(l.id, { modoPeso: e.target.value as "total" | "individual" })}>
                    <option value="individual">Se pesó cada caja (peso real)</option>
                    <option value="total">Solo se sabe el peso total (se reparte estimado)</option>
                  </select>
                </label>
                <label>
                  {l.modoPeso === "total" ? "Kilos (total del lote)" : "Kilos por caja"}
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={l.pesoValor}
                    onChange={(e) => actualizarLineaKilo(l.id, { pesoValor: e.target.value })}
                    placeholder={l.modoPeso === "total" ? "ej. 225" : "ej. 22.5"}
                  />
                </label>

                <label>
                  Valor neto por kilo
                  <input type="number" min="0.01" step="0.01" value={l.costoNetoKg} onChange={(e) => actualizarLineaKilo(l.id, { costoNetoKg: e.target.value })} placeholder="ej. 6500" />
                </label>

                <label className="fila-inline">
                  <input type="checkbox" checked={l.aplicaIvaCarne} onChange={(e) => actualizarLineaKilo(l.id, { aplicaIvaCarne: e.target.checked })} />
                  Aplica IVA carne (5%)
                </label>

                <p>
                  <strong>Subtotal línea:</strong> {formatoCLP(subtotalLineaKilo(l))}
                </p>
              </div>
            ))}
            <button type="button" className="boton" onClick={agregarLineaKilo}>
              + Agregar línea
            </button>
          </div>
        ) : (
          <div className="acciones-formulario">
            <h2>Líneas de la factura</h2>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Costo unitario</th>
                  <th>Subtotal</th>
                  <th>IVA carne (5%)</th>
                  <th>Margen</th>
                  <th>Umbral stock bajo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lineasUnidad.map((l) => {
                  const costoTipeado = Number(l.costoUnitario) || null;
                  return (
                    <tr key={l.id}>
                      <td>
                        <div className="buscador-producto">
                          <input
                            type="text"
                            placeholder="Buscar por PLU o nombre..."
                            value={l.producto ? l.producto.descripcion : l.buscarProducto}
                            onChange={(e) => buscarProductoLineaUnidad(l.id, e.target.value)}
                          />
                          {!l.producto && l.buscarProducto.trim() && (
                            <div className="resultados-busqueda">
                              {l.resultados.length === 0 && (
                                <div className="resultado-item ayuda">Sin resultados (solo productos congelados o por unidad)</div>
                              )}
                              {l.resultados.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className="resultado-item"
                                  onClick={() =>
                                    actualizarLineaUnidad(l.id, {
                                      producto: p,
                                      buscarProducto: "",
                                      resultados: [],
                                      aplicaIvaCarne: p.aplicaIvaCarne,
                                      umbralStockBajo: p.umbralStockBajo != null ? String(p.umbralStockBajo) : "",
                                    })
                                  }
                                >
                                  {p.plu} — {p.descripcion}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {l.producto && <p className="ayuda">Precio de venta: {formatoCLP(l.producto.precio)}</p>}
                      </td>
                      <td>
                        <input type="number" min="0.001" step="0.001" className="input-chico" value={l.cantidad} onChange={(e) => actualizarLineaUnidad(l.id, { cantidad: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" min="1" className="input-chico" value={l.costoUnitario} onChange={(e) => actualizarLineaUnidad(l.id, { costoUnitario: e.target.value })} />
                      </td>
                      <td>{formatoCLP(subtotalLineaUnidad(l))}</td>
                      <td>
                        {l.producto && (
                          <input
                            type="checkbox"
                            checked={l.aplicaIvaCarne}
                            onChange={(e) => actualizarLineaUnidad(l.id, { aplicaIvaCarne: e.target.checked })}
                            title="Aplicar el IVA adicional a la carne (5%) a esta línea"
                          />
                        )}
                      </td>
                      <td>{l.producto ? <ParMargen precio={l.producto.precio} costo={costoTipeado} /> : <span className="ayuda">—</span>}</td>
                      <td>
                        {l.producto && (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="input-chico"
                            placeholder="Sin umbral"
                            value={l.umbralStockBajo}
                            onChange={(e) => actualizarLineaUnidad(l.id, { umbralStockBajo: e.target.value })}
                            title="Se avisa cuando el stock llegue a este número o menos"
                          />
                        )}
                      </td>
                      <td>
                        <button type="button" className="boton-quitar-item" title="Quitar línea" onClick={() => quitarLineaUnidad(l.id)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="button" className="boton" onClick={agregarLineaUnidad}>
              + Agregar línea
            </button>
          </div>
        )}

        <div className="tarjeta" style={{ maxWidth: "320px" }}>
          <p>Neto total de la factura: {formatoCLP(totalNeto)}</p>
          <p>IVA (19%): {formatoCLP(iva)}</p>
          <p>
            IVA carne (5%): {formatoCLP(ivaCarne)}
            {subtotalCarne === 0 && <span className="ayuda"> (ninguna línea marcada)</span>}
          </p>
          <p>
            <strong>TOTAL factura: {formatoCLP(totalConImpuestos)}</strong>
          </p>
          <p className="ayuda">Compara este total contra el de la factura en papel para verificar que calcen.</p>
        </div>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar factura"}
          </button>
        </div>
      </form>
    </div>
  );
}
