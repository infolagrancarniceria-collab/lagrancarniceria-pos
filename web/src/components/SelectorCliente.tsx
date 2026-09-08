import { useEffect, useRef, useState } from "react";
import { api, codigoCliente, type Cliente } from "../api";

// Selector de cliente para ventas a crédito/transferencia — reemplaza el
// campo de nombre libre de antes. Busca por nombre/RUT/teléfono mientras se
// escribe y, si no hay ningún cliente que calce, deja crear uno nuevo sin
// salir del formulario de pago.
export default function SelectorCliente({
  seleccionado,
  onSeleccionar,
  autoFocusRef,
}: {
  seleccionado: Cliente | null;
  onSeleccionar: (cliente: Cliente | null) => void;
  autoFocusRef?: React.RefObject<HTMLInputElement>;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [mostrarLista, setMostrarLista] = useState(false);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevoRut, setNuevoRut] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (seleccionado || creandoNuevo) return;
    if (!texto.trim()) {
      setResultados([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.clientes
        .buscar(texto.trim())
        .then(setResultados)
        .catch(() => setResultados([]));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [texto, seleccionado, creandoNuevo]);

  if (seleccionado) {
    return (
      <span className="fila-inline">
        <strong>
          {codigoCliente(seleccionado.id)} — {seleccionado.nombre}
        </strong>
        <button
          type="button"
          className="boton-chico"
          onClick={() => {
            onSeleccionar(null);
            setTexto("");
          }}
        >
          Cambiar
        </button>
      </span>
    );
  }

  if (creandoNuevo) {
    return (
      <span className="fila-inline">
        <input
          ref={autoFocusRef}
          type="text"
          placeholder="Nombre del cliente nuevo"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <input
          type="text"
          placeholder="Teléfono (opcional)"
          value={nuevoTelefono}
          onChange={(e) => setNuevoTelefono(e.target.value)}
        />
        <input type="text" placeholder="RUT (opcional)" value={nuevoRut} onChange={(e) => setNuevoRut(e.target.value)} />
        <button
          type="button"
          className="boton-chico"
          onClick={async () => {
            if (!texto.trim()) {
              setError("Falta el nombre del cliente");
              return;
            }
            try {
              const cliente = await api.clientes.crear({
                nombre: texto.trim(),
                telefono: nuevoTelefono.trim() || null,
                rut: nuevoRut.trim() || null,
              });
              setCreandoNuevo(false);
              setNuevoTelefono("");
              setNuevoRut("");
              setError(null);
              onSeleccionar(cliente);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Crear
        </button>
        <button type="button" className="boton-chico" onClick={() => setCreandoNuevo(false)}>
          Cancelar
        </button>
        {error && <span className="error">{error}</span>}
      </span>
    );
  }

  return (
    <span className="selector-cliente">
      <input
        ref={autoFocusRef}
        type="text"
        placeholder="Buscar cliente por nombre, RUT o teléfono"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onFocus={() => setMostrarLista(true)}
        onBlur={() => setTimeout(() => setMostrarLista(false), 150)}
      />
      {mostrarLista && texto.trim() && (
        <div className="selector-cliente-lista">
          {resultados.map((c) => (
            <button
              type="button"
              key={c.id}
              className="selector-cliente-opcion"
              onMouseDown={() => onSeleccionar(c)}
            >
              {codigoCliente(c.id)} — {c.nombre}
              {c.telefono ? ` (${c.telefono})` : ""}
            </button>
          ))}
          {resultados.length === 0 && (
            <p className="ayuda selector-cliente-sin-resultados">Sin coincidencias.</p>
          )}
          <button type="button" className="selector-cliente-opcion selector-cliente-nuevo" onMouseDown={() => setCreandoNuevo(true)}>
            + Crear cliente nuevo
          </button>
        </div>
      )}
    </span>
  );
}
