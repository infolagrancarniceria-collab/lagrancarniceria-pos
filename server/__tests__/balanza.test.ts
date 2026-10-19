import { describe, expect, it } from "vitest";
import { diasDesdeDuracion, detalleEnvio, construirMensajeActualizacion, type ProductoParaBalanza } from "../lib/balanza";

// Antes el envío a la balanza mandaba siempre "005" (5 días) sin importar lo
// que se cargara en Producto.duracion — estos tests cubren que ahora se lea
// ese valor de verdad, y que un texto libre no numérico (histórico, o "Ver
// envase") no rompa el envío y caiga al valor por defecto en vez de mandar
// cualquier cosa a la balanza.
describe("diasDesdeDuracion", () => {
  it("usa el número de días tal cual cuando es un entero positivo", () => {
    expect(diasDesdeDuracion("120")).toBe(120);
    expect(diasDesdeDuracion("5")).toBe(5);
    expect(diasDesdeDuracion("1")).toBe(1);
  });

  it("usa 5 días por defecto cuando no hay duración, está vacía, o no es un entero positivo", () => {
    expect(diasDesdeDuracion(null)).toBe(5);
    expect(diasDesdeDuracion(undefined)).toBe(5);
    expect(diasDesdeDuracion("")).toBe(5);
    expect(diasDesdeDuracion("Ver envase")).toBe(5);
    expect(diasDesdeDuracion("120 días")).toBe(5);
    expect(diasDesdeDuracion("0")).toBe(5);
    expect(diasDesdeDuracion("-10")).toBe(5);
  });
});

describe("detalleEnvio incluye los días de vencimiento enviados", () => {
  it("refleja la duración real de cada producto, no un valor fijo", () => {
    const productos: ProductoParaBalanza[] = [
      { plu: "1001", descripcion: "Hamburguesa 100gr", precio: 1000, flagBalanza: "PESABLE", duracion: "120" },
      { plu: "1002", descripcion: "Vacío", precio: 8000, flagBalanza: "PESABLE", duracion: null },
    ];

    const detalle = detalleEnvio(productos);

    expect(detalle.find((d) => d.plu === "1001")?.diasVencimientoEnviados).toBe(120);
    expect(detalle.find((d) => d.plu === "1002")?.diasVencimientoEnviados).toBe(5);
  });
});

// Mismo motivo que ya está confirmado para <ItemPrices> (ver el comentario
// de construirItem): la balanza no "actualiza" un sub-elemento marcado como
// Action="Create" si el PLU ya existe, lo ignora en silencio. Por eso
// <Dates> necesita el mismo Create/Update por pasada que ya tenía
// <ItemPrices> — si no, el vencimiento nunca se refresca para un producto
// que ya está cargado en la balanza (que es el caso normal: casi ningún
// envío es realmente de un PLU nuevo).
describe("construirMensajeActualizacion: <Dates> usa el mismo Action que <ItemPrices>", () => {
  const producto: ProductoParaBalanza = {
    plu: "1001",
    descripcion: "Churrasco",
    precio: 5000,
    flagBalanza: "PESABLE",
    duracion: "180",
  };

  it('pasada "Add": ambos piden Action="Create" (el PLU todavía no existe)', () => {
    const mensaje = construirMensajeActualizacion([producto], "Add");
    expect(mensaje).toContain('<ItemPrices Action="Create">');
    expect(mensaje).toContain('<Dates Action="Create">');
  });

  it('pasada "Update": ambos piden Action="Update" (el PLU ya existe, hay que refrescarlo)', () => {
    const mensaje = construirMensajeActualizacion([producto], "Update");
    expect(mensaje).toContain('<ItemPrices Action="Update">');
    expect(mensaje).toContain('<Dates Action="Update">');
    expect(mensaje).toContain(">180</DateOffset>");
  });
});
