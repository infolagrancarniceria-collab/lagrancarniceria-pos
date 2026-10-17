import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// crearFixturesBasicas abre la sesión "ahora" (fechaApertura: default now())
// — para probar un corte a mitad del turno sin que termine cayendo en el
// futuro (el endpoint lo rechaza a propósito), se retrasa la apertura unas
// horas antes de cada test.
async function retrasarApertura(sesionId: number, horasAtras: number): Promise<Date> {
  const fechaApertura = new Date(Date.now() - horasAtras * 60 * 60 * 1000);
  await prisma.sesionCaja.update({ where: { id: sesionId }, data: { fechaApertura } });
  return fechaApertura;
}

// Pensado para cuando a alguien se le olvidó cerrar la caja antes de
// medianoche y siguió vendiendo al día siguiente — todo queda mezclado en
// una sola SesionCaja, sin forma de separar el reporte X/Z de cada día.
describe("Dividir una sesión de caja por hora de corte", () => {
  it("separa las ventas antes/después del corte en dos sesiones distintas, y deja la actual arrancando en el corte", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const apertura = await retrasarApertura(sesionCaja.id, 3);
    const corte = new Date(apertura.getTime() + 60 * 60 * 1000); // 1h después de abrir

    const ventaAntes1 = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 1000, fecha: new Date(apertura.getTime() + 10 * 60 * 1000) },
    });
    const ventaAntes2 = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 2000, fecha: new Date(apertura.getTime() + 20 * 60 * 1000) },
    });
    const ventaDespues = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 3000, fecha: new Date(corte.getTime() + 60 * 1000) },
    });

    const res = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: corte.toISOString(), usuarioId: usuario.id, clave: "1234" });

    expect(res.status).toBe(200);
    expect(res.body.sesionAnterior.sesion.estado).toBe("cerrada");
    expect(res.body.sesionAnterior.cantidadVentas).toBe(2);
    expect(res.body.sesionAnterior.totalVentas).toBe(3000);
    expect(new Date(res.body.sesionAnterior.sesion.fechaApertura).getTime()).toBe(apertura.getTime());
    expect(new Date(res.body.sesionAnterior.sesion.fechaCierre).getTime()).toBe(corte.getTime());

    expect(res.body.sesionActual.sesion.id).toBe(sesionCaja.id);
    expect(res.body.sesionActual.sesion.estado).toBe("abierta");
    expect(res.body.sesionActual.cantidadVentas).toBe(1);
    expect(res.body.sesionActual.totalVentas).toBe(3000);
    expect(new Date(res.body.sesionActual.sesion.fechaApertura).getTime()).toBe(corte.getTime());

    const sesionActualizada = await prisma.sesionCaja.findUnique({ where: { id: sesionCaja.id } });
    expect(sesionActualizada!.fechaApertura.getTime()).toBe(corte.getTime());

    const [a1, a2, d] = await Promise.all([
      prisma.venta.findUnique({ where: { id: ventaAntes1.id } }),
      prisma.venta.findUnique({ where: { id: ventaAntes2.id } }),
      prisma.venta.findUnique({ where: { id: ventaDespues.id } }),
    ]);
    expect(a1!.sesionCajaId).toBe(res.body.sesionAnterior.sesion.id);
    expect(a2!.sesionCajaId).toBe(res.body.sesionAnterior.sesion.id);
    expect(d!.sesionCajaId).toBe(sesionCaja.id);
  });

  it("también reasigna los retiros/ingresos de caja anteriores al corte", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const apertura = await retrasarApertura(sesionCaja.id, 3);
    const corte = new Date(apertura.getTime() + 60 * 60 * 1000);

    await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 1000, fecha: new Date(apertura.getTime() + 5 * 60 * 1000) },
    });
    const retiro = await prisma.retiroCaja.create({
      data: {
        sesionCajaId: sesionCaja.id,
        tipo: "retiro",
        monto: 500,
        motivo: "Pago a proveedor",
        usuarioAutorizoId: usuario.id,
        fecha: new Date(apertura.getTime() + 15 * 60 * 1000),
      },
    });

    const res = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: corte.toISOString(), usuarioId: usuario.id, clave: "1234" });

    expect(res.status).toBe(200);
    expect(res.body.sesionAnterior.totalRetiros).toBe(500);

    const retiroActualizado = await prisma.retiroCaja.findUnique({ where: { id: retiro.id } });
    expect(retiroActualizado!.sesionCajaId).toBe(res.body.sesionAnterior.sesion.id);
  });

  it("rechaza dividir una sesión que ya está cerrada", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    await prisma.sesionCaja.update({ where: { id: sesionCaja.id }, data: { estado: "cerrada", fechaCierre: new Date() } });

    const res = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: new Date().toISOString(), usuarioId: usuario.id, clave: "1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sigue abierta/i);
  });

  it("rechaza un corte anterior a la apertura o posterior a ahora", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const apertura = await retrasarApertura(sesionCaja.id, 3);

    const corteAntesDeAbrir = new Date(apertura.getTime() - 60 * 60 * 1000);
    const res1 = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: corteAntesDeAbrir.toISOString(), usuarioId: usuario.id, clave: "1234" });
    expect(res1.status).toBe(400);

    const corteFuturo = new Date(Date.now() + 60 * 60 * 1000);
    const res2 = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: corteFuturo.toISOString(), usuarioId: usuario.id, clave: "1234" });
    expect(res2.status).toBe(400);
  });

  it("rechaza dividir si no hay ninguna venta antes del corte elegido", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const apertura = await retrasarApertura(sesionCaja.id, 3);
    const corte = new Date(apertura.getTime() + 60 * 60 * 1000);

    const res = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: corte.toISOString(), usuarioId: usuario.id, clave: "1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no hay/i);
  });

  it("rechaza una clave de supervisor incorrecta", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const apertura = await retrasarApertura(sesionCaja.id, 3);
    const corte = new Date(apertura.getTime() + 60 * 60 * 1000);
    await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 1000, fecha: new Date(apertura.getTime() + 5 * 60 * 1000) },
    });

    const res = await api
      .post(`/api/caja/sesiones/${sesionCaja.id}/dividir`)
      .send({ corte: corte.toISOString(), usuarioId: usuario.id, clave: "clave-incorrecta" });

    expect(res.status).toBe(403);
  });
});
