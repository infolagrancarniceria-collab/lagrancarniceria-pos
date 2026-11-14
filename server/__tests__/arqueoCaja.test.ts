import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario: al cerrar la caja, contar billetes/monedas por
// separado en vez de escribir un solo número — el desglose queda guardado
// (ArqueoCaja) para poder revisarlo después, independiente del
// efectivoContado final que se usa para la cuadratura.
describe("POST /api/caja/sesiones/:id/cerrar — desglose de efectivo", () => {
  it("guarda el desglose de billetes/monedas y lo devuelve en el resumen", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const desgloseEfectivo = {
      billetes1000: 5,
      billetes2000: 3,
      billetes5000: 2,
      billetes10000: 1,
      billetes20000: 0,
      monedas1: 0,
      monedas5: 0,
      monedas10: 10,
      monedas50: 4,
      monedas100: 2,
      monedas500: 1,
    };
    // 5*1000 + 3*2000 + 2*5000 + 1*10000 + 0 + 10*10 + 4*50 + 2*100 + 1*500 = 31.100
    const totalEsperado = 31100;

    const cierre = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({
      efectivoContado: totalEsperado,
      usuarioId: usuario.id,
      desgloseEfectivo,
    });
    expect(cierre.status).toBe(200);
    expect(cierre.body.arqueo).toBeDefined();
    expect(cierre.body.arqueo.billetes1000).toBe(5);
    expect(cierre.body.arqueo.monedas500).toBe(1);

    const guardado = await prisma.arqueoCaja.findUnique({ where: { sesionCajaId: sesionCaja.id } });
    expect(guardado).toBeTruthy();
    expect(guardado!.billetes2000).toBe(3);
    expect(guardado!.monedas10).toBe(10);

    const resumen = await api.get(`/api/caja/sesiones/${sesionCaja.id}/resumen`);
    expect(resumen.body.arqueo.billetes5000).toBe(2);
  });

  it("cierra igual sin desglose (compatibilidad) y el arqueo queda null", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const cierre = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({
      efectivoContado: 20000,
      usuarioId: usuario.id,
    });
    expect(cierre.status).toBe(200);
    expect(cierre.body.arqueo).toBeNull();
  });

  it("rechaza un desglose con cantidades negativas", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    const cierre = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({
      efectivoContado: 1000,
      usuarioId: usuario.id,
      desgloseEfectivo: {
        billetes1000: -1,
        billetes2000: 0,
        billetes5000: 0,
        billetes10000: 0,
        billetes20000: 0,
        monedas1: 0,
        monedas5: 0,
        monedas10: 0,
        monedas50: 0,
        monedas100: 0,
        monedas500: 0,
      },
    });
    expect(cierre.status).toBe(400);

    const guardado = await prisma.arqueoCaja.findUnique({ where: { sesionCajaId: sesionCaja.id } });
    expect(guardado).toBeNull();
  });
});
