import { describe, expect, it } from "vitest";
import { diasDesdeDuracion, detalleEnvio, type ProductoParaBalanza } from "../lib/balanza";

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
