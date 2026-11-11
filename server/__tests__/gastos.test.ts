import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// descripcion pasó a ser el "nombre del gasto", obligatorio — a pedido del
// usuario, para no terminar con una lista de gastos que solo dice la
// categoría y nada de qué fue en concreto.
describe("POST /api/gastos", () => {
  it("rechaza un gasto sin nombre (descripción) en el body", async () => {
    const { usuario } = await crearFixturesBasicas();

    const res = await api.post("/api/gastos").send({ categoria: "Luz", monto: 5000, usuarioId: usuario.id });

    expect(res.status).toBe(400);
  });

  it("rechaza un gasto con el nombre en blanco", async () => {
    const { usuario } = await crearFixturesBasicas();

    const res = await api
      .post("/api/gastos")
      .send({ categoria: "Luz", descripcion: "   ", monto: 5000, usuarioId: usuario.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nombre/i);
  });

  it("registra un gasto con nombre, categoría y monto", async () => {
    const { usuario } = await crearFixturesBasicas();

    const res = await api
      .post("/api/gastos")
      .send({ categoria: "Luz", descripcion: "Cuenta de luz octubre", monto: 5000, usuarioId: usuario.id });

    expect(res.status).toBe(201);
    expect(res.body.descripcion).toBe("Cuenta de luz octubre");
  });

  // A pedido del usuario: poder cargar un gasto con una fecha anterior a
  // hoy (ej. se olvidó registrarlo el día que ocurrió), no solo "ahora".
  it("registra un gasto con una fecha elegida a mano, no la de hoy", async () => {
    const { usuario } = await crearFixturesBasicas();
    const fechaElegida = "2026-01-15";

    const res = await api.post("/api/gastos").send({
      categoria: "Luz",
      descripcion: "Cuenta de luz de enero",
      monto: 5000,
      fecha: fechaElegida,
      usuarioId: usuario.id,
    });

    expect(res.status).toBe(201);
    expect(new Date(res.body.fecha).toISOString().slice(0, 10)).toBe(fechaElegida);
  });
});
