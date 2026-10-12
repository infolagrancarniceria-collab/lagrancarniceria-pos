import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

async function crearCategoriaConPct(nombre: string, pct: number | null) {
  const categoria = await prisma.categoria.create({
    data: { codigo: `CAT-MAY-${nombre}-${Date.now()}-${Math.random()}`, nombre, nivel: 1, porcentajeCobroMayorista: pct },
  });
  return categoria;
}

async function crearCajaCamara(usuarioId: number, productoId: number, saldoKg: number) {
  return prisma.cajaCamara.create({
    data: {
      productoId,
      familiaNombre: "Otros",
      pesoInicialKg: saldoKg,
      saldoKg,
      costoNetoKg: 1000,
      creadoPorId: usuarioId,
    },
  });
}

describe("Venta Mayorista — armar y cobrar", () => {
  let usuarioId: number;
  let categoriaPolloId: number;
  let productoPollo: { id: number; descripcion: string };

  beforeAll(async () => {
    const { usuario } = await crearFixturesBasicas();
    usuarioId = usuario.id;

    const categoria = await crearCategoriaConPct("Pollo", 0.19);
    categoriaPolloId = categoria.id;
    productoPollo = await prisma.producto.create({
      data: {
        plu: `PLU-POLLO-${Date.now()}`,
        descripcion: "Trutro entero",
        categoriaId: categoriaPolloId,
        precio: 3000,
        flagBalanza: "PESABLE",
        stockActual: 100,
      },
    });
  });

  it("crea una venta mayorista (canal mayorista, auxiliar, no bloquea el mesón)", async () => {
    const res = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    expect(res.status).toBe(201);
    expect(res.body.canal).toBe("mayorista");
    expect(res.body.esAuxiliar).toBe(true);
    expect(res.body.estado).toBe("abierta");
  });

  it("agrega una línea de sala de venta: aplica el % de la categoría sobre el subtotal neto", async () => {
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    const item = await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: productoPollo.id,
      cantidad: 20,
      precioNetoUnitario: 2250,
      origen: "sala_venta",
    });

    expect(item.status).toBe(201);
    const linea = item.body.items[0];
    // neto = 20*2250 = 45000 ; con 19% = 45000*1.19 = 53550
    expect(linea.precioNetoUnitario).toBe(2250);
    expect(linea.porcentajeCobro).toBe(0.19);
    expect(linea.subtotal).toBe(53550);
    expect(item.body.total).toBe(53550);
  });

  it("rechaza agregar una línea si la categoría del producto no tiene % configurado", async () => {
    const categoriaSinPct = await crearCategoriaConPct("SinConfigurar", null);
    const productoSinPct = await prisma.producto.create({
      data: { plu: `PLU-SINPCT-${Date.now()}`, descripcion: "Producto sin %", categoriaId: categoriaSinPct.id, precio: 1000, flagBalanza: "PESABLE", stockActual: 10 },
    });
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });

    const item = await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: productoSinPct.id,
      cantidad: 5,
      precioNetoUnitario: 1000,
      origen: "sala_venta",
    });

    expect(item.status).toBe(400);
    expect(item.body.error).toContain("% de cobro mayorista");
  });

  it("crea un producto rápido al vuelo si no existe en el catálogo todavía", async () => {
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    const item = await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoNuevo: { descripcion: "Ala normal", categoriaId: categoriaPolloId, flagBalanza: "PESABLE" },
      cantidad: 10,
      precioNetoUnitario: 2200,
      origen: "sala_venta",
    });

    expect(item.status).toBe(201);
    const creado = await prisma.producto.findUnique({ where: { plu: item.body.items[0].producto.plu } });
    expect(creado?.descripcion).toBe("Ala normal");
    expect(creado?.creadoRapido).toBe(true);
    expect(creado?.precioMayor).toBe(2200);
  });

  it("descuenta Producto.stockActual (no una caja de cámara) al confirmar una línea de sala de venta", async () => {
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: productoPollo.id,
      cantidad: 10,
      precioNetoUnitario: 2250,
      origen: "sala_venta",
    });
    const stockAntes = (await prisma.producto.findUnique({ where: { id: productoPollo.id } }))!.stockActual;
    const ventaActual = await prisma.venta.findUnique({ where: { id: venta.body.id } });
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: ventaActual!.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });
    expect(confirmar.status).toBe(200);

    const productoActualizado = await prisma.producto.findUnique({ where: { id: productoPollo.id } });
    expect(productoActualizado?.stockActual).toBe(stockAntes - 10);
  });
});

describe("Venta Mayorista — línea que sale de una caja de Cámara", () => {
  let usuarioId: number;
  let categoriaId: number;
  let producto: { id: number };

  beforeAll(async () => {
    const { usuario } = await crearFixturesBasicas();
    usuarioId = usuario.id;
    const categoria = await crearCategoriaConPct("Cerdo", 0.24);
    categoriaId = categoria.id;
    producto = await prisma.producto.create({
      data: { plu: `PLU-CERDO-${Date.now()}`, descripcion: "Lomo centro", categoriaId, precio: 4000, flagBalanza: "PESABLE", stockActual: 50 },
    });
  });

  it("descuenta la caja de cámara (no Producto.stockActual) y crea el MovimientoCamara correspondiente", async () => {
    const caja = await crearCajaCamara(usuarioId, producto.id, 16.24);
    const stockAntes = (await prisma.producto.findUnique({ where: { id: producto.id } }))!.stockActual;

    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    const item = await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: producto.id,
      cantidad: 16.24,
      precioNetoUnitario: 4100,
      origen: "camara",
      cajaCamaraId: caja.id,
    });
    expect(item.status).toBe(201);
    // neto = 16.24*4100 = 66584 ; con 24% = 66584*1.24 = 82564.16 -> redondeado 82564
    expect(item.body.items[0].subtotal).toBe(82564);

    const confirmar = await api
      .post(`/api/caja/ventas/${venta.body.id}/pagos`)
      .send({ medio: "efectivo", monto: 82564 })
      .then(() => api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId }));
    expect(confirmar.status).toBe(200);

    const productoDespues = await prisma.producto.findUnique({ where: { id: producto.id } });
    expect(productoDespues?.stockActual).toBe(stockAntes); // sin cambios

    const cajaDespues = await prisma.cajaCamara.findUnique({ where: { id: caja.id } });
    expect(cajaDespues?.saldoKg).toBe(0);
    expect(cajaDespues?.estado).toBe("salida"); // se vació completa

    const movimiento = await prisma.movimientoCamara.findFirst({ where: { referenciaTipo: "Venta", referenciaId: venta.body.id } });
    expect(movimiento?.destino).toBe("mayorista");
    expect(movimiento?.tipo).toBe("salida_completa");
    expect(movimiento?.pesoKg).toBe(16.24);
  });

  it("no deja sacar más peso del que tiene la caja", async () => {
    const caja = await crearCajaCamara(usuarioId, producto.id, 5);
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    const item = await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: producto.id,
      cantidad: 10,
      precioNetoUnitario: 4000,
      origen: "camara",
      cajaCamaraId: caja.id,
    });
    expect(item.status).toBe(400);
    expect(item.body.error).toMatch(/disponibles/);
  });

  it("al anular una venta confirmada con línea de cámara, devuelve el peso a la caja", async () => {
    const caja = await crearCajaCamara(usuarioId, producto.id, 10);
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: producto.id,
      cantidad: 4,
      precioNetoUnitario: 4000,
      origen: "camara",
      cajaCamaraId: caja.id,
    });
    const ventaActual = await prisma.venta.findUnique({ where: { id: venta.body.id } });
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: ventaActual!.total });
    await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });

    const cajaAntesDeAnular = await prisma.cajaCamara.findUnique({ where: { id: caja.id } });
    expect(cajaAntesDeAnular?.saldoKg).toBe(6); // 10 - 4

    const cancelar = await api
      .post(`/api/caja/ventas/${venta.body.id}/cancelar`)
      .send({ clave: "1234", usuarioId, motivo: "prueba" });
    expect(cancelar.status).toBe(200);

    const cajaDespues = await prisma.cajaCamara.findUnique({ where: { id: caja.id } });
    expect(cajaDespues?.saldoKg).toBe(10); // devuelto completo
    expect(cajaDespues?.estado).toBe("en_camara");
  });
});

describe("Venta Mayorista — pendiente de pago y reportes", () => {
  let usuarioId: number;
  let categoriaId: number;
  let producto: { id: number };

  beforeAll(async () => {
    const { usuario } = await crearFixturesBasicas();
    usuarioId = usuario.id;
    const categoria = await crearCategoriaConPct("Vacuno", 0.24);
    categoriaId = categoria.id;
    producto = await prisma.producto.create({
      data: { plu: `PLU-VAC-${Date.now()}`, descripcion: "Posta negra", categoriaId, precio: 6000, flagBalanza: "PESABLE", stockActual: 100 },
    });
  });

  async function armarYConfirmarPendiente() {
    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId });
    await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId,
      productoId: producto.id,
      cantidad: 5,
      precioNetoUnitario: 5000,
      origen: "sala_venta",
    });
    const ventaActual = await prisma.venta.findUnique({ where: { id: venta.body.id } });
    const pago = await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "mayorista", monto: ventaActual!.total });
    expect(pago.status).toBe(201);
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });
    expect(confirmar.status).toBe(200);
    return { ventaId: venta.body.id, pagoId: confirmar.body.pagos[0].id, total: ventaActual!.total };
  }

  it("deja el pago pendiente (cobrado:false) y aparece en /creditos-pendientes?medio=mayorista", async () => {
    const { pagoId } = await armarYConfirmarPendiente();

    const pago = await prisma.pagoVenta.findUnique({ where: { id: pagoId } });
    expect(pago?.medio).toBe("mayorista");
    expect(pago?.cobrado).toBe(false);

    const pendientes = await api.get("/api/caja/creditos-pendientes?medio=mayorista");
    expect(pendientes.body.some((p: { id: number }) => p.id === pagoId)).toBe(true);

    const sinFiltro = await api.get("/api/caja/creditos-pendientes");
    expect(sinFiltro.body.some((p: { id: number }) => p.id === pagoId)).toBe(false);
  });

  it("se puede cobrar después a través de /creditos/:pagoId/cobrar", async () => {
    const { pagoId } = await armarYConfirmarPendiente();
    const cobro = await api.post(`/api/caja/creditos/${pagoId}/cobrar`).send({ medioCobro: "efectivo", usuarioId });
    expect(cobro.status).toBe(200);
    expect(cobro.body.cobrado).toBe(true);
  });

  it("Reportes separa el total mayorista del de mesón/online", async () => {
    const { total } = await armarYConfirmarPendiente();

    const reporte = await api.get("/api/reportes/ventas");
    expect(reporte.status).toBe(200);
    expect(reporte.body.totalVentasMayorista).toBeGreaterThanOrEqual(total);
    expect(reporte.body.cantidadVentasMayorista).toBeGreaterThanOrEqual(1);
  });
});

describe("Venta Mayorista — no pisa el precio negociado si cambia el precio de catálogo", () => {
  it("un cambio de precio normal del producto no toca precioUnitario de un ítem mayorista abierto", async () => {
    const { usuario } = await crearFixturesBasicas();
    const categoria = await crearCategoriaConPct("Pollo2", 0.19);
    const producto = await prisma.producto.create({
      data: { plu: `PLU-CASC-${Date.now()}`, descripcion: "Pechuga entera", categoriaId: categoria.id, precio: 3200, flagBalanza: "PESABLE", stockActual: 30 },
    });

    const venta = await api.post("/api/caja/ventas/mayorista").send({ usuarioId: usuario.id });
    await api.post(`/api/caja/ventas/${venta.body.id}/items/mayorista`).send({
      usuarioId: usuario.id,
      productoId: producto.id,
      cantidad: 10,
      precioNetoUnitario: 3200,
      origen: "sala_venta",
    });

    const cambioPrecio = await api
      .post("/api/precios/individual")
      .send({ productoId: producto.id, precioNuevo: 9999, usuarioId: usuario.id });
    expect(cambioPrecio.status).toBe(200);

    const ventaActual = await prisma.venta.findUnique({ where: { id: venta.body.id }, include: { items: true } });
    // neto 10*3200=32000 ; con 19% = 38080 — NO 9999*10
    expect(ventaActual?.items[0].precioUnitario).toBe(3808);
    expect(ventaActual?.items[0].subtotal).toBe(38080);
  });
});

describe("Categorías — % de cobro mayorista", () => {
  it("se puede configurar solo en una categoría raíz (nivel 1)", async () => {
    const raiz = await prisma.categoria.create({
      data: { codigo: `CAT-RAIZ-${Date.now()}`, nombre: "Raíz test", nivel: 1 },
    });
    const res = await api.put(`/api/categorias/${raiz.id}/porcentaje-cobro-mayorista`).send({ porcentajeCobroMayorista: 0.22 });
    expect(res.status).toBe(200);
    expect(res.body.porcentajeCobroMayorista).toBe(0.22);
  });

  it("rechaza configurarlo en una subcategoría", async () => {
    const raiz = await prisma.categoria.create({
      data: { codigo: `CAT-RAIZ2-${Date.now()}`, nombre: "Raíz test 2", nivel: 1 },
    });
    const hija = await prisma.categoria.create({
      data: { codigo: `CAT-HIJA-${Date.now()}`, nombre: "Subcategoría", nivel: 2, padreId: raiz.id },
    });
    const res = await api.put(`/api/categorias/${hija.id}/porcentaje-cobro-mayorista`).send({ porcentajeCobroMayorista: 0.2 });
    expect(res.status).toBe(400);
  });
});
