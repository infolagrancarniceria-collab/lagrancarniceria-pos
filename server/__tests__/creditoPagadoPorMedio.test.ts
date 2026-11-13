import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

async function crearVentaACredito(sesionCajaId: number, usuarioId: number, monto: number) {
  const venta = await prisma.venta.create({
    data: { sesionCajaId, usuarioId, estado: "pagada", total: monto },
  });
  const pago = await prisma.pagoVenta.create({
    data: { ventaId: venta.id, medio: "credito", monto, clienteNombre: "Cliente Test", cobrado: false },
  });
  return { venta, pago };
}

// El endpoint de cobro (POST /creditos/:pagoId/cobrar) asume que solo hay
// UNA sesión "abierta" a la vez (como en producción) — cada test cierra la
// suya al terminar para no contaminar el resto de los tests del archivo,
// que se corren contra la misma base.
async function cerrarSesion(sesionCajaId: number) {
  await prisma.sesionCaja.update({ where: { id: sesionCajaId }, data: { estado: "cerrada" } });
}

// A pedido del usuario: el cierre de caja necesita mostrar claramente si un
// crédito pagado hoy entró como efectivo, tarjeta o transferencia (antes
// solo existía un número sin desglosar, y ni siquiera se podía cobrar un
// crédito por transferencia).
describe("Créditos pagados por medio en el resumen de sesión", () => {
  it("cobrarCredito acepta transferencia y no la mezcla con efectivo/tarjeta", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const { pago } = await crearVentaACredito(sesionCaja.id, usuario.id, 15000);

    const cobro = await api.post(`/api/caja/creditos/${pago.id}/cobrar`).send({
      medioCobro: "transferencia",
      usuarioId: usuario.id,
    });
    expect(cobro.status).toBe(200);
    expect(cobro.body.medioCobro).toBe("transferencia");

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.cobrosCreditoPorMedio.transferencia).toBe(15000);
    expect(resumen.body.cobrosCreditoPorMedio.efectivo).toBe(0);
    expect(resumen.body.totalCobrosCredito).toBe(15000);
    // Un crédito cobrado por transferencia no es plata física en el cajón.
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial);

    await cerrarSesion(sesionCaja.id);
  });

  it("desglosa correctamente cuando se cobran varios créditos por distintos medios", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const { pago: pagoEfectivo } = await crearVentaACredito(sesionCaja.id, usuario.id, 5000);
    const { pago: pagoTarjeta } = await crearVentaACredito(sesionCaja.id, usuario.id, 7000);
    const { pago: pagoTransferencia } = await crearVentaACredito(sesionCaja.id, usuario.id, 9000);

    await api.post(`/api/caja/creditos/${pagoEfectivo.id}/cobrar`).send({ medioCobro: "efectivo", usuarioId: usuario.id });
    await api.post(`/api/caja/creditos/${pagoTarjeta.id}/cobrar`).send({ medioCobro: "tarjeta", usuarioId: usuario.id });
    await api.post(`/api/caja/creditos/${pagoTransferencia.id}/cobrar`).send({ medioCobro: "transferencia", usuarioId: usuario.id });

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.cobrosCreditoPorMedio.efectivo).toBe(5000);
    expect(resumen.body.cobrosCreditoPorMedio.tarjeta).toBe(7000);
    expect(resumen.body.cobrosCreditoPorMedio.transferencia).toBe(9000);
    expect(resumen.body.totalCobrosCredito).toBe(21000);
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial + 5000);

    await cerrarSesion(sesionCaja.id);
  });

  it("totalVentas incluye una venta a crédito aunque el cliente todavía no pague", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    await crearVentaACredito(sesionCaja.id, usuario.id, 12345);

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.totalVentas).toBe(12345);
    expect(resumen.body.totalPorMedio.credito).toBe(12345);
    // El crédito otorgado no suma al efectivo esperado hasta que se cobre.
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial);

    await cerrarSesion(sesionCaja.id);
  });
});
