import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// Antes, la pantalla de Venta mayorista no tenía forma de volver a
// encontrar una venta que ya estaba en curso: si el cajero salía a atender
// la caja a mitad de armarla y volvía, lo único que podía hacer era tocar
// "Iniciar venta mayorista" de nuevo, creando una venta nueva y dejando la
// anterior (con sus líneas ya cargadas) abierta para siempre. Este endpoint
// es lo que la pantalla usa ahora para retomarla en vez de duplicarla.
describe("GET /ventas/mayorista/abierta", () => {
  it("devuelve null si el usuario no tiene ninguna venta mayorista en curso", async () => {
    const { usuario } = await crearFixturesBasicas();
    const res = await api.get(`/api/caja/ventas/mayorista/abierta?usuarioId=${usuario.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("devuelve la venta mayorista abierta de ese usuario, con sus líneas", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    await prisma.categoria.update({
      where: { id: productoCarniceria.categoriaId },
      data: { porcentajeCobroMayorista: 0.19 },
    });

    const creada = await api.post("/api/caja/ventas/mayorista").send({ usuarioId: usuario.id });
    expect(creada.status).toBe(201);
    await api.post(`/api/caja/ventas/${creada.body.id}/items/mayorista`).send({
      usuarioId: usuario.id,
      productoId: productoCarniceria.id,
      cantidad: 5,
      precioNetoUnitario: 1000,
      origen: "sala_venta",
    });

    const res = await api.get(`/api/caja/ventas/mayorista/abierta?usuarioId=${usuario.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(creada.body.id);
    expect(res.body.items).toHaveLength(1);
  });

  it("no devuelve la venta mayorista de otro usuario", async () => {
    const { usuario: usuarioA } = await crearFixturesBasicas();
    const { usuario: usuarioB } = await crearFixturesBasicas();

    await api.post("/api/caja/ventas/mayorista").send({ usuarioId: usuarioA.id });

    const res = await api.get(`/api/caja/ventas/mayorista/abierta?usuarioId=${usuarioB.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("no devuelve una venta mayorista ya pagada", async () => {
    const { usuario } = await crearFixturesBasicas();

    const creada = await api.post("/api/caja/ventas/mayorista").send({ usuarioId: usuario.id });
    await prisma.venta.update({ where: { id: creada.body.id }, data: { estado: "pagada" } });

    const res = await api.get(`/api/caja/ventas/mayorista/abierta?usuarioId=${usuario.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});
