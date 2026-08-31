import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  formatoCLP,
  redondearA10,
  TOLERANCIA_REDONDEO_EFECTIVO,
  type Comuna,
  type FlagBalanza,
  type MedioPago,
  type Producto,
  type Venta,
} from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { useEscanerCodigoBarras } from "../hooks/useEscanerCodigoBarras";
import { TecladoNumerico } from "../components/TecladoNumerico";
import ModalConfirmarClave from "../components/ModalConfirmarClave";
import { ValeVenta } from "../components/ValeVenta";
import { imprimirSilencioso } from "../lib/imprimir";
import ModalAlerta from "../components/ModalAlerta";

const ETIQUETAS_FLAG_BALANZA: Record<FlagBalanza, string> = {
  NORMAL: "Normal (unidad)",
  PESABLE: "Pesable",
  IMPORTE: "Importe",
};

export default function PuntoDeVenta() {
  const { usuario } = useUsuario();
  const navigate = useNavigate();

  const [venta, setVenta] = useState<Venta | null>(null);
  // Venta recién confirmada, guardada solo para imprimir el vale sola en
  // segundo plano — no se muestra en pantalla (ver ".vale-oculto-hasta-imprimir"
  // en styles.css), para que el cajero se quede en Punto de Venta listo para
  // la siguiente venta en vez de saltar a otra pantalla.
  const [ventaParaImprimir, setVentaParaImprimir] = useState<Venta | null>(null);
  // Vuelto a mostrar en el aviso emergente (antes un window.alert() del
  // navegador, sin estilo y bloqueante) — null cuando no hay ninguno que
  // mostrar. Mientras este popup esté abierto, la venta con vuelto TODAVÍA
  // no se confirma ni se imprime — eso pasa recién al apretar el botón
  // (o Enter), para darle tiempo al cajero de entregar el vuelto en mano
  // antes de que el ticket salga impreso (ver confirmarVentaConVuelto).
  const [vueltoAMostrar, setVueltoAMostrar] = useState<{
    ventaId: number;
    vuelto: number;
    entregado: number;
    venta: number;
  } | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [comunas, setComunas] = useState<Comuna[]>([]);
  const [mostrarSelectorComuna, setMostrarSelectorComuna] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [medioPago, setMedioPago] = useState<MedioPago>("efectivo");
  const [montoPago, setMontoPago] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [descuentoTipo, setDescuentoTipo] = useState<"porcentaje" | "monto_fijo">("porcentaje");
  const [descuentoValor, setDescuentoValor] = useState("");
  const [mostrarFormDescuento, setMostrarFormDescuento] = useState(false);
  const [itemDescuentoEditando, setItemDescuentoEditando] = useState<number | null>(null);
  const [itemDescuentoTipo, setItemDescuentoTipo] = useState<"porcentaje" | "monto_fijo">("porcentaje");
  const [itemDescuentoValor, setItemDescuentoValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [itemAAnular, setItemAAnular] = useState<number | null>(null);
  const [cancelandoVenta, setCancelandoVenta] = useState(false);
  const [mostrarBuscarProducto, setMostrarBuscarProducto] = useState(false);
  const [mostrarFormComentario, setMostrarFormComentario] = useState(false);
  const [comentarioValor, setComentarioValor] = useState("");
  // "Ir a pagar" — a pedido del usuario, para no tener los tres botones de
  // medio de pago siempre ocupando espacio en pantalla: se abren en una
  // ventana emergente (mismo estilo que el aviso de Vuelto) recién cuando
  // hace falta.
  const [mostrarModalPago, setMostrarModalPago] = useState(false);
  // Ítem del carrito cuyo precio se está editando (lápiz junto al precio) —
  // separado de itemAAnular porque no comparten el mismo flujo de
  // confirmación.
  const [itemEditandoPrecio, setItemEditandoPrecio] = useState<number | null>(null);
  const [precioNuevoValor, setPrecioNuevoValor] = useState("");
  const [itemAutorizandoPrecio, setItemAutorizandoPrecio] = useState<number | null>(null);
  // Cambio rápido de flag balanza (pesable/normal/importe) para el producto
  // que se está por agregar — igual patrón que el lápiz de precio, pero
  // sobre el producto elegido en el buscador, antes de escribir la
  // cantidad, para que quede en el modo correcto antes de vender.
  const [editandoFlagBalanza, setEditandoFlagBalanza] = useState(false);
  const [flagBalanzaNuevoValor, setFlagBalanzaNuevoValor] = useState<FlagBalanza>("NORMAL");
  const [autorizandoFlagBalanza, setAutorizandoFlagBalanza] = useState(false);

  const inputCantidadRef = useRef<HTMLInputElement>(null);
  const inputMontoPagoRef = useRef<HTMLInputElement>(null);
  const inputClienteNombreRef = useRef<HTMLInputElement>(null);
  const inputBuscarRef = useRef<HTMLInputElement>(null);
  const ventaRef = useRef<Venta | null>(null);

  const seccionBuscarRef = useRef<HTMLElement>(null);
  const seccionPagosRef = useRef<HTMLElement>(null);
  const seccionDespachoRef = useRef<HTMLElement>(null);
  const seccionDescuentoRef = useRef<HTMLElement>(null);
  const seccionComentarioRef = useRef<HTMLElement>(null);
  const mediosPagoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ventaRef.current = venta;
  }, [venta]);

  useEffect(() => {
    setMostrarSelectorComuna(venta?.esDespacho ?? false);
    setComentarioValor(venta?.comentario ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venta?.id]);


  // Imprime el vale de la venta que se acaba de confirmar, sin salir de
  // Punto de Venta — el vale se renderiza oculto en pantalla (ver
  // ".vale-oculto-hasta-imprimir" en styles.css) solo para que
  // imprimirSilencioso() tenga contenido que capturar.
  useEffect(() => {
    if (!ventaParaImprimir) return;
    imprimirSilencioso().finally(() => setVentaParaImprimir(null));
  }, [ventaParaImprimir]);

  useEffect(() => {
    iniciarVenta();
    api.comunas.listar().then(setComunas).catch((e) => setError(e.message));
  }, []);

  // Atajos de teclado para no ocupar espacio en pantalla ni depender del
  // mouse: F2 abre el buscador de productos, F3 el despacho a domicilio, F4
  // el descuento, F5 el comentario. Enter (sin ningún campo/botón con el
  // foco) salta directo a Pagos — pensado para después de terminar de
  // escanear los productos de la venta con el lector físico. Las flechas
  // ↑/↓ saltan directo entre las secciones completas (Buscar, Despacho,
  // Descuento, Comentario, Pagos), de a una por vez —
  // pero se ignoran si el foco está en un campo de texto/select/número, para
  // no pisar el comportamiento nativo (flechas del spinner, cambiar de
  // opción). Las flechas ←/→ eligen el medio de pago (Efectivo/Tarjeta/
  // Crédito) cuando el foco está sobre esos botones — se simula un click
  // sobre el botón correspondiente para reusar exactamente la misma lógica
  // que un click con mouse (ej. autocompletar el monto en Tarjeta), leyendo
  // cuál está activo desde el DOM en vez del estado de React (evita usar un
  // valor de medioPago "viejo" capturado por este efecto, que solo se
  // registra una vez al montar la pantalla). Ninguno de estos atajos afecta
  // al lector de código de barras (ignora todo lo que no sea un solo
  // carácter, ver useEscanerCodigoBarras).
  useEffect(() => {
    const secciones = [seccionBuscarRef, seccionDespachoRef, seccionDescuentoRef, seccionComentarioRef, seccionPagosRef];

    function enfocarPrimerCampo(el: HTMLElement | null) {
      if (!el) return;
      const focoInicial = el.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
      );
      focoInicial?.focus();
    }

    function manejarAtajos(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        setMostrarBuscarProducto(true);
        setTimeout(() => inputBuscarRef.current?.focus(), 0);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        setMostrarSelectorComuna((actual) => {
          const nuevo = !actual;
          if (!nuevo) actualizarDespacho(false, null);
          return nuevo;
        });
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setMostrarFormDescuento((actual) => !actual);
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        setMostrarFormComentario(true);
        return;
      }
      if (e.key === "Enter") {
        // Un Enter suelto (sin nada enfocado) abre el modal de "Ir a pagar"
        // directo, pensado para después de terminar de escanear los
        // productos de una venta con el lector físico. Se ignora si hay un
        // campo o botón con el foco — ese Enter ya tiene su propio
        // significado ahí (mandar un formulario, apretar el botón
        // enfocado) y no debe pisarse; una vez el modal está abierto, el
        // foco siempre queda en un botón o campo, así que este atajo no
        // vuelve a dispararse por error mientras se está pagando. Tampoco
        // se dispara durante un escaneo real: el lector
        // (useEscanerCodigoBarras) intercepta y detiene ese Enter antes de
        // que llegue acá.
        const activo = document.activeElement as HTMLElement | null;
        if (activo && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(activo.tagName)) return;
        e.preventDefault();
        setMostrarModalPago(true);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const activo = document.activeElement as HTMLElement | null;
        if (!mediosPagoRef.current?.contains(activo)) return;
        e.preventDefault();
        const botones = Array.from(mediosPagoRef.current.querySelectorAll("button"));
        const indiceActivo = botones.findIndex((b) => b.classList.contains("activo"));
        const total = botones.length;
        const siguiente = e.key === "ArrowRight" ? (indiceActivo + 1) % total : (indiceActivo - 1 + total) % total;
        const boton = botones[siguiente] as HTMLButtonElement | undefined;
        boton?.click();
        // El botón de Tarjeta mueve el foco al campo Monto con su propio
        // setTimeout(0) (para que Enter cobre al toque con mouse) — se
        // registra un setTimeout(0) propio después del click para recuperar
        // el foco en el botón y que las flechas sigan funcionando en cadena
        // (mismo delay, así que corre justo después por orden de registro).
        setTimeout(() => boton?.focus(), 0);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const activo = document.activeElement as HTMLElement | null;
        if (activo && ["INPUT", "SELECT", "TEXTAREA"].includes(activo.tagName)) return;
        const indiceActual = secciones.findIndex((ref) => ref.current?.contains(activo));
        let siguiente: number;
        if (e.key === "ArrowDown") {
          siguiente = indiceActual === -1 ? 0 : Math.min(indiceActual + 1, secciones.length - 1);
        } else {
          siguiente = indiceActual === -1 ? secciones.length - 1 : Math.max(indiceActual - 1, 0);
        }
        if (siguiente === indiceActual) return;
        e.preventDefault();
        enfocarPrimerCampo(secciones[siguiente].current);
      }
    }
    window.addEventListener("keydown", manejarAtajos);
    return () => window.removeEventListener("keydown", manejarAtajos);
  }, []);

  useEffect(() => {
    if (!buscar.trim()) {
      setProductos([]);
      return;
    }
    api.productos.listar({ buscar }).then(setProductos).catch((e) => setError(e.message));
  }, [buscar]);

  // Al abrir el modal de pago, el foco arranca en el medio de pago ya
  // activo (no en el monto) — así ← → funcionan de inmediato sin necesitar
  // un clic antes, igual que ya pasaba con los botones cuando estaban
  // siempre visibles en la pantalla.
  useEffect(() => {
    if (!mostrarModalPago) return;
    const activo = mediosPagoRef.current?.querySelector<HTMLButtonElement>(".activo");
    (activo ?? mediosPagoRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, [mostrarModalPago]);

  async function iniciarVenta() {
    if (!usuario) return;
    try {
      let actual = await api.caja.ventaAbierta();
      if (!actual) {
        try {
          actual = await api.caja.crearVenta(usuario.id);
        } catch {
          // Otra llamada (ej. doble carga de la pantalla) ya creó la venta
          // justo antes — se recupera esa en vez de mostrar un error.
          actual = await api.caja.ventaAbierta();
        }
      }
      setVenta(actual);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const itemsActivos = venta?.items.filter((i) => !i.anulado) ?? [];
  const totalPagado = venta?.pagos.reduce((s, p) => s + p.monto, 0) ?? 0;
  const totalVenta = venta?.total ?? 0;
  const faltaPagar = Math.round((totalVenta - totalPagado) * 100) / 100;
  // Un pago en efectivo se cobra redondeado a la decena más cercana (ver
  // redondearA10 en api.ts), así que puede dejar un resto de unos pocos
  // pesos entre el total exacto y lo realmente cobrado — no es un pago
  // incompleto, es el redondeo legal. Se tolera ese resto solo cuando la
  // venta tiene al menos un pago en efectivo.
  const hayPagoEfectivo = venta?.pagos.some((p) => p.medio === "efectivo") ?? false;
  const faltaPagarCubierto =
    faltaPagar === 0 || (hayPagoEfectivo && Math.abs(faltaPagar) <= TOLERANCIA_REDONDEO_EFECTIVO);

  // Solo puede haber un tipo de descuento activo por venta: a toda la venta
  // o por producto, no los dos a la vez (más claro para el registro).
  const hayDescuentoVenta = !!venta?.descuentoTipo;
  const hayDescuentoItem = itemsActivos.some((i) => i.descuentoTipo);

  // Solo para mostrar el monto del descuento ya aplicado — el cálculo real
  // (el que define el total) lo hace el servidor.
  const subtotalItems = itemsActivos.reduce((s, i) => s + i.subtotal, 0);
  let descuentoAplicadoMonto = 0;
  if (venta?.descuentoTipo === "porcentaje" && venta.descuentoValor) {
    descuentoAplicadoMonto = Math.round(subtotalItems * (venta.descuentoValor / 100));
  } else if (venta?.descuentoTipo === "monto_fijo" && venta.descuentoValor) {
    descuentoAplicadoMonto = venta.descuentoValor;
  }
  descuentoAplicadoMonto = Math.min(descuentoAplicadoMonto, subtotalItems);

  function elegirProducto(p: Producto) {
    setProductoSeleccionado(p);
    setBuscar("");
    setProductos([]);
    setEditandoFlagBalanza(false);
    setTimeout(() => inputCantidadRef.current?.focus(), 0);
  }

  async function agregarItem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    if (!venta || !productoSeleccionado) {
      setError("Elige un producto");
      return;
    }
    const cant = Number(cantidad);
    if (!cant || cant <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }
    try {
      const actualizada = await api.caja.agregarItem(venta.id, { productoId: productoSeleccionado.id, cantidad: cant });
      setVenta(actualizada);
      setProductoSeleccionado(null);
      setCantidad("");
      setBuscar("");
      // Se cierra solo, igual que Despacho/Descuento/Comentario cuando no se
      // están usando — el buscador manual es el respaldo del lector de
      // código de barras, no hace falta dejarlo abierto ocupando espacio
      // después de agregar el producto (F2 lo vuelve a abrir al toque).
      setMostrarBuscarProducto(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const escanearCodigo = useCallback(async (codigo: string) => {
    setError(null);
    setMensaje(null);
    const ventaActual = ventaRef.current;
    if (!ventaActual) return;
    try {
      const actualizada = await api.caja.escanearCodigo(ventaActual.id, codigo);
      const nuevo = actualizada.items[actualizada.items.length - 1];
      setMensaje(nuevo ? `Agregado: ${nuevo.producto.descripcion} (${nuevo.cantidad})` : "Producto agregado");
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEscanerCodigoBarras(escanearCodigo, !!venta);

  // Anular un ítem del carrito siempre pide clave de supervisor y el nombre
  // de quien autoriza (no necesariamente el cajero con la sesión abierta),
  // vía el modal ModalConfirmarClave — se abre marcando itemAAnular.
  async function confirmarAnularItem(usuarioId: number, clave: string, motivo?: string) {
    if (!venta || itemAAnular == null) return;
    setMensaje(null);
    const actualizada = await api.caja.anularItem(venta.id, itemAAnular, { clave, usuarioId, motivo });
    setVenta(actualizada);
    setMensaje("Ítem anulado");
    setItemAAnular(null);
  }

  // Cambio rápido de precio desde el carrito (lápiz junto al precio) — a
  // pedido del usuario, cambia el precio real del producto en el catálogo
  // (mismo endpoint que usa Productos → editar), pero a diferencia de esos
  // otros lugares, acá SÍ pide clave de supervisor: es un cambio hecho al
  // vuelo con el cliente esperando, más fácil de apurar sin pensarlo dos
  // veces que editarlo desde la ficha del producto.
  async function confirmarCambioPrecioItem(usuarioId: number, clave: string, motivo?: string) {
    if (!venta || itemAutorizandoPrecio == null) return;
    const item = venta.items.find((i) => i.id === itemAutorizandoPrecio);
    if (!item) return;
    const nuevoPrecio = Number(precioNuevoValor);
    setMensaje(null);
    await api.precios.cambiarIndividual({
      productoId: item.productoId,
      precioNuevo: nuevoPrecio,
      usuarioId,
      clave,
      motivoAutorizacion: motivo,
    });
    setMensaje(`Precio de ${item.producto.descripcion} actualizado a ${formatoCLP(nuevoPrecio)}`);
    setItemAutorizandoPrecio(null);
    setItemEditandoPrecio(null);
    setPrecioNuevoValor("");
    // Refresca la venta para que el precio mostrado en el carrito (el del
    // catálogo, no el ya cobrado en esta línea) quede al día.
    const actualizada = await api.caja.obtenerVenta(venta.id);
    setVenta(actualizada);
  }

  // Cambio rápido de flag balanza desde Caja — a pedido del usuario, para
  // no tener que ir hasta Productos cada vez que hace falta ajustar si algo
  // se vende pesable/normal/importe. Igual que el cambio de precio de acá
  // mismo, pide clave de supervisor porque afecta cómo se calcula el precio
  // de ahí en adelante (no solo de esta venta).
  async function confirmarCambioFlagBalanza(usuarioId: number, clave: string, motivo?: string) {
    if (!productoSeleccionado) return;
    const actualizado = await api.productos.cambiarFlagBalanza(productoSeleccionado.id, {
      flagBalanza: flagBalanzaNuevoValor,
      usuarioId,
      clave,
      motivoAutorizacion: motivo,
    });
    setMensaje(`${actualizado.descripcion}: ahora es "${ETIQUETAS_FLAG_BALANZA[actualizado.flagBalanza]}"`);
    setProductoSeleccionado(actualizado);
    setAutorizandoFlagBalanza(false);
    setEditandoFlagBalanza(false);
  }

  // En efectivo, el cajero escribe lo que el cliente entregó en la mano — no
  // necesariamente el monto exacto de la venta. Solo se registra como pago
  // lo que realmente cubre lo que falta; el resto se muestra como vuelto,
  // sin guardarse en ningún lado (no es dinero que se queda en la caja).
  // Por la Ley del Redondeo, en efectivo lo que se cobra se redondea a la
  // decena más cercana (ver redondearA10 en api.ts) — el vuelto se calcula
  // sobre ese monto ya redondeado, no sobre el total exacto.
  const faltaPagarPositivo = Math.max(faltaPagar, 0);
  const montoACobrarEfectivo = redondearA10(faltaPagarPositivo);
  const montoIngresado = Number(montoPago) || 0;
  const vueltoPreview =
    medioPago === "efectivo" && montoIngresado > montoACobrarEfectivo ? montoIngresado - montoACobrarEfectivo : 0;

  async function agregarPago(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!venta) return;
    const monto = Number(montoPago);
    if (!monto || monto <= 0) {
      setError("El monto debe ser mayor a 0");
      return;
    }
    if (medioPago === "credito" && !clienteNombre.trim()) {
      setError("Falta el nombre del cliente para dejarlo a crédito");
      return;
    }
    // No más de lo que efectivamente se debe (ya redondeado) — si lo
    // entregado es menor a eso (ej. un pago parcial), se registra tal cual
    // lo que se entregó, sin redondear, y el resto sigue quedando pendiente.
    const montoACobrar = medioPago === "efectivo" ? Math.min(monto, montoACobrarEfectivo) : monto;
    if (montoACobrar <= 0) {
      setError("Ya no falta nada por pagar");
      return;
    }
    const vueltoAEntregar = vueltoPreview;
    try {
      const actualizada = await api.caja.agregarPago(venta.id, {
        medio: medioPago,
        monto: montoACobrar,
        clienteNombre: medioPago === "credito" ? clienteNombre.trim() : undefined,
        montoEntregado: medioPago === "efectivo" ? monto : undefined,
      });
      setVenta(actualizada);
      setMontoPago("");
      setClienteNombre("");
      // Si este pago ya deja los pagos cubriendo el total completo (el caso
      // normal: un solo pago que paga toda la venta), se confirma sola — a
      // pedido del usuario, para no tener que cerrar esta ventana y apretar
      // "Confirmar venta" aparte cada vez. Se recalcula acá con los datos
      // recién llegados del servidor (actualizada), no con el estado
      // "venta" viejo que todavía no se actualizó en este mismo render.
      const totalPagadoAhora = actualizada.pagos.reduce((s, p) => s + p.monto, 0);
      const faltaAhora = Math.round((actualizada.total - totalPagadoAhora) * 100) / 100;
      const hayEfectivoAhora = actualizada.pagos.some((p) => p.medio === "efectivo");
      const cubiertoAhora =
        faltaAhora === 0 || (hayEfectivoAhora && Math.abs(faltaAhora) <= TOLERANCIA_REDONDEO_EFECTIVO);
      if (vueltoAEntregar > 0) {
        // Con vuelto de por medio, la venta queda pagada pero SIN confirmar
        // todavía: hay que darle tiempo al cajero de entregar el vuelto al
        // cliente antes de que salga el ticket. Se confirma recién al
        // cerrar este popup (ver confirmarVentaConVuelto).
        setVueltoAMostrar({ ventaId: actualizada.id, vuelto: vueltoAEntregar, entregado: monto, venta: montoACobrar });
      } else if (cubiertoAhora) {
        await ejecutarConfirmarVenta(actualizada.id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function actualizarDespacho(esDespacho: boolean, comunaId: number | null) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarDespacho(venta.id, { esDespacho, comunaId });
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function aplicarDescuento(e: React.FormEvent) {
    e.preventDefault();
    if (!venta) return;
    setError(null);
    const valor = Number(descuentoValor);
    if (!valor || valor <= 0) {
      setError("Ingresa un descuento válido");
      return;
    }
    try {
      const actualizada = await api.caja.actualizarDescuento(venta.id, { tipo: descuentoTipo, valor });
      setVenta(actualizada);
      setDescuentoValor("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarDescuento() {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarDescuento(venta.id, { tipo: null, valor: null });
      setVenta(actualizada);
      setMostrarFormDescuento(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function aplicarDescuentoItem(itemId: number) {
    if (!venta) return;
    setError(null);
    const valor = Number(itemDescuentoValor);
    if (!valor || valor <= 0) {
      setError("Ingresa un descuento válido");
      return;
    }
    try {
      const actualizada = await api.caja.actualizarDescuentoItem(venta.id, itemId, { tipo: itemDescuentoTipo, valor });
      setVenta(actualizada);
      setItemDescuentoEditando(null);
      setItemDescuentoValor("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarDescuentoItem(itemId: number) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarDescuentoItem(venta.id, itemId, { tipo: null, valor: null });
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarComentario(e: React.FormEvent) {
    e.preventDefault();
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarComentario(venta.id, comentarioValor.trim() || null);
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarComentario() {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.actualizarComentario(venta.id, null);
      setVenta(actualizada);
      setComentarioValor("");
      setMostrarFormComentario(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function quitarPago(pagoId: number) {
    if (!venta) return;
    setError(null);
    try {
      const actualizada = await api.caja.quitarPago(venta.id, pagoId);
      setVenta(actualizada);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Lógica real de confirmar una venta — compartida entre el botón manual
  // "Confirmar venta" (con su propio window.confirm antes de llamar acá) y
  // el auto-confirmado que dispara agregarPago cuando un pago recién
  // agregado ya cubre el total completo (ver más abajo): en ese caso no
  // hace falta preguntar de nuevo, ya quedó claro con el pago mismo.
  async function ejecutarConfirmarVenta(ventaId: number) {
    if (!usuario) return;
    setError(null);
    setProcesando(true);
    try {
      await api.caja.confirmarVenta(ventaId, usuario.id);
      // A pedido del usuario: en vez de saltar a "Buscar venta" para
      // imprimir, el vale se imprime solo en segundo plano (ver el efecto
      // que observa ventaParaImprimir) y la pantalla se queda en Punto de
      // Venta lista para la siguiente venta, para no perder tiempo yendo y
      // volviendo entre pantallas.
      const ventaConfirmada = await api.caja.obtenerVenta(ventaId);
      setVentaParaImprimir(ventaConfirmada);
      setMostrarModalPago(false);
      await iniciarVenta();
      setMensaje(`Venta #${ventaId} confirmada — imprimiendo vale...`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcesando(false);
    }
  }

  async function confirmarVenta() {
    if (!venta || !usuario) return;
    const confirmado = window.confirm(`¿Confirmar venta por ${formatoCLP(totalVenta)}?`);
    if (!confirmado) return;
    await ejecutarConfirmarVenta(venta.id);
  }

  // Se llama al cerrar el popup de vuelto (botón o Enter, ver autoFocus más
  // abajo) — recién ahí se confirma la venta y se dispara la impresión, una
  // vez que el cajero ya le entregó el vuelto en mano al cliente.
  async function confirmarVentaConVuelto() {
    if (!vueltoAMostrar) return;
    const ventaId = vueltoAMostrar.ventaId;
    setVueltoAMostrar(null);
    await ejecutarConfirmarVenta(ventaId);
  }

  // Igual que anular un ítem, cancelar toda la venta pide clave de
  // supervisor y el nombre de quien autoriza, vía ModalConfirmarClave.
  async function confirmarCancelarVenta(usuarioId: number, clave: string, motivo?: string) {
    if (!venta) return;
    await api.caja.cancelarVenta(venta.id, { usuarioId, clave, motivo });
    navigate("/caja");
  }

  if (!venta) {
    return (
      <>
        <div className="punto-de-venta no-imprimir">
          <h1>Punto de venta</h1>
          {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
          <p>Cargando...</p>
        </div>
        <div className="vale-oculto-hasta-imprimir">{ventaParaImprimir && <ValeVenta venta={ventaParaImprimir} />}</div>
      </>
    );
  }

  return (
    <>
    <div className="punto-de-venta no-imprimir">
      <div className="encabezado-venta">
        <h1>Punto de venta</h1>
        <div className="total-venta-destacado">Total: {formatoCLP(totalVenta)}</div>
      </div>
      {error && <ModalAlerta mensaje={error} onCerrar={() => setError(null)} />}
      {mensaje && <p className="exito">{mensaje}</p>}

      <p className="ayuda ayuda-linea">🔦 Lector de código de barras listo — escanea en cualquier momento.</p>

      <div className="punto-de-venta-layout">
        <div className="columna-izquierda">
          <section ref={seccionBuscarRef} className="tarjeta tarjeta-compacta">
            {!mostrarBuscarProducto ? (
              <button
                type="button"
                onClick={() => {
                  setMostrarBuscarProducto(true);
                  setTimeout(() => inputBuscarRef.current?.focus(), 0);
                }}
              >
                + Buscar producto (F2)
              </button>
            ) : (
              <>
                <div className="fila-inline" style={{ justifyContent: "space-between" }}>
                  <h2>Agregar producto manualmente</h2>
                  <button type="button" onClick={() => setMostrarBuscarProducto(false)}>
                    Cerrar
                  </button>
                </div>
                <form onSubmit={agregarItem} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  <div className="buscador-producto">
                    <input
                      ref={inputBuscarRef}
                      type="text"
                      placeholder="Buscar por PLU o nombre..."
                      value={buscar}
                      onChange={(e) => {
                        setBuscar(e.target.value);
                        setProductoSeleccionado(null);
                      }}
                    />
                    {buscar.trim() && (
                      <div className="resultados-busqueda">
                        {productos.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                        {productos.map((p) => (
                          <button key={p.id} type="button" className="resultado-item" onClick={() => elegirProducto(p)}>
                            {p.plu} — {p.descripcion} ({formatoCLP(p.precio)}, stock: {p.stockActual})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {productoSeleccionado && !editandoFlagBalanza && (
                    <span className="exito fila-inline">
                      Vendiendo: {productoSeleccionado.descripcion} ({formatoCLP(productoSeleccionado.precio)}) —{" "}
                      {ETIQUETAS_FLAG_BALANZA[productoSeleccionado.flagBalanza]}
                      <button
                        type="button"
                        className="boton-chico"
                        title="Cambiar si es pesable, normal o importe"
                        onClick={() => {
                          setFlagBalanzaNuevoValor(productoSeleccionado.flagBalanza);
                          setEditandoFlagBalanza(true);
                        }}
                      >
                        ⚖️✏️
                      </button>
                    </span>
                  )}
                  {productoSeleccionado && editandoFlagBalanza && (
                    <span className="fila-inline">
                      Cambiar a:
                      <select
                        value={flagBalanzaNuevoValor}
                        onChange={(e) => setFlagBalanzaNuevoValor(e.target.value as FlagBalanza)}
                      >
                        <option value="NORMAL">Normal (unidad)</option>
                        <option value="PESABLE">Pesable</option>
                        <option value="IMPORTE">Importe</option>
                      </select>
                      <button
                        type="button"
                        className="boton-chico boton-primario"
                        onClick={() => {
                          if (flagBalanzaNuevoValor === productoSeleccionado.flagBalanza) {
                            setEditandoFlagBalanza(false);
                            return;
                          }
                          setAutorizandoFlagBalanza(true);
                        }}
                      >
                        Guardar
                      </button>
                      <button type="button" className="boton-chico" onClick={() => setEditandoFlagBalanza(false)}>
                        Cancelar
                      </button>
                    </span>
                  )}
                  <input
                    ref={inputCantidadRef}
                    type="number"
                    min="0.001"
                    step="0.001"
                    placeholder="Cantidad"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                  />
                  <TecladoNumerico valor={cantidad} onCambiar={setCantidad} />
                  <button type="submit" className="boton boton-primario">
                    Agregar al carrito
                  </button>
                </form>
              </>
            )}
          </section>

          <section ref={seccionPagosRef} className="tarjeta">
            <h2>Pagos</h2>
            <p className={`falta-pagar ${faltaPagarCubierto ? "cubierto" : ""}`}>
              {faltaPagarCubierto && itemsActivos.length > 0 ? (
                <span className="exito">Pagos cubren el total ✓</span>
              ) : faltaPagar > 0 ? (
                <span className="error">Falta pagar: {formatoCLP(faltaPagar)}</span>
              ) : faltaPagar < 0 ? (
                <span className="error">Los pagos superan el total en {formatoCLP(-faltaPagar)}</span>
              ) : (
                <span className="ayuda">Sin pagos registrados</span>
              )}
            </p>
            {venta.pagos.length > 0 && (
              <ul className="lista-pagos-mini">
                {venta.pagos.map((p) => (
                  <li key={p.id}>
                    {p.medio === "efectivo" ? "Efectivo" : p.medio === "tarjeta" ? "Tarjeta" : `Crédito (${p.clienteNombre})`}:{" "}
                    {formatoCLP(p.monto)}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="boton boton-primario boton-ancho"
              disabled={itemsActivos.length === 0}
              onClick={() => setMostrarModalPago(true)}
            >
              Ir a pagar <span className="ayuda">(Enter)</span>
            </button>
          </section>

          {mostrarModalPago && (
            <div className="modal-fondo">
              <div className="modal-contenido tarjeta">
                <div className="fila-inline" style={{ justifyContent: "space-between" }}>
                  <h2>Agregar pago</h2>
                  <button type="button" className="boton-chico" onClick={() => setMostrarModalPago(false)}>
                    Listo
                  </button>
                </div>
                <div className="medios-pago" ref={mediosPagoRef}>
                  <button
                    type="button"
                    className={`medio-pago-tile ${medioPago === "efectivo" ? "activo" : ""}`}
                    onClick={() => {
                      setMedioPago("efectivo");
                      // Igual que Tarjeta/Crédito: deja el foco listo en el campo
                      // que falta llenar (acá no hay monto para autocompletar,
                      // el cajero escribe lo que el cliente entregó) — antes se
                      // quedaba en el botón y Enter no hacía nada, obligando a
                      // hacer clic a mano en el campo.
                      setTimeout(() => inputMontoPagoRef.current?.focus(), 0);
                    }}
                  >
                    <span className="medio-pago-icono">💵</span>
                    Efectivo
                  </button>
                  <button
                    type="button"
                    className={`medio-pago-tile ${medioPago === "tarjeta" ? "activo" : ""}`}
                    onClick={() => {
                      setMedioPago("tarjeta");
                      // En tarjeta siempre se cobra el monto exacto — se autocompleta
                      // lo que falta pagar para no tener que escribirlo a mano, y se
                      // deja el foco listo para que Enter agregue el pago al toque.
                      if (faltaPagarPositivo > 0) setMontoPago(String(faltaPagarPositivo));
                      setTimeout(() => inputMontoPagoRef.current?.focus(), 0);
                    }}
                  >
                    <span className="medio-pago-icono">💳</span>
                    Tarjeta
                  </button>
                  <button
                    type="button"
                    className={`medio-pago-tile ${medioPago === "credito" ? "activo" : ""}`}
                    onClick={() => {
                      setMedioPago("credito");
                      // Igual que Tarjeta: el crédito también se deja siempre por
                      // el monto exacto que falta, no tiene sentido escribirlo a
                      // mano cada vez. El foco queda en el nombre del cliente (el
                      // único dato que falta completar) para que Enter ahí mismo
                      // agregue el pago.
                      if (faltaPagarPositivo > 0) setMontoPago(String(faltaPagarPositivo));
                      setTimeout(() => inputClienteNombreRef.current?.focus(), 0);
                    }}
                  >
                    <span className="medio-pago-icono">🧾</span>
                    Crédito
                  </button>
                </div>
                <p className="ayuda ayuda-linea">Usa ← → y Enter para elegir sin mouse.</p>
                {medioPago === "efectivo" && montoACobrarEfectivo > 0 && montoACobrarEfectivo !== faltaPagarPositivo && (
                  <p className="ayuda ayuda-linea">
                    A cobrar en efectivo (redondeo): <strong>{formatoCLP(montoACobrarEfectivo)}</strong>
                  </p>
                )}
                <form onSubmit={agregarPago} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  {medioPago === "credito" && (
                    <input
                      ref={inputClienteNombreRef}
                      type="text"
                      placeholder="Nombre del cliente"
                      value={clienteNombre}
                      onChange={(e) => setClienteNombre(e.target.value)}
                    />
                  )}
                  <input
                    ref={inputMontoPagoRef}
                    type="number"
                    min="1"
                    placeholder={medioPago === "efectivo" ? "Efectivo recibido" : "Monto"}
                    value={montoPago}
                    onChange={(e) => setMontoPago(e.target.value)}
                  />
                  <TecladoNumerico valor={montoPago} onCambiar={setMontoPago} />
                  <button type="submit">Agregar pago</button>
                  {vueltoPreview > 0 && <span className="exito">Vuelto: {formatoCLP(vueltoPreview)}</span>}
                </form>
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Medio</th>
                      <th>Monto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {venta.pagos.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.medio === "efectivo" ? "Efectivo" : p.medio === "tarjeta" ? "Tarjeta" : `Crédito (${p.clienteNombre})`}
                        </td>
                        <td>{formatoCLP(p.monto)}</td>
                        <td>
                          <button type="button" onClick={() => quitarPago(p.id)}>
                            Quitar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {venta.pagos.length === 0 && (
                      <tr>
                        <td colSpan={3}>Todavía no hay pagos registrados.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p>
                  {!faltaPagarCubierto && faltaPagar > 0 && (
                    <span className="error">Falta pagar: {formatoCLP(faltaPagar)}</span>
                  )}
                  {!faltaPagarCubierto && faltaPagar < 0 && (
                    <span className="error">Los pagos superan el total en {formatoCLP(-faltaPagar)}</span>
                  )}
                  {faltaPagarCubierto && itemsActivos.length > 0 && (
                    <span className="exito">
                      Los pagos cubren el total.
                      {faltaPagar !== 0 && " (redondeo por pago en efectivo)"}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="acciones-formulario fila-inline">
            <button
              type="button"
              className="boton boton-primario"
              disabled={procesando || !faltaPagarCubierto || itemsActivos.length === 0}
              onClick={confirmarVenta}
            >
              {procesando ? "Confirmando..." : "Confirmar venta"}
            </button>
            <button type="button" onClick={() => setCancelandoVenta(true)}>
              Cancelar venta
            </button>
          </div>
        </div>

        <div className="columna-derecha">
          <section className="tarjeta">
            <div className="encabezado-carrito">
              <h2>Carrito</h2>
              <span className="contador-items">
                {itemsActivos.length} {itemsActivos.length === 1 ? "ítem" : "ítems"}
              </span>
            </div>
            <div className="carrito-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th className="col-producto">Producto</th>
                  <th className="col-cant">Cant.</th>
                  <th className="col-precio">Precio</th>
                  <th className="col-subtotal">Subtotal</th>
                  <th className="col-acciones"></th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((item) => {
                  const rawSubtotal = Math.round(item.precioUnitario * item.cantidad);
                  const descuentoMontoItem = rawSubtotal - item.subtotal;
                  return (
                    <Fragment key={item.id}>
                      <tr className={item.anulado ? "fila-error" : ""}>
                        <td className="col-producto celda-truncada" title={item.producto.descripcion}>
                          {item.producto.descripcion}
                        </td>
                        <td>{item.cantidad}</td>
                        <td>
                          {item.anulado ? (
                            formatoCLP(item.precioUnitario)
                          ) : (
                            <span className="precio-con-lapiz">
                              {formatoCLP(item.precioUnitario)}
                              <button
                                type="button"
                                className="boton-lapiz"
                                title="Cambiar precio del producto en el catálogo"
                                onClick={() => {
                                  if (itemEditandoPrecio === item.id) {
                                    setItemEditandoPrecio(null);
                                    return;
                                  }
                                  setItemEditandoPrecio(item.id);
                                  setPrecioNuevoValor(String(item.producto.precio));
                                }}
                              >
                                ✏️
                              </button>
                            </span>
                          )}
                        </td>
                        <td>
                          {formatoCLP(item.subtotal)}
                          {!item.anulado && item.descuentoTipo && (
                            <div className="ayuda">-{formatoCLP(descuentoMontoItem)} desc.</div>
                          )}
                        </td>
                        <td>
                          {item.anulado ? (
                            "Anulado"
                          ) : (
                            <span className="fila-inline" style={{ flexWrap: "nowrap" }}>
                              {item.descuentoTipo ? (
                                <button
                                  type="button"
                                  className="boton-chico"
                                  title="Quitar descuento"
                                  onClick={() => quitarDescuentoItem(item.id)}
                                >
                                  🏷️✕
                                </button>
                              ) : (
                                !hayDescuentoVenta && (
                                  <button
                                    type="button"
                                    className="boton-chico"
                                    title="Agregar descuento"
                                    onClick={() => {
                                      setItemDescuentoEditando(itemDescuentoEditando === item.id ? null : item.id);
                                      setItemDescuentoValor("");
                                    }}
                                  >
                                    🏷️
                                  </button>
                                )
                              )}
                              <button
                                type="button"
                                className="boton-quitar-item"
                                title="Quitar del carrito"
                                onClick={() => setItemAAnular(item.id)}
                              >
                                ✕
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                      {itemDescuentoEditando === item.id && (
                        <tr>
                          <td colSpan={5}>
                            <span className="fila-inline">
                              Descuento para {item.producto.descripcion}:
                              <select
                                value={itemDescuentoTipo}
                                onChange={(e) => setItemDescuentoTipo(e.target.value as "porcentaje" | "monto_fijo")}
                              >
                                <option value="porcentaje">%</option>
                                <option value="monto_fijo">$</option>
                              </select>
                              <input
                                type="number"
                                min="1"
                                className="input-chico"
                                placeholder={itemDescuentoTipo === "porcentaje" ? "10" : "500"}
                                value={itemDescuentoValor}
                                onChange={(e) => setItemDescuentoValor(e.target.value)}
                                autoFocus
                              />
                              <button type="button" className="boton-chico" onClick={() => aplicarDescuentoItem(item.id)}>
                                OK
                              </button>
                              <button type="button" className="boton-chico" onClick={() => setItemDescuentoEditando(null)}>
                                Cancelar
                              </button>
                            </span>
                          </td>
                        </tr>
                      )}
                      {itemEditandoPrecio === item.id && (
                        <tr className="fila-edicion-precio">
                          <td colSpan={5}>
                            <span className="fila-inline">
                              Nuevo precio de venta para {item.producto.descripcion}:
                              <input
                                type="number"
                                min="1"
                                className="input-chico"
                                value={precioNuevoValor}
                                onChange={(e) => setPrecioNuevoValor(e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="boton-chico boton-primario"
                                onClick={() => {
                                  const nuevo = Number(precioNuevoValor);
                                  if (!nuevo || nuevo <= 0) {
                                    setError("El precio nuevo debe ser mayor a 0");
                                    return;
                                  }
                                  setError(null);
                                  setItemAutorizandoPrecio(item.id);
                                }}
                              >
                                Guardar
                              </button>
                              <button type="button" className="boton-chico" onClick={() => setItemEditandoPrecio(null)}>
                                Cancelar
                              </button>
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {itemsActivos.length === 0 && (
                  <tr>
                    <td colSpan={5}>Todavía no hay productos en el carrito.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            {venta.descuentoTipo && (
              <p>
                Subtotal: {formatoCLP(subtotalItems)} · Descuento: -{formatoCLP(descuentoAplicadoMonto)}
                {venta.costoEnvio ? ` · Envío: ${formatoCLP(venta.costoEnvio)}` : ""}
              </p>
            )}
          </section>

          <section ref={seccionDespachoRef} className="tarjeta tarjeta-mini">
            {!mostrarSelectorComuna ? (
              <button type="button" className="boton-chico" onClick={() => setMostrarSelectorComuna(true)}>
                + Despacho a domicilio (F3)
              </button>
            ) : (
              <>
                <h2>Despacho</h2>
                <label className="fila-inline" style={{ marginBottom: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={mostrarSelectorComuna}
                    onChange={(e) => {
                      setMostrarSelectorComuna(e.target.checked);
                      if (!e.target.checked) actualizarDespacho(false, null);
                    }}
                  />
                  Es despacho a domicilio
                </label>
                <select
                  value={venta.comunaId ?? ""}
                  onChange={(e) => {
                    const comunaId = e.target.value ? Number(e.target.value) : null;
                    if (comunaId) actualizarDespacho(true, comunaId);
                  }}
                >
                  <option value="">Elegir comuna...</option>
                  {comunas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} ({formatoCLP(c.costoEnvio)})
                    </option>
                  ))}
                </select>
              </>
            )}
          </section>

          <section ref={seccionDescuentoRef} className="tarjeta tarjeta-mini">
            {venta.descuentoTipo ? (
              <>
                <h2>Descuento</h2>
                <p className="fila-inline">
                  <span className="exito">
                    Descuento aplicado:{" "}
                    {venta.descuentoTipo === "porcentaje" ? `${venta.descuentoValor}%` : formatoCLP(venta.descuentoValor!)}{" "}
                    (-{formatoCLP(descuentoAplicadoMonto)})
                  </span>
                  <button type="button" className="boton-chico" onClick={quitarDescuento}>
                    Quitar descuento
                  </button>
                </p>
              </>
            ) : hayDescuentoItem ? (
              <p className="ayuda">Hay descuentos por producto — quítalos para descontar toda la venta.</p>
            ) : !mostrarFormDescuento ? (
              <button type="button" className="boton-chico" onClick={() => setMostrarFormDescuento(true)}>
                + Agregar descuento (F4)
              </button>
            ) : (
              <>
                <h2>Descuento</h2>
                <form onSubmit={aplicarDescuento} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  <select value={descuentoTipo} onChange={(e) => setDescuentoTipo(e.target.value as "porcentaje" | "monto_fijo")}>
                    <option value="porcentaje">Porcentaje (%)</option>
                    <option value="monto_fijo">Monto fijo ($)</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    placeholder={descuentoTipo === "porcentaje" ? "Ej: 10" : "Ej: 2000"}
                    value={descuentoValor}
                    onChange={(e) => setDescuentoValor(e.target.value)}
                  />
                  <button type="submit">Aplicar descuento</button>
                </form>
              </>
            )}
          </section>

          <section ref={seccionComentarioRef} className="tarjeta tarjeta-mini">
            {venta.comentario ? (
              <>
                <h2>Comentario</h2>
                <p className="fila-inline">
                  <span>{venta.comentario}</span>
                  <button type="button" className="boton-chico" onClick={() => setMostrarFormComentario(true)}>
                    Editar
                  </button>
                  <button type="button" className="boton-chico" onClick={quitarComentario}>
                    Quitar
                  </button>
                </p>
              </>
            ) : !mostrarFormComentario ? (
              <button type="button" className="boton-chico" onClick={() => setMostrarFormComentario(true)}>
                + Comentario (F5)
              </button>
            ) : (
              <>
                <h2>Comentario</h2>
                <form onSubmit={guardarComentario} onKeyDown={manejarEnterComoTab} className="fila-inline">
                  <input
                    type="text"
                    placeholder="Ej: cliente pidió sin hueso"
                    maxLength={500}
                    value={comentarioValor}
                    onChange={(e) => setComentarioValor(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="boton-chico">
                    Guardar
                  </button>
                  <button type="button" className="boton-chico" onClick={() => setMostrarFormComentario(false)}>
                    Cerrar
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </div>

      {itemAAnular != null && (
        <ModalConfirmarClave
          titulo="Anular producto"
          descripcion="Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={[
            "Ítem duplicado",
            "Cliente canceló ese producto",
            "Precio equivocado",
            "Producto equivocado",
            "Error de peso o cantidad",
          ]}
          onConfirmar={confirmarAnularItem}
          onCancelar={() => setItemAAnular(null)}
        />
      )}

      {itemAutorizandoPrecio != null &&
        (() => {
          const item = venta.items.find((i) => i.id === itemAutorizandoPrecio);
          const nuevo = Number(precioNuevoValor);
          return (
            <ModalConfirmarClave
              titulo="Autorizar cambio de precio"
              descripcion={
                item
                  ? `${item.producto.descripcion}: de ${formatoCLP(item.producto.precio)} a ${formatoCLP(nuevo)}. Este precio queda para todas las ventas futuras, no solo esta.`
                  : undefined
              }
              motivoOpciones={["Precio desactualizado", "Error de tipeo", "Ajuste puntual para el cliente"]}
              onConfirmar={confirmarCambioPrecioItem}
              onCancelar={() => setItemAutorizandoPrecio(null)}
            />
          );
        })()}

      {autorizandoFlagBalanza && productoSeleccionado && (
        <ModalConfirmarClave
          titulo="Autorizar cambio de flag balanza"
          descripcion={`${productoSeleccionado.descripcion}: de "${ETIQUETAS_FLAG_BALANZA[productoSeleccionado.flagBalanza]}" a "${ETIQUETAS_FLAG_BALANZA[flagBalanzaNuevoValor]}". Este cambio queda para todas las ventas futuras, no solo esta, y puede afectar el precio.`}
          motivoOpciones={[
            "Se vende por peso, no por unidad",
            "Se vende por unidad, no por peso",
            "Se vende por importe/monto",
            "Ajuste puntual",
          ]}
          onConfirmar={confirmarCambioFlagBalanza}
          onCancelar={() => setAutorizandoFlagBalanza(false)}
        />
      )}

      {cancelandoVenta && (
        <ModalConfirmarClave
          titulo="Cancelar toda la venta"
          descripcion="No se guardará nada de esta venta. Elige el motivo, quién autoriza y la clave de supervisor."
          motivoOpciones={["Cliente canceló la compra", "Venta duplicada", "Error del cajero"]}
          onConfirmar={confirmarCancelarVenta}
          onCancelar={() => setCancelandoVenta(false)}
        />
      )}

      {vueltoAMostrar && (
        <div className="modal-fondo">
          <div className="modal-vuelto">
            <div className="modal-vuelto-etiqueta">Vuelto</div>
            <div className="modal-vuelto-cifra">{formatoCLP(vueltoAMostrar.vuelto)}</div>
            <p>
              Entregó {formatoCLP(vueltoAMostrar.entregado)} · venta {formatoCLP(vueltoAMostrar.venta)}
            </p>
            <p className="ayuda">Entrega el vuelto al cliente y presiona Enter para cerrar la venta e imprimir.</p>
            <button
              type="button"
              className="boton boton-primario"
              onClick={confirmarVentaConVuelto}
              disabled={procesando}
              autoFocus
            >
              {procesando ? "Confirmando..." : "Cerrar venta e imprimir (Enter)"}
            </button>
          </div>
        </div>
      )}
    </div>
    <div className="vale-oculto-hasta-imprimir">{ventaParaImprimir && <ValeVenta venta={ventaParaImprimir} />}</div>
    </>
  );
}
