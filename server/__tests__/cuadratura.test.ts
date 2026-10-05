import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// Antes de este fix, una venta con medio "pedido_web" quedaba sumada en
// totalVentas pero el desglose por medio (totalPorMedio) no traía esa
// clave inicializada ni agregada en /cuadratura — el reporte que usa el
// dueño para cuadrar la caja mostraba un "Total ventas" que no coincidía
// con la suma de las filas de medios de pago que sí se mostraban, apenas
// hubiera una venta de Caja Online ese día.
describe("Resumen de sesión / cuadratura — pedido_web no se pierde del desglose", () => {
  it("una venta pagada con medio pedido_web aparece en totalPorMedio.pedido_web del resumen de la sesión", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, esAuxiliar: true },
    });
    await api.post(`/api/caja/ventas/${venta.id}/items`).send({ productoId: productoCarniceria.id, cantidad: 1 });
    const conPago = await api.post(`/api/caja/ventas/${venta.id}/pagos`).send({ medio: "pedido_web", monto: 8990 });
    expect(conPago.status).toBe(201);
    const confirmar = await api.post(`/api/caja/ventas/${venta.id}/confirmar`).send({ usuarioId: usuario.id });
    expect(confirmar.status).toBe(200);

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.status).toBe(200);
    expect(resumen.body.totalPorMedio.pedido_web).toBe(8990);
    expect(resumen.body.totalVentas).toBe(8990);
  });

  it("al cobrar un pedido web pendiente, se suma a totalCobrosPedidoWeb (no a totalCobrosCredito)", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, esAuxiliar: true },
    });
    await api.post(`/api/caja/ventas/${venta.id}/items`).send({ productoId: productoCarniceria.id, cantidad: 1 });
    await api.post(`/api/caja/ventas/${venta.id}/pagos`).send({ medio: "pedido_web", monto: 8990 });
    const confirmar = await api.post(`/api/caja/ventas/${venta.id}/confirmar`).send({ usuarioId: usuario.id });
    const pagoPedidoWeb = confirmar.body.pagos.find((p: { medio: string }) => p.medio === "pedido_web");

    const cobro = await api
      .post(`/api/caja/creditos/${pagoPedidoWeb.id}/cobrar`)
      .send({ medioCobro: "efectivo", usuarioId: usuario.id });
    expect(cobro.status).toBe(200);

    // El cobro queda atribuido a la sesión que esté abierta en ese momento
    // (puede no ser sesionCaja si otro test en este mismo archivo dejó una
    // sesión abierta sin cerrar antes) — se consulta la sesión real del
    // cobro en vez de asumir que es sesionCaja.id.
    const resumen = await api.get(`/api/caja/sesiones/${cobro.body.sesionCajaCobroId}/resumen`);
    expect(resumen.body.totalCobrosPedidoWeb).toBe(8990);
    expect(resumen.body.totalCobrosCredito).toBe(0);
  });

  it("/cuadratura trae pedido_web en el desglose del día, sumado dentro del rango de fechas", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, esAuxiliar: true },
    });
    await api.post(`/api/caja/ventas/${venta.id}/items`).send({ productoId: productoCarniceria.id, cantidad: 1 });
    await api.post(`/api/caja/ventas/${venta.id}/pagos`).send({ medio: "pedido_web", monto: 8990 });
    await api.post(`/api/caja/ventas/${venta.id}/confirmar`).send({ usuarioId: usuario.id });

    const hoy = new Date().toISOString().slice(0, 10);
    const cuadratura = await api.get(`/api/caja/cuadratura?desde=${hoy}&hasta=${hoy}`);
    expect(cuadratura.status).toBe(200);
    const dia = cuadratura.body.dias.find((d: { sesion: { id: number } }) => d.sesion.id === sesionCaja.id);
    expect(dia.totalPorMedio.pedido_web).toBe(8990);
  });
});
