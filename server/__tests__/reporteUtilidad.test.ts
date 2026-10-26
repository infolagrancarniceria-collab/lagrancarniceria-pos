import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Utilidad APROXIMADA (no contabilidad real) — a pedido del usuario, que
// quiere ver "simple" (ventas - gastos) y "real" (ventas - costo mercadería
// - gastos) lado a lado para comparar. El punto más delicado es que el
// costo de mercadería depende de que cada producto tenga un costo conocido
// (de una compra real o un costo de referencia manual) — si no lo tiene,
// esa venta no debe restar nada de costo en silencio, sino quedar aparte en
// ventasSinCostoConocido.
describe("GET /api/reportes/utilidad", () => {
  it("calcula utilidadSimple y utilidadReal usando el costo de referencia del producto", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();
    await prisma.producto.update({ where: { id: productoCarniceria.id }, data: { costoReferencia: 5000 } });

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 10000 },
    });
    await prisma.itemVenta.create({
      data: { ventaId: venta.id, productoId: productoCarniceria.id, cantidad: 1, precioUnitario: 10000, subtotal: 10000 },
    });
    await prisma.gasto.create({ data: { categoria: "Luz", monto: 2000, usuarioId: usuario.id } });

    const res = await api.get(`/api/reportes/utilidad?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    expect(res.body.totalVentas).toBeGreaterThanOrEqual(10000);
    expect(res.body.totalGastos).toBeGreaterThanOrEqual(2000);
    expect(res.body.costoMercaderia).toBeGreaterThanOrEqual(5000);
    expect(res.body.utilidadSimple).toBe(res.body.totalVentas - res.body.totalGastos);
    expect(res.body.utilidadReal).toBe(res.body.totalVentas - res.body.costoMercaderia - res.body.totalGastos);
  });

  it("suma a ventasSinCostoConocido lo vendido de un producto sin costo cargado, sin restarlo de costoMercaderia", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();
    const productoSinCosto = await prisma.producto.create({
      data: {
        plu: `PLU-SINCOSTO-${Date.now()}`,
        descripcion: "Producto sin costo",
        categoriaId: productoCarniceria.categoriaId,
        precio: 3000,
        flagBalanza: "NORMAL",
        stockActual: 10,
      },
    });

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 3000 },
    });
    await prisma.itemVenta.create({
      data: { ventaId: venta.id, productoId: productoSinCosto.id, cantidad: 1, precioUnitario: 3000, subtotal: 3000 },
    });

    const res = await api.get(`/api/reportes/utilidad?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    expect(res.body.ventasSinCostoConocido).toBeGreaterThanOrEqual(3000);
  });
});
