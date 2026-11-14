import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario: corregir un lote de cámara ya ingresado ahora
// necesita autorización (motivo + clave de supervisor), igual que
// anularlo — antes cualquier usuario podía corregirlo sin dejar rastro de
// quién aprobó el cambio.
describe("PUT /api/camara/lotes/:id — pide autorización para corregir", () => {
  async function crearLote(usuarioId: number, productoId: number) {
    return prisma.loteCamara.create({
      data: {
        productoId,
        familiaNombre: "Vacuno",
        procedencia: "Nacional",
        cantidadCajas: 1,
        pesoTotalKg: 10,
        costoNetoKg: 6000,
        totalNeto: 60000,
        creadoPorId: usuarioId,
        cajas: {
          create: {
            productoId,
            familiaNombre: "Vacuno",
            procedencia: "Nacional",
            pesoInicialKg: 10,
            saldoKg: 10,
            costoNetoKg: 6000,
            creadoPorId: usuarioId,
          },
        },
      },
    });
  }

  it("rechaza la corrección sin clave de supervisor", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const lote = await crearLote(usuario.id, productoCarniceria.id);

    const res = await api.put(`/api/camara/lotes/${lote.id}`).send({
      productoId: productoCarniceria.id,
      familia: "Vacuno",
      procedencia: "Nacional",
      pesoTotalKg: 12,
      costoNetoKg: 6200,
      usuarioId: usuario.id,
      motivo: "Peso mal ingresado",
    });

    expect(res.status).toBe(400);
  });

  it("rechaza la corrección con clave de supervisor incorrecta", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const lote = await crearLote(usuario.id, productoCarniceria.id);

    const res = await api.put(`/api/camara/lotes/${lote.id}`).send({
      productoId: productoCarniceria.id,
      familia: "Vacuno",
      procedencia: "Nacional",
      pesoTotalKg: 12,
      costoNetoKg: 6200,
      usuarioId: usuario.id,
      motivo: "Peso mal ingresado",
      clave: "clave-incorrecta",
    });

    expect(res.status).toBe(403);
    const sinCambios = await prisma.loteCamara.findUniqueOrThrow({ where: { id: lote.id } });
    expect(sinCambios.pesoTotalKg).toBe(10);
  });

  it("corrige el lote con clave válida y guarda el motivo en el historial", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const lote = await crearLote(usuario.id, productoCarniceria.id);

    const res = await api.put(`/api/camara/lotes/${lote.id}`).send({
      productoId: productoCarniceria.id,
      familia: "Vacuno",
      procedencia: "Nacional",
      pesoTotalKg: 12,
      costoNetoKg: 6200,
      usuarioId: usuario.id,
      motivo: "Peso mal ingresado",
      clave: "1234",
    });

    expect(res.status).toBe(200);
    const corregido = await prisma.loteCamara.findUniqueOrThrow({ where: { id: lote.id } });
    expect(corregido.pesoTotalKg).toBe(12);
    expect(corregido.costoNetoKg).toBe(6200);

    const correccion = await prisma.correccionLoteCamara.findFirstOrThrow({ where: { loteId: lote.id } });
    expect(correccion.motivo).toBe("Peso mal ingresado");
    expect(correccion.pesoTotalAnteriorKg).toBe(10);
  });
});
