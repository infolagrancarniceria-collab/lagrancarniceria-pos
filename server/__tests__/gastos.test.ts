import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
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

  // Ítem 6 del pedido del usuario: agrupar gastos dentro de una categoría
  // por "concepto" (ej. "Transporte" → Transportista, Combustible), de
  // manera manual — concepto es opcional y no reemplaza a descripcion.
  it("registra un gasto con concepto y lo devuelve en la respuesta", async () => {
    const { usuario } = await crearFixturesBasicas();

    const res = await api.post("/api/gastos").send({
      categoria: "Transporte",
      concepto: "Transportista",
      descripcion: "Pago transportista noviembre",
      monto: 80000,
      usuarioId: usuario.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.concepto).toBe("Transportista");
  });
});

// Lista manejada a mano de categorías de gasto (CategoriaGasto) — a
// pedido del usuario, para poder "generar categorías" en vez de depender
// de un campo libre.
describe("Categorías de gasto manejadas", () => {
  it("crea una categoría y la lista entre las activas", async () => {
    const nombre = `Transporte-${Date.now()}`;
    const creada = await api.post("/api/gastos/categorias").send({ nombre });
    expect(creada.status).toBe(201);

    const listado = await api.get("/api/gastos/categorias");
    expect(listado.status).toBe(200);
    expect(listado.body.some((c: { nombre: string }) => c.nombre === nombre)).toBe(true);
  });

  it("rechaza crear una categoría duplicada (mismo nombre, activa)", async () => {
    const nombre = `Luz-${Date.now()}`;
    await api.post("/api/gastos/categorias").send({ nombre });

    const res = await api.post("/api/gastos/categorias").send({ nombre });
    expect(res.status).toBe(400);
  });

  it("al desactivar una categoría, ya no aparece en el listado por defecto, pero los gastos ya cargados con ese nombre no cambian", async () => {
    const { usuario } = await crearFixturesBasicas();
    const nombre = `Arriendo-${Date.now()}`;
    const creada = await api.post("/api/gastos/categorias").send({ nombre });

    await prisma.gasto.create({ data: { categoria: nombre, descripcion: "Arriendo local", monto: 350000, usuarioId: usuario.id } });

    const desactivada = await api.put(`/api/gastos/categorias/${creada.body.id}/desactivar`);
    expect(desactivada.status).toBe(200);
    expect(desactivada.body.activo).toBe(false);

    const listado = await api.get("/api/gastos/categorias");
    expect(listado.body.some((c: { nombre: string }) => c.nombre === nombre)).toBe(false);

    const gastos = await prisma.gasto.findMany({ where: { categoria: nombre } });
    expect(gastos).toHaveLength(1);
  });
});

// Ítem 6: ver, dentro de una categoría, el desglose por concepto (ej.
// "Transporte" → cuánto a Transportista, cuánto a Combustible).
describe("GET /api/gastos/reporte — desglose por concepto", () => {
  it("agrupa totalPorCategoriaYConcepto por categoria y luego por concepto", async () => {
    const { usuario } = await crearFixturesBasicas();
    const hoy = new Date().toISOString().slice(0, 10);
    const categoria = `Transporte-${Date.now()}`;

    await api.post("/api/gastos").send({
      categoria,
      concepto: "Transportista",
      descripcion: "Pago transportista",
      monto: 80000,
      usuarioId: usuario.id,
    });
    await api.post("/api/gastos").send({
      categoria,
      concepto: "Combustible",
      descripcion: "Bencina camioneta",
      monto: 30000,
      usuarioId: usuario.id,
    });
    await api.post("/api/gastos").send({
      categoria,
      descripcion: "Gasto sin concepto cargado",
      monto: 5000,
      usuarioId: usuario.id,
    });

    const res = await api.get(`/api/gastos/reporte?desde=${hoy}&hasta=${hoy}`);
    expect(res.status).toBe(200);
    expect(res.body.totalPorCategoriaYConcepto[categoria]).toEqual({
      Transportista: 80000,
      Combustible: 30000,
      "Sin concepto": 5000,
    });
  });
});
