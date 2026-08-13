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
export function construirMensajeActualizacion(productos: ProductoParaBalanza[]): string {
  const items = productos.map(construirItem).filter(Boolean).join("");
  return `<Message><ARTSCommonHeader MessageType="Request"/><ItemTransaction ActionCode="Update">${items}</ItemTransaction></Message>`;
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
  const mensaje = construirMensajeActualizacion(productos);
  const resultados: ResultadoEnvioBalanza[] = [];
  for (const ip of ips) {
    try {
      await enviarABalanza(ip, puerto, mensaje);
      resultados.push({ ip, exito: true });
    } catch (e) {
      resultados.push({ ip, exito: false, error: (e as Error).message });
    }
  }
  return resultados;
}
