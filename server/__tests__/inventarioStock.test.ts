import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario, para ubicar un producto rápido en un catálogo largo
// al revisar el stock (antes solo se podía filtrar por categoría completa
// o ver todo el listado plano).
describe("GET /api/inventario/stock — filtro de búsqueda", () => {
  it("filtra por PLU o descripción, sin importar mayúsculas", async () => {
    const { productoCarniceria } = await crearFixturesBasicas();

    const porDescripcion = await api.get(`/api/inventario/stock?buscar=lomo vetado`);
    expect(porDescripcion.status).toBe(200);
    expect(porDescripcion.body.some((p: { id: number }) => p.id === productoCarniceria.id)).toBe(true);

    const porPlu = await api.get(`/api/inventario/stock?buscar=${productoCarniceria.plu}`);
    expect(porPlu.status).toBe(200);
    expect(porPlu.body.some((p: { id: number }) => p.id === productoCarniceria.id)).toBe(true);
  });

  it("no devuelve productos que no calzan con el texto buscado", async () => {
    await crearFixturesBasicas();

    const res = await api.get(`/api/inventario/stock?buscar=texto-que-no-existe-${Date.now()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
