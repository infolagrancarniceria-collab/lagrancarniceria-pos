import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario: antes de una cuadratura física de inventario,
// poder llevar el stock a 0 de golpe (todo el catálogo, o solo una
// categoría) sin perder rastro de por qué — mismo patrón de autorización
// que RetiroCaja/AjusteCuadratura (motivo + clave de supervisor).
describe("POST /api/inventario/reiniciar", () => {
  it("reinicio global pone en 0 el stock de todos los productos con stock distinto de 0 y deja un ajuste por producto", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    await prisma.producto.update({ where: { id: productoCarniceria.id }, data: { stockActual: 25 } });

    const res = await api.post("/api/inventario/reiniciar").send({
      alcance: "global",
      motivo: "Cuadratura física de prueba",
      usuarioId: usuario.id,
      clave: "1234",
    });
    expect(res.status).toBe(201);
    expect(res.body.alcance).toBe("global");
    expect(res.body.cantidadProductosAfectados).toBeGreaterThanOrEqual(1);

    const productoActualizado = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(productoActualizado!.stockActual).toBe(0);

    const movimiento = await prisma.movimientoInventario.findFirst({
      where: { productoId: productoCarniceria.id, motivo: "ajuste", tipo: "salida" },
    });
    expect(movimiento).toBeTruthy();
    expect(movimiento!.cantidad).toBe(25);
  });

  it("un producto con stock negativo se reinicia con un ajuste de tipo entrada (no salida)", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    await prisma.producto.update({ where: { id: productoCarniceria.id }, data: { stockActual: -4 } });

    const res = await api.post("/api/inventario/reiniciar").send({
      alcance: "global",
      motivo: "Corrige stock negativo",
      usuarioId: usuario.id,
      clave: "1234",
    });
    expect(res.status).toBe(201);

    const productoActualizado = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(productoActualizado!.stockActual).toBe(0);

    const movimiento = await prisma.movimientoInventario.findFirst({
      where: { productoId: productoCarniceria.id, motivo: "ajuste", tipo: "entrada" },
    });
    expect(movimiento).toBeTruthy();
    expect(movimiento!.cantidad).toBe(4);
  });

  it("reinicio por categoría solo afecta los productos de esa categoría raíz, no otras", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    await prisma.producto.update({ where: { id: productoCarniceria.id }, data: { stockActual: 12 } });

    const otraCategoria = await prisma.categoria.create({
      data: { codigo: `CAT-OTRA-${Date.now()}`, nombre: "Otra categoría test", nivel: 1 },
    });
    const otroProducto = await prisma.producto.create({
      data: {
        plu: `PLU-OTRA-${Date.now()}`,
        descripcion: "Producto de otra categoría",
        categoriaId: otraCategoria.id,
        precio: 1000,
        flagBalanza: "NORMAL",
        stockActual: 7,
      },
    });

    const res = await api.post("/api/inventario/reiniciar").send({
      alcance: "categoria",
      categoriaId: otraCategoria.id,
      motivo: "Solo esta categoría",
      usuarioId: usuario.id,
      clave: "1234",
    });
    expect(res.status).toBe(201);
    expect(res.body.cantidadProductosAfectados).toBe(1);

    const otroActualizado = await prisma.producto.findUnique({ where: { id: otroProducto.id } });
    expect(otroActualizado!.stockActual).toBe(0);

    const carniceriaSinTocar = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(carniceriaSinTocar!.stockActual).toBe(12);
  });

  it("rechaza una clave de supervisor incorrecta y no modifica ningún stock", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    await prisma.producto.update({ where: { id: productoCarniceria.id }, data: { stockActual: 30 } });

    const res = await api.post("/api/inventario/reiniciar").send({
      alcance: "global",
      motivo: "Intento con clave mala",
      usuarioId: usuario.id,
      clave: "clave-incorrecta",
    });
    expect(res.status).toBe(403);

    const productoSinTocar = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(productoSinTocar!.stockActual).toBe(30);
  });
});

describe("GET /api/inventario/reiniciar/preview", () => {
  it("cuenta los productos con stock distinto de 0 que se verían afectados", async () => {
    const { productoCarniceria } = await crearFixturesBasicas();
    await prisma.producto.update({ where: { id: productoCarniceria.id }, data: { stockActual: 9 } });

    const res = await api.get("/api/inventario/reiniciar/preview?alcance=global");
    expect(res.status).toBe(200);
    expect(res.body.cantidadProductos).toBeGreaterThanOrEqual(1);
  });
});
