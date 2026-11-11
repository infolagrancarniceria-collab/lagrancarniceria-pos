import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario: corregir el efectivo o la tarjeta de un día cuando
// algo quedó mal registrado (ej. un pago con el medio equivocado), sin
// pisar ninguna venta ni pago real. Mismo patrón de autorización que
// retiros/ingresos de caja (clave de supervisor), pero a diferencia de
// esos, también debe poder aplicarse sobre una sesión ya cerrada —
// corregir "lo de ayer" es el caso de uso real.
describe("Ajuste de cuadratura (corrección de efectivo/tarjeta)", () => {
  it("una corrección de suma en efectivo aumenta totalAjustesEfectivo y el efectivoEsperado del resumen", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const res = await api.post(`/api/caja/sesiones/${sesionCaja.id}/ajustes-cuadratura`).send({
      medio: "efectivo",
      direccion: "suma",
      monto: 5000,
      motivo: "Pago con tarjeta registrado por error como efectivo",
      usuarioId: usuario.id,
      clave: "1234",
    });
    expect(res.status).toBe(201);
    expect(res.body.medio).toBe("efectivo");
    expect(res.body.direccion).toBe("suma");
    expect(res.body.monto).toBe(5000);

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.totalAjustesEfectivo).toBe(5000);
    expect(resumen.body.totalAjustesTarjeta).toBe(0);
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial + 5000);
  });

  it("una corrección de resta en tarjeta no afecta el efectivo esperado (no es dinero en la caja física)", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const res = await api.post(`/api/caja/sesiones/${sesionCaja.id}/ajustes-cuadratura`).send({
      medio: "tarjeta",
      direccion: "resta",
      monto: 3000,
      motivo: "Venta con tarjeta anulada, no se descontó sola",
      usuarioId: usuario.id,
      clave: "1234",
    });
    expect(res.status).toBe(201);

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.totalAjustesTarjeta).toBe(-3000);
    expect(resumen.body.totalAjustesEfectivo).toBe(0);
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial);
  });

  it("rechaza una clave de supervisor incorrecta y no crea el ajuste", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const res = await api.post(`/api/caja/sesiones/${sesionCaja.id}/ajustes-cuadratura`).send({
      medio: "efectivo",
      direccion: "suma",
      monto: 1000,
      motivo: "Intento con clave mala",
      usuarioId: usuario.id,
      clave: "clave-incorrecta",
    });
    expect(res.status).toBe(403);

    const ajustes = await prisma.ajusteCuadratura.findMany({ where: { sesionCajaId: sesionCaja.id } });
    expect(ajustes).toHaveLength(0);
  });

  it("se puede corregir una sesión ya cerrada, a diferencia de un retiro", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const cierre = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({
      efectivoContado: sesionCaja.fondoFijoInicial,
      usuarioId: usuario.id,
    });
    expect(cierre.status).toBe(200);

    const res = await api.post(`/api/caja/sesiones/${sesionCaja.id}/ajustes-cuadratura`).send({
      medio: "efectivo",
      direccion: "suma",
      monto: 2000,
      motivo: "Corrección de un día ya cerrado",
      usuarioId: usuario.id,
      clave: "1234",
    });
    expect(res.status).toBe(201);

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.totalAjustesEfectivo).toBe(2000);
  });
});
