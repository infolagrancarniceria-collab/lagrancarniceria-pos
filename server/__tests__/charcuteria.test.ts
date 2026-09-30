import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

async function crearItem(usuarioId: number, datos: Record<string, unknown>) {
  const res = await api.post("/api/charcuteria/items").send({ usuarioId, ...datos });
  expect(res.status).toBe(201);
  return res.body;
}

describe("Charcutería — costeo, merma y trazabilidad de un lote", () => {
  let usuarioId: number;
  let productoCarniceriaId: number;
  let mpId: number;
  let skuId: number;
  let skuProductoEspejoId: number;
  let loteId: number;

  beforeAll(async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    usuarioId = usuario.id;
    productoCarniceriaId = productoCarniceria.id;

    const mp = await crearItem(usuarioId, { codigo: `MP-${Date.now()}`, nombre: "Lomo para pastrami", tipoItem: "materia_prima", unidadMedida: "gramos" });
    mpId = mp.id;
    const pe = await crearItem(usuarioId, { codigo: `PE-${Date.now()}`, nombre: "Pastrami elaborado", tipoItem: "producto_elaborado", unidadMedida: "gramos", vidaUtilDias: 15 });
    const sku = await crearItem(usuarioId, {
      codigo: `SKU-${Date.now()}`, nombre: "Pastrami 200g", tipoItem: "producto_terminado",
      formatoGramos: 200, productoElaboradoId: pe.id, precioVenta: 9990,
    });
    skuId = sku.id;
    skuProductoEspejoId = sku.productoEspejoId;

    const receta = await api.post("/api/charcuteria/recetas").send({
      usuarioId, productoElaboradoId: pe.id, rendimientoEsperadoPct: 70,
      ingredientes: [{ itemId: mp.id, cantidadPorLoteBase: 1000, unidad: "gramos" }],
    });
    expect(receta.status).toBe(201);

    const transf = await api.post("/api/charcuteria/transferencias").send({
      usuarioId, productoOrigenId: productoCarniceriaId, itemDestinoId: mpId, cantidad: 5,
    });
    expect(transf.status).toBe(201);
    expect(transf.body.precioPorKg).toBe(8990); // default: precio de venta vigente del producto de origen

    const lote = await api.post("/api/charcuteria/lotes").send({ usuarioId, recetaId: receta.body.id });
    expect(lote.status).toBe(201);
    loteId = lote.body.id;

    const insumo = await api.post(`/api/charcuteria/lotes/${loteId}/insumos`).send({ usuarioId, itemId: mpId, cantidad: 1000 });
    expect(insumo.status).toBe(200);
    // 1000g a $8990/kg = $8.99/g -> 1000 * 8.99 = 8990
    expect(insumo.body.pesoEntradaKg).toBe(1); // acumulado a partir de la materia prima recién agregada
  });

  it("calcula la merma real y conserva la merma esperada de la receta", async () => {
    const cerrar = await api.put(`/api/charcuteria/lotes/${loteId}/cerrar`).send({
      usuarioId, pesoSalidaKg: 0.75, horasManoObra: 2, costoHoraManoObra: 3000,
    });
    expect(cerrar.status).toBe(200);
    // merma esperada = 100 - rendimientoEsperadoPct(70) = 30
    expect(cerrar.body.mermaEsperadaPct).toBe(30);
    // merma real = (1 - 0.75/1) * 100 = 25
    expect(cerrar.body.mermaRealPct).toBe(25);
    expect(cerrar.body.estado).toBe("terminado");
  });

  it("calcula el costo total del lote (insumos + mano de obra) al cerrar", async () => {
    const lote = await api.get(`/api/charcuteria/lotes/${loteId}`);
    // insumo: 1000g * $8.99/g = $8990 ; mano de obra: 2h * $3000 = $6000 ; total = $14990
    expect(lote.body.costoTotal).toBe(14990);
  });

  it("suma el costo de envase/etiqueta al costo total al envasar, y calcula el costo por unidad correctamente", async () => {
    const envase = await crearItem(usuarioId, { codigo: `ENV-${Date.now()}`, nombre: "Bolsa 200g", tipoItem: "envase_etiqueta", unidadMedida: "unidad" });
    // Le pone costo de referencia al envase a mano (no pasa por transferencia).
    await prisma.itemCharcuteria.update({ where: { id: envase.id }, data: { stockActual: 100, costoReferencia: 50 } });

    const envasar = await api.post(`/api/charcuteria/lotes/${loteId}/envasar`).send({
      usuarioId, skuId, cantidadUnidadesGeneradas: 3, pesoRealTotalUsadoG: 650,
      envaseItemId: envase.id, envasesConsumidos: 3,
    });
    expect(envasar.status).toBe(201);
    expect(envasar.body.diferenciaPesoG).toBe(650 - 3 * 200); // 50g de diferencia

    const lote = await api.get(`/api/charcuteria/lotes/${loteId}`);
    // costo anterior 14990 + 3 envases * $50 = 15140
    expect(lote.body.costoTotal).toBe(15140);
    expect(lote.body.estado).toBe("envasado");

    const reporte = await api.get("/api/charcuteria/reportes/costo-margen");
    const filaLote = reporte.body.find((l: { loteId: number }) => l.loteId === loteId);
    expect(filaLote).toBeTruthy();
    const filaSku = filaLote.skus.find((s: { skuId: number }) => s.skuId === skuId);
    // costoPorKgElaborado = 15140 / 0.75 = 20186.67 ; costoPorUnidad = 20186.67 * 0.2 = 4037.33 -> redondeado 4037
    expect(filaSku.costoPorUnidad).toBe(4037);
    expect(filaSku.precioVenta).toBe(9990);
    expect(filaSku.saldoUnidades).toBe(3);
  });

  it("trazabilidad hacia atrás: el lote muestra la transferencia que trajo su materia prima", async () => {
    const traza = await api.get(`/api/charcuteria/reportes/trazabilidad/lote/${loteId}`);
    expect(traza.status).toBe(200);
    expect(traza.body.insumos).toHaveLength(1);
    expect(traza.body.insumos[0].transferencia).not.toBeNull();
    expect(traza.body.insumos[0].transferencia.pluOrigen).toBeTruthy();
  });

  it("trazabilidad hacia adelante: vender el SKU aparece bajo la materia prima de origen", async () => {
    const venta = await api.post("/api/caja/ventas").send({ usuarioId, auxiliar: true });
    expect(venta.status).toBe(201);
    const agregar = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: skuProductoEspejoId, cantidad: 1 });
    expect(agregar.status).toBe(201);
    const ventaConTotal = agregar.body;
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: ventaConTotal.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });
    expect(confirmar.status).toBe(200);
    expect(confirmar.body.items[0].loteId).toBe(loteId);
    // La venta de un producto de charcutería queda etiquetada como tal, no como carnicería.
    expect(confirmar.body.businessUnitId).toBe(2);

    const trazaItem = await api.get(`/api/charcuteria/reportes/trazabilidad/item/${mpId}`);
    expect(trazaItem.status).toBe(200);
    const loteEntry = trazaItem.body.lotesQueLoUsaron.find((l: { loteId: number }) => l.loteId === loteId);
    expect(loteEntry).toBeTruthy();
    expect(loteEntry.ventas).toHaveLength(1);
    expect(loteEntry.ventas[0].ventaId).toBe(venta.body.id);

    const consolidado = await api.get("/api/charcuteria/reportes/consolidado");
    const filaCharcuteria = consolidado.body.porUnidad.find((u: { codigo: string }) => u.codigo === "charcuteria");
    expect(filaCharcuteria).toBeTruthy();
    expect(filaCharcuteria.cantidadVentas).toBeGreaterThanOrEqual(1);
  });
});

describe("Charcutería — clave de supervisor para entrar a secciones sensibles", () => {
  it("acepta la clave de supervisor vigente y rechaza una incorrecta", async () => {
    await crearFixturesBasicas(); // deja la ClaveSupervisor en "1234"

    const ok = await api.post("/api/charcuteria/verificar-clave-sensible").send({ clave: "1234" });
    expect(ok.status).toBe(204);

    const mal = await api.post("/api/charcuteria/verificar-clave-sensible").send({ clave: "no-es-esta" });
    expect(mal.status).toBe(403);
  });
});

describe("Charcutería — vincular un producto existente en vez de duplicarlo", () => {
  it("vincula un producto de carnicería como espejo, conservando su PLU y stock, sin crear uno nuevo", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();

    const buscador = await api.get(`/api/charcuteria/productos-vinculables?buscar=${encodeURIComponent(productoCarniceria.plu)}`);
    expect(buscador.status).toBe(200);
    expect(buscador.body.some((p: { id: number }) => p.id === productoCarniceria.id)).toBe(true);

    const item = await crearItem(usuario.id, {
      codigo: `SKU-VINC-${Date.now()}`,
      nombre: "Pastrami vinculado",
      tipoItem: "producto_terminado",
      formatoGramos: 200,
      productoExistenteId: productoCarniceria.id,
    });

    // No se crea una fila nueva en Producto — se reutiliza la misma, con el
    // mismo PLU y el mismo stock que ya tenía.
    expect(item.productoEspejoId).toBe(productoCarniceria.id);
    expect(item.productoEspejo.plu).toBe(productoCarniceria.plu);
    expect(item.productoEspejo.stockActual).toBe(100);

    const productoActualizado = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(productoActualizado?.businessUnitId).toBe(2);
    expect(productoActualizado?.stockActual).toBe(100);
    expect(productoActualizado?.plu).toBe(productoCarniceria.plu);

    // Una vez vinculado, ya no aparece como candidato para vincular de nuevo.
    const buscadorDespues = await api.get(`/api/charcuteria/productos-vinculables?buscar=${encodeURIComponent(productoCarniceria.plu)}`);
    expect(buscadorDespues.body.some((p: { id: number }) => p.id === productoCarniceria.id)).toBe(false);

    // Intentar vincularlo de nuevo a otro ítem falla con un error claro.
    const res = await api.post("/api/charcuteria/items").send({
      usuarioId: usuario.id,
      codigo: `SKU-VINC-DUP-${Date.now()}`,
      nombre: "Otro SKU",
      tipoItem: "producto_terminado",
      productoExistenteId: productoCarniceria.id,
    });
    expect(res.status).toBe(409);
  });

  it("respeta el precio existente si no se manda uno nuevo, y lo actualiza si sí", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const precioOriginal = productoCarniceria.precio;

    const item = await crearItem(usuario.id, {
      codigo: `SKU-VINC-PRECIO-${Date.now()}`,
      nombre: "Cecina vinculada",
      tipoItem: "producto_terminado",
      productoExistenteId: productoCarniceria.id,
    });
    expect(item.productoEspejo.precio).toBe(precioOriginal);

    const item2 = await crearItem(usuario.id, {
      codigo: `SKU-VINC-PRECIO2-${Date.now()}`,
      nombre: "Otra cecina vinculada",
      tipoItem: "producto_terminado",
      productoExistenteId: (await crearFixturesBasicas()).productoCarniceria.id,
      precioVenta: 12345,
    });
    expect(item2.productoEspejo.precio).toBe(12345);
  });
});

describe("Charcutería — FEFO al vender", () => {
  let usuarioId: number;
  let productoCarniceriaId: number;
  let skuId: number;
  let skuProductoEspejoId: number;
  let loteAntiguoId: number;
  let loteNuevoId: number;

  beforeAll(async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    usuarioId = usuario.id;
    productoCarniceriaId = productoCarniceria.id;

    const mp = await crearItem(usuarioId, { codigo: `MP-FEFO-${Date.now()}`, nombre: "Lomo FEFO", tipoItem: "materia_prima", unidadMedida: "gramos" });
    const pe = await crearItem(usuarioId, { codigo: `PE-FEFO-${Date.now()}`, nombre: "Pastrami FEFO", tipoItem: "producto_elaborado", unidadMedida: "gramos", vidaUtilDias: 15 });
    const sku = await crearItem(usuarioId, {
      codigo: `SKU-FEFO-${Date.now()}`, nombre: "Pastrami FEFO 200g", tipoItem: "producto_terminado",
      formatoGramos: 200, productoElaboradoId: pe.id, precioVenta: 9990,
    });
    skuId = sku.id;
    skuProductoEspejoId = sku.productoEspejoId;

    const receta = await api.post("/api/charcuteria/recetas").send({
      usuarioId, productoElaboradoId: pe.id, rendimientoEsperadoPct: 100,
      ingredientes: [{ itemId: mp.id, cantidadPorLoteBase: 1000, unidad: "gramos" }],
    });

    await api.post("/api/charcuteria/transferencias").send({ usuarioId, productoOrigenId: productoCarniceriaId, itemDestinoId: mp.id, cantidad: 10 });

    async function crearLoteYEnvasar(unidades: number) {
      const lote = await api.post("/api/charcuteria/lotes").send({ usuarioId, recetaId: receta.body.id });
      await api.post(`/api/charcuteria/lotes/${lote.body.id}/insumos`).send({ usuarioId, itemId: mp.id, cantidad: 1000 });
      await api.put(`/api/charcuteria/lotes/${lote.body.id}/cerrar`).send({ usuarioId, pesoSalidaKg: 1 });
      await api.post(`/api/charcuteria/lotes/${lote.body.id}/envasar`).send({
        usuarioId, skuId, cantidadUnidadesGeneradas: unidades, pesoRealTotalUsadoG: unidades * 200,
      });
      return lote.body.id;
    }

    // El lote "antiguo" se crea primero -> vence antes (mismo vidaUtilDias,
    // fechaVencimiento = fechaElaboracion + vidaUtilDias) que el "nuevo".
    loteAntiguoId = await crearLoteYEnvasar(2);
    await new Promise((r) => setTimeout(r, 1100)); // asegura un fechaElaboracion distinto (granularidad de segundo)
    loteNuevoId = await crearLoteYEnvasar(5);
  });

  it("vende primero del lote que vence antes (FEFO), sin importar cuál se creó después", async () => {
    const venta = await api.post("/api/caja/ventas").send({ usuarioId, auxiliar: true });
    await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: skuProductoEspejoId, cantidad: 1 });
    const v = await api.get(`/api/caja/ventas/${venta.body.id}`);
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: v.body.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });

    expect(confirmar.body.items[0].loteId).toBe(loteAntiguoId);

    const loteAntiguo = await api.get(`/api/charcuteria/lotes/${loteAntiguoId}`);
    expect(loteAntiguo.body.stockPorSku.find((s: { skuId: number }) => s.skuId === skuId).saldoUnidades).toBe(1);
    const loteNuevo = await api.get(`/api/charcuteria/lotes/${loteNuevoId}`);
    expect(loteNuevo.body.stockPorSku.find((s: { skuId: number }) => s.skuId === skuId).saldoUnidades).toBe(5);
  });

  it("nunca reparte una línea entre dos lotes: si el más próximo a vencer no alcanza solo, salta entero al siguiente que sí alcance (no lo completa mezclando ambos)", async () => {
    // Al lote antiguo le queda 1 unidad — pedir 3 no alcanza en ese lote
    // solo, así que FEFO lo descarta como candidato y usa el lote nuevo
    // completo (5 unidades, si alcanza solo) en vez de repartir 1+2 entre
    // los dos.
    const venta = await api.post("/api/caja/ventas").send({ usuarioId, auxiliar: true });
    await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: skuProductoEspejoId, cantidad: 3 });
    const v = await api.get(`/api/caja/ventas/${venta.body.id}`);
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: v.body.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });

    expect(confirmar.status).toBe(200);
    expect(confirmar.body.items[0].loteId).toBe(loteNuevoId);

    // El lote antiguo (1 unidad, no alcanzaba) queda intacto — no se tocó.
    const loteAntiguo = await api.get(`/api/charcuteria/lotes/${loteAntiguoId}`);
    expect(loteAntiguo.body.stockPorSku.find((s: { skuId: number }) => s.skuId === skuId).saldoUnidades).toBe(1);
    const loteNuevo = await api.get(`/api/charcuteria/lotes/${loteNuevoId}`);
    expect(loteNuevo.body.stockPorSku.find((s: { skuId: number }) => s.skuId === skuId).saldoUnidades).toBe(2);
  });

  it("no vende lotes anulados: al anular el lote antiguo, FEFO salta directo al siguiente", async () => {
    await api.put(`/api/charcuteria/lotes/${loteAntiguoId}/anular`).send({ usuarioId, clave: "1234" });

    const venta = await api.post("/api/caja/ventas").send({ usuarioId, auxiliar: true });
    await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: skuProductoEspejoId, cantidad: 1 });
    const v = await api.get(`/api/caja/ventas/${venta.body.id}`);
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: v.body.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });

    expect(confirmar.status).toBe(200);
    expect(confirmar.body.items[0].loteId).toBe(loteNuevoId); // saltó el lote antiguo anulado, aunque le quedaba 1 unidad
  });
});
