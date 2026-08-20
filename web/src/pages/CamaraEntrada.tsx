import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  formatoCLP,
  FAMILIAS_CAMARA,
  PROCEDENCIAS_VACUNO,
  type CajaCamara,
  type FamiliaCamara,
  type ProcedenciaCamara,
  type Producto,
} from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara, imprimirEtiquetasLoteCamara } from "../lib/imprimir";

interface RevisionLote {
  familia: FamiliaCamara;
  procedencia?: ProcedenciaCamara;
  productoId: number;
  producto: string;
  cantidadCajas: number;
  pesoTotalKg: number;
  costoNetoKg: number;
  totalNeto: number;
  pesoTotalKgReal?: number;
  pesoIndividualKg?: number;
}

export default function CamaraEntrada() {
  const { usuario } = useUsuario();

  const [familia, setFamilia] = useState<FamiliaCamara>("Vacuno");
  const [procedencia, setProcedencia] = useState<ProcedenciaCamara | "">("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscarProducto, setBuscarProducto] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);

  const [cantidadCajas, setCantidadCajas] = useState("1");
  const [modoPeso, setModoPeso] = useState<"total" | "individual">("individual");
  const [pesoValor, setPesoValor] = useState("");
  const [costoNetoKg, setCostoNetoKg] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [revision, setRevision] = useState<RevisionLote | null>(null);
  const [cajasCreadas, setCajasCreadas] = useState<CajaCamara[] | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<number | null>(null);
  const [imprimiendoLote, setImprimiendoLote] = useState(false);

  useEffect(() => {
    if (!buscarProducto.trim()) {
      setProductos([]);
      return;
    }
    const timeout = setTimeout(() => {
      api.productos.listar({ buscar: buscarProducto }).then(setProductos).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(timeout);
  }, [buscarProducto]);

  function nuevoLote() {
    setCajasCreadas(null);
    setRevision(null);
    setProductoSeleccionado(null);
    setBuscarProducto("");
    setCantidadCajas("1");
    setPesoValor("");
    setCostoNetoKg("");
    setProcedencia("");
  }

  // Antes de crear nada, se arma un resumen para que el operador lo revise
  // — a pedido del usuario, para calzar con el flujo que ya conocía. Recién
  // al confirmar ese resumen se crean las cajas.
  function revisar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productoSeleccionado) {
      setError("Elige un producto");
      return;
    }
    if (familia === "Vacuno" && !procedencia) {
      setError("Elige la procedencia (Nacional, Brasil o Paraguay)");
      return;
    }
    const cajas = Number(cantidadCajas);
    if (!cajas || cajas <= 0 || !Number.isInteger(cajas)) {
      setError("La cantidad de cajas debe ser un número entero mayor a 0");
      return;
    }
    const peso = Number(pesoValor);
    if (!peso || peso <= 0) {
      setError(modoPeso === "total" ? "Ingresa el peso total del lote" : "Ingresa el peso por caja");
      return;
    }
    const costo = Number(costoNetoKg);
    if (!costo || costo <= 0) {
      setError("Ingresa el costo neto por kilo");
      return;
    }
    const pesoTotalKg = modoPeso === "total" ? peso : peso * cajas;
    setRevision({
      familia,
      ...(familia === "Vacuno" ? { procedencia: procedencia as ProcedenciaCamara } : {}),
      productoId: productoSeleccionado.id,
      producto: productoSeleccionado.descripcion,
      cantidadCajas: cajas,
      pesoTotalKg,
      costoNetoKg: costo,
      totalNeto: Math.round(pesoTotalKg * costo),
      ...(modoPeso === "total" ? { pesoTotalKgReal: peso } : { pesoIndividualKg: peso }),
    });
  }

  async function confirmarRegistro() {
    if (!revision || !usuario) return;
    setGuardando(true);
    setError(null);
    try {
      const creadas = await api.camara.entradaLote({
        productoId: revision.productoId,
        familia: revision.familia,
        ...(revision.procedencia ? { procedencia: revision.procedencia } : {}),
        cantidadCajas: revision.cantidadCajas,
        ...(revision.pesoTotalKgReal != null
          ? { pesoTotalKg: revision.pesoTotalKgReal }
          : { pesoIndividualKg: revision.pesoIndividualKg! }),
        costoNetoKg: revision.costoNetoKg,
        usuarioId: usuario.id,
      });
      setCajasCreadas(creadas);
      setRevision(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
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

  if (cajasCreadas) {
    return (
      <div>
        <div className="no-imprimir">
          <div className="encabezado-pantalla">
            <h1>Entrada de cámara — {cajasCreadas.length} caja(s) registrada(s)</h1>
            <Link to="/camara" className="boton">
              Volver a Cámara
            </Link>
          </div>
          <p className="exito">
            Listo — {cajasCreadas[0].producto.descripcion}, {cajasCreadas.length} caja(s) de{" "}
            {cajasCreadas[0].pesoEstimado ? "peso estimado" : "peso real"}. Imprime cada etiqueta con el botón
            correspondiente, o todo el lote de una vez.
          </p>
          <div className="fila-inline">
            <button type="button" className="boton boton-primario" onClick={nuevoLote}>
              Registrar otro lote
            </button>
            {cajasCreadas.length > 1 && (
              <button type="button" className="boton boton-peligro" onClick={imprimirTodasLasEtiquetas}>
                ⚡ Imprimir lote completo ({cajasCreadas.length})
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

  if (revision) {
    return (
      <div>
        <div className="encabezado-pantalla">
          <h1>Revise el lote antes de ingresarlo</h1>
          <Link to="/camara" className="boton">
            Volver a Cámara
          </Link>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="ayuda">Confirme que estos datos coinciden con el total indicado en las cajas o en el documento de compra.</p>
        <div className="tarjeta">
          <p>
            <b>Familia:</b> {revision.familia}
          </p>
          {revision.procedencia && (
            <p>
              <b>Procedencia:</b> {revision.procedencia}
            </p>
          )}
          <p>
            <b>Producto:</b> {revision.producto}
          </p>
          <p>
            <b>Cantidad:</b> {revision.cantidadCajas} caja(s)
          </p>
          <p>
            <b>Peso total del lote:</b> {revision.pesoTotalKg.toFixed(3)} kg
          </p>
          <p>
            <b>Valor neto por kilo:</b> {formatoCLP(revision.costoNetoKg)}
          </p>
          <p>
            <b>TOTAL NETO DEL LOTE:</b> {formatoCLP(revision.totalNeto)}
          </p>
        </div>
        <p className="ayuda">Mientras este resumen esté abierto, todavía no se ha registrado ninguna caja.</p>
        <div className="acciones-formulario">
          <button type="button" className="boton boton-primario" onClick={confirmarRegistro} disabled={guardando}>
            {guardando ? "Registrando..." : "✓ Sí, registrar lote"}
          </button>
          <button type="button" className="boton" onClick={() => setRevision(null)} disabled={guardando}>
            ← Corregir datos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="encabezado-pantalla">
        <h1>Entrada de cámara</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      {error && <p className="error">{error}</p>}

      <form onSubmit={revisar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Familia
          <select
            value={familia}
            onChange={(e) => {
              const nueva = e.target.value as FamiliaCamara;
              setFamilia(nueva);
              if (nueva !== "Vacuno") setProcedencia("");
            }}
          >
            {FAMILIAS_CAMARA.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        {familia === "Vacuno" && (
          <label>
            Procedencia
            <select value={procedencia} onChange={(e) => setProcedencia(e.target.value as ProcedenciaCamara)}>
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
              value={buscarProducto}
              onChange={(e) => {
                setBuscarProducto(e.target.value);
                setProductoSeleccionado(null);
              }}
            />
            {buscarProducto.trim() && (
              <div className="resultados-busqueda">
                {productos.length === 0 && <div className="resultado-item ayuda">Sin resultados</div>}
                {productos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="resultado-item"
                    onClick={() => {
                      setProductoSeleccionado(p);
                      setBuscarProducto("");
                      setProductos([]);
                    }}
                  >
                    {p.plu} — {p.descripcion} ({p.categoria.nombre})
                  </button>
                ))}
              </div>
            )}
          </div>
          {productoSeleccionado && (
            <p className="exito">
              Producto elegido: {productoSeleccionado.descripcion}{" "}
              <button type="button" onClick={() => setProductoSeleccionado(null)}>
                Cambiar
              </button>
            </p>
          )}
        </label>

        <label>
          Cantidad de cajas
          <input
            type="number"
            min="1"
            step="1"
            value={cantidadCajas}
            onChange={(e) => setCantidadCajas(e.target.value)}
          />
        </label>

        <label>
          ¿Cómo se sabe el peso?
          <select value={modoPeso} onChange={(e) => setModoPeso(e.target.value as "total" | "individual")}>
            <option value="individual">Se pesó cada caja (peso real)</option>
            <option value="total">Solo se sabe el peso total del lote (se reparte estimado)</option>
          </select>
        </label>
        <label>
          {modoPeso === "total" ? "Peso total del lote (kg)" : "Peso por caja (kg)"}
          <input
            type="number"
            min="0.001"
            step="0.001"
            value={pesoValor}
            onChange={(e) => setPesoValor(e.target.value)}
            placeholder={modoPeso === "total" ? "ej. 225" : "ej. 22.5"}
          />
          {modoPeso === "total" && (
            <span className="ayuda">
              Se reparte en partes iguales entre las {cantidadCajas || "N"} cajas (marcadas como peso estimado —
              se puede corregir después con un ajuste).
            </span>
          )}
        </label>

        <label>
          Costo neto por kilo
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={costoNetoKg}
            onChange={(e) => setCostoNetoKg(e.target.value)}
            placeholder="ej. 6500"
          />
        </label>

        <div className="acciones-formulario">
          <button type="submit" className="boton boton-primario">
            Revisar datos del lote
          </button>
        </div>
      </form>
    </div>
  );
}
