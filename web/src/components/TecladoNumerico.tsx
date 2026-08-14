interface Props {
  valor: string;
  onCambiar: (valor: string) => void;
}

const TECLAS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ",", "borrar"];

// Teclado numérico en pantalla, al estilo del sistema anterior (Gexus), para
// que quien esté cobrando pueda tocar cantidades y montos con el mouse en
// vez de escribirlos con el teclado físico — el campo sigue aceptando
// tipeo normal también, esto es un agregado, no un reemplazo.
export function TecladoNumerico({ valor, onCambiar }: Props) {
  function tocar(tecla: string) {
    if (tecla === "borrar") {
      onCambiar(valor.slice(0, -1));
      return;
    }
    if (tecla === "," ) {
      if (valor.includes(".")) return;
      onCambiar((valor || "0") + ".");
      return;
    }
    onCambiar(valor + tecla);
  }

  return (
    <div className="teclado-numerico">
      {TECLAS.map((t) => (
        <button key={t} type="button" className="tecla-numerica" onClick={() => tocar(t)}>
          {t === "borrar" ? "⌫" : t}
        </button>
      ))}
    </div>
  );
}
