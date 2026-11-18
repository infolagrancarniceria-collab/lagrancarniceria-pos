// Recuadro de una sola cifra — a pedido del usuario, para poder
// identificar de un vistazo qué números importan en vez de leer un
// párrafo tras otro. "tono" decide el color: "exito"/"error" para una
// cifra que de verdad está bien o mal (ej. si algo cuadra o no), "neutro"
// (el default) para una cifra puramente informativa. Compartido entre
// CerrarCaja y CuadraturaCaja para que ambas pantallas se vean iguales.
export default function MetricaBox({
  etiqueta,
  valor,
  tono = "neutro",
  nota,
}: {
  etiqueta: string;
  valor: string;
  tono?: "exito" | "error" | "neutro";
  nota?: string;
}) {
  return (
    <div className={`recuadro-metrica${tono !== "neutro" ? ` ${tono}` : ""}`}>
      <span className="recuadro-metrica-etiqueta">{etiqueta}</span>
      <span className="recuadro-metrica-valor">{valor}</span>
      {nota && (
        <p className="ayuda recuadro-metrica-nota" style={{ margin: 0 }}>
          {nota}
        </p>
      )}
    </div>
  );
}
