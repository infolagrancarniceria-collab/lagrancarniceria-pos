import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// POST /gastos liga el gasto a "la" sesión abierta (findFirst sin filtrar
// por id, como en producción solo hay una) — cada test cierra la suya al
// terminar para no contaminar el resto de los tests del archivo, que
// corren contra la misma base compartida.
async function cerrarSesion(sesionCajaId: number) {
  await prisma.sesionCaja.update({ where: { id: sesionCajaId }, data: { estado: "cerrada" } });
}

// A pedido del usuario: los gastos quedan ligados a la sesión abierta y se
// siguen pudiendo ver por medio de pago (gastosPorMedio/totalGastos), pero
// YA NO se restan del efectivo esperado — un gasto familiar que el dueño no
// considera parte del negocio descuadraba la caja sin que correspondiera.
// Si sale plata física del cajón por cualquier motivo, debe quedar como un
// "Retiro" (RetiroCaja) para que el efectivo esperado siga siendo exacto.
describe("Gastos pagados en efectivo y el cierre de caja", () => {
  it("un gasto cargado con una caja abierta se liga a esa sesión pero NO se resta del efectivo esperado", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const gasto = await api.post("/api/gastos").send({
      categoria: "Transporte",
      descripcion: "Flete proveedor",
      monto: 8000,
      medioPago: "efectivo",
      usuarioId: usuario.id,
    });
    expect(gasto.status).toBe(201);
    expect(gasto.body.sesionCajaId).toBe(sesionCaja.id);
    expect(gasto.body.medioPago).toBe("efectivo");

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.gastosPorMedio.efectivo).toBe(8000);
    expect(resumen.body.totalGastos).toBe(8000);
    expect(resumen.body.totalGastosEfectivo).toBe(8000);
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial);

    await cerrarSesion(sesionCaja.id);
  });

  it("un gasto pagado con tarjeta/transferencia no se resta del efectivo esperado", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    await api.post("/api/gastos").send({
      categoria: "Servicios",
      descripcion: "Internet",
      monto: 15000,
      medioPago: "transferencia",
      usuarioId: usuario.id,
    });

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.gastosPorMedio.transferencia).toBe(15000);
    expect(resumen.body.totalGastos).toBe(15000);
    expect(resumen.body.totalGastosEfectivo).toBe(0);
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial);

    await cerrarSesion(sesionCaja.id);
  });

  it("un gasto cargado con una fecha pasada a mano no se liga a la caja de hoy", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const gasto = await api.post("/api/gastos").send({
      categoria: "Sueldos",
      descripcion: "Sueldo atrasado",
      monto: 50000,
      medioPago: "efectivo",
      fecha: "2020-01-15",
      usuarioId: usuario.id,
    });
    expect(gasto.status).toBe(201);
    expect(gasto.body.sesionCajaId).toBeNull();

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.totalGastosEfectivo).toBe(0);
    expect(resumen.body.efectivoEsperado).toBe(sesionCaja.fondoFijoInicial);

    await cerrarSesion(sesionCaja.id);
  });

  it("el gasto por defecto queda en efectivo si no se manda medioPago", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const gasto = await api.post("/api/gastos").send({
      categoria: "Otros",
      descripcion: "Gasto chico",
      monto: 2000,
      usuarioId: usuario.id,
    });
    expect(gasto.status).toBe(201);
    expect(gasto.body.medioPago).toBe("efectivo");

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.totalGastosEfectivo).toBe(2000);

    await cerrarSesion(sesionCaja.id);
  });
});
