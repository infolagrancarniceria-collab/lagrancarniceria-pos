import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CajaCamara, type Producto } from "../api";
import { useUsuario } from "../context/UsuarioContext";
import { manejarEnterComoTab } from "../hooks/useEnterNavigation";
import { EtiquetaCamara } from "../components/EtiquetaCamara";
import { imprimirEtiquetaCamara } from "../lib/imprimir";

export default function CamaraEntrada() {
  const { usuario } = useUsuario();

  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscarProducto, setBuscarProducto] = useState("");
  const [productoSeleccionado, setProductoSeleccionado] = useState<Producto | null>(null);

  const [cantidadCajas, setCantidadCajas] = useState("1");
  const [modoPeso, setModoPeso] = useState<"total" | "individual">("individual");
  const [pesoValor, setPesoValor] = useState("");
  const [costoNetoKg, setCostoNetoKg] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cajasCreadas, setCajasCreadas] = useState<CajaCamara[] | null>(null);
  const [imprimiendoId, setImprimiendoId] = useState<number | null>(null);

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
    setProductoSeleccionado(null);
    setBuscarProducto("");
    setCantidadCajas("1");
    setPesoValor("");
    setCostoNetoKg("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productoSeleccionado || !usuario) {
      setError("Elige un producto");
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
    setGuardando(true);
    try {
      const creadas = await api.camara.entradaLote({
        productoId: productoSeleccionado.id,
        cantidadCajas: cajas,
        ...(modoPeso === "total" ? { pesoTotalKg: peso } : { pesoIndividualKg: peso }),
        costoNetoKg: costo,
        usuarioId: usuario.id,
      });
      setCajasCreadas(creadas);
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
            correspondiente.
          </p>
          <button type="button" className="boton boton-primario" onClick={nuevoLote}>
            Registrar otro lote
          </button>
        </div>

        <div className="etiquetas-camara">
          {cajasCreadas.map((caja) => (
            <div key={caja.id} className="etiqueta-bloque">
              <EtiquetaCamara
                numero={String(caja.id).padStart(6, "0")}
                producto={caja.producto.descripcion}
                familia={caja.familiaNombre}
                fechaIngreso={caja.fechaIngreso}
                pesoInicialKg={caja.pesoInicialKg}
                pesoEstimado={caja.pesoEstimado}
                imprimiendo={imprimiendoId === caja.id}
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
        <h1>Entrada de cámara</h1>
        <Link to="/camara" className="boton">
          Volver a Cámara
        </Link>
      </div>
      {error && <p className="error">{error}</p>}

      <form onSubmit={guardar} onKeyDown={manejarEnterComoTab} className="formulario">
        <label>
          Producto
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
          <button type="submit" className="boton boton-primario" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar entrada e imprimir etiquetas"}
          </button>
        </div>
      </form>
    </div>
  );
}
