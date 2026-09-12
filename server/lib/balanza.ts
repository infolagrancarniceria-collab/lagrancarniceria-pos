import net from "node:net";

// Protocolo confirmado por captura real de red (Wireshark) contra una
// balanza Mettler Toledo bPlus: socket TCP directo al puerto de la
// balanza, mensajes XML tipo ARTS/IXRetail. Ver CLAUDE.md para el detalle
// y el mensaje de ejemplo capturado.

export interface ProductoParaBalanza {
  plu: string;
  descripcion: string;
  precio: number;
  flagBalanza: string;
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Hipótesis confirmada contra un catálogo real de 200 productos: los
// productos "Pesable" se venden por kilo (KGM) y los "Importe" son de
// precio fijo por paquete/unidad pero igual se etiquetan en la balanza
// (KGM). Los "Normal" no van en este mensaje (tienen su propio código de
// barras impreso de fábrica, no pasan por la balanza).
function unidadDeMedida(flagBalanza: string): "KGM" | "PCS" | null {
  if (flagBalanza === "PESABLE") return "KGM";
  if (flagBalanza === "IMPORTE") return "PCS";
  return null;
}

function construirItem(producto: ProductoParaBalanza): string {
  const unidad = unidadDeMedida(producto.flagBalanza);
  if (!unidad) return "";
  const pluNumerico = producto.plu.replace(/\D/g, "");
  const alternativeItemId = pluNumerico.padStart(13, "0");
  const nombre = escaparXml(producto.descripcion);
  const precio = Math.round(producto.precio);

  return (
    `<Item><PLU>${pluNumerico}</PLU><DepartmentID>0</DepartmentID>` +
    `<AlternativeItemIDs Action="Create"><AlternativeItemID>${alternativeItemId}</AlternativeItemID></AlternativeItemIDs>` +
    `<Descriptions Action="Create"><Description Type="ItemName">${nombre}</Description><Description ID="0" Type="ExtraText"></Description></Descriptions>` +
    `<ItemPrices Action="Update"><ItemPrice ValueTypeCode="BasePrice" Index="0" UnitOfMeasureCode="${unidad}" PriceOverrideFlag="false" DiscountFlag="false" Hidden="false">${precio}</ItemPrice></ItemPrices>` +
    `<Dates Action="Create"><DateOffset Type="PackedDate" UnitOfOffset="day" IsPrintEnabled="true">0</DateOffset><DateOffset Type="SellBy" UnitOfOffset="day" IsPrintEnabled="true">005</DateOffset></Dates>` +
    `<LabelFormats Action="Create"><LabelFormatID Index="0">2</LabelFormatID></LabelFormats>` +
    `<TargetWeights Action="Create"><TargetWeight Index="0" LowerTolerance="0" UpperTolerance="0" UnitOfMeasureCode="KGM">0</TargetWeight></TargetWeights>` +
    `</Item>`
  );
}

// Arma el mensaje con el catálogo completo (así es como lo manda el sistema
// actual: siempre todo el catálogo pesable/importe, no solo lo que cambió).
//
// ActionCode "Update" — el que se usó siempre — sirve para refrescar
// precio/nombre de un PLU que la balanza YA tiene cargado, pero no crea uno
// que no existía (la balanza responde OK igual, como si el mensaje se
// hubiese recibido bien, pero no llega a poder teclearse ese PLU en el
// mesón). El formato se sacó de una captura de red del sistema viejo
// (Gexus) actualizando su catálogo de 200 productos ya cargados — nunca se
// capturó el caso de agregar un PLU realmente nuevo. Por eso ahora se manda
// primero una pasada con "Add" (para que la balanza cree los PLU que le
// falten) y después la de siempre con "Update" (para que todos —nuevos y
// viejos— queden con el precio/nombre al día). Pendiente confirmar con las
// balanzas físicas reales que "Add" es el ActionCode correcto para crear.
export interface DetalleEnvioItem {
  plu: string;
  descripcion: string;
  precioEnviado: number;
  unidad: "KGM" | "PCS" | null;
  incluido: boolean;
}

// Detalle de qué se mandó realmente por cada producto — a pedido del
// usuario, para poder confirmar desde la pantalla Balanza (sin depender de
// entrar al menú de la balanza física) qué precio exacto viajó en el
// último envío. La balanza puede responder "OK" en el protocolo (el
// mensaje se recibió bien) sin que eso garantice que actualizó el precio
// de un PLU puntual — este detalle ayuda a descartar que el problema sea
// del lado del POS antes de sospechar de la balanza.
export function detalleEnvio(productos: ProductoParaBalanza[]): DetalleEnvioItem[] {
  return productos.map((p) => {
    const unidad = unidadDeMedida(p.flagBalanza);
    return {
      plu: p.plu,
      descripcion: p.descripcion,
      precioEnviado: Math.round(p.precio),
      unidad,
      incluido: unidad != null,
    };
  });
}

export function construirMensajeActualizacion(
  productos: ProductoParaBalanza[],
  actionCode: "Add" | "Update" = "Update"
): string {
  const items = productos.map(construirItem).filter(Boolean).join("");
  return `<Message><ARTSCommonHeader MessageType="Request"/><ItemTransaction ActionCode="${actionCode}">${items}</ItemTransaction></Message>`;
}

const TIMEOUT_MS = 20000;

// Envía el mensaje por socket TCP directo y espera la respuesta de
// confirmación de la balanza (mensaje vacío con MessageType="Response").
export function enviarABalanza(ip: string, puerto: number, mensaje: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let respuesta = "";
    let terminado = false;

    const finalizar = (accion: () => void) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timeout);
      socket.destroy();
      accion();
    };

    const timeout = setTimeout(() => {
      finalizar(() => reject(new Error(`Tiempo de espera agotado conectando a ${ip}:${puerto}`)));
    }, TIMEOUT_MS);

    socket.connect(puerto, ip, () => {
      socket.write(mensaje, "ascii");
    });

    socket.on("data", (chunk) => {
      respuesta += chunk.toString("ascii");
      if (respuesta.includes('MessageType="Response"') && respuesta.trim().endsWith("</Message>")) {
        finalizar(() => resolve());
      }
    });

    socket.on("error", (err) => {
      finalizar(() => reject(new Error(`No se pudo conectar a la balanza ${ip}:${puerto} — ${err.message}`)));
    });

    socket.on("close", () => {
      finalizar(() =>
        respuesta
          ? reject(new Error(`Respuesta inesperada de la balanza ${ip}: ${respuesta}`))
          : reject(new Error(`La balanza ${ip}:${puerto} cerró la conexión sin responder`))
      );
    });
  });
}

export interface ResultadoEnvioBalanza {
  ip: string;
  exito: boolean;
  error?: string;
}

export async function actualizarBalanzas(
  ips: string[],
  puerto: number,
  productos: ProductoParaBalanza[]
): Promise<ResultadoEnvioBalanza[]> {
  const mensajeAgregar = construirMensajeActualizacion(productos, "Add");
  const mensajeActualizar = construirMensajeActualizacion(productos, "Update");
  const resultados: ResultadoEnvioBalanza[] = [];
  for (const ip of ips) {
    // La pasada "Add" es best-effort: si la balanza no tiene nada que crear
    // (o si le molesta que ya existan), no debe impedir la pasada "Update"
    // de siempre, que es la que hoy sabemos que funciona para lo que ya
    // estaba cargado.
    try {
      await enviarABalanza(ip, puerto, mensajeAgregar);
    } catch {
      // se ignora — se reporta el resultado real más abajo, con "Update"
    }
    try {
      await enviarABalanza(ip, puerto, mensajeActualizar);
      resultados.push({ ip, exito: true });
    } catch (e) {
      resultados.push({ ip, exito: false, error: (e as Error).message });
    }
  }
  return resultados;
}
