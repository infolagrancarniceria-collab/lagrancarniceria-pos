import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// Ítem 7 del pedido del usuario (Control de precios): "último valor de
// compra" con su fecha, distinto del costo efectivo (que puede ser un
// estimado sin ninguna compra real detrás) — y que el filtro por
// categoría de GET /api/productos siga funcionando con incluirCosto=true.
describe("GET /api/productos?incluirCosto=true — último valor de compra", () => {
  it("trae ultimoCosto y ultimoCostoFecha de la compra más reciente", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();

    await prisma.movimientoInventario.create({
      data: {
        productoId: productoCarniceria.id,
        usuarioId: usuario.id,
        tipo: "entrada",
        motivo: "compra",
        cantidad: 10,
        costoUnitario: 9000,
        fecha: new Date("2026-01-01"),
      },
    });
    const masReciente = await prisma.movimientoInventario.create({
      data: {
        productoId: productoCarniceria.id,
        usuarioId: usuario.id,
        tipo: "entrada",
        motivo: "compra",
        cantidad: 10,
        costoUnitario: 9500,
        fecha: new Date("2026-02-01"),
      },
    });

    const res = await api.get("/api/productos?incluirCosto=true");
    expect(res.status).toBe(200);
    const producto = res.body.find((p: { id: number }) => p.id === productoCarniceria.id);
    expect(producto.ultimoCosto).toBe(9500);
    expect(new Date(producto.ultimoCostoFecha).toISOString()).toBe(masReciente.fecha.toISOString());
    expect(producto.costoEsEstimado).toBe(false);
  });

  it("sin ninguna compra real, costoEsEstimado queda true y ultimoCostoFecha null", async () => {
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT-CP-${Date.now()}`, nombre: "Control precios test", nivel: 1 } });
    const producto = await prisma.producto.create({
      data: { plu: `PLU-CP-${Date.now()}`, descripcion: "Sin compra real", categoriaId: categoria.id, precio: 5000, flagBalanza: "NORMAL", costoReferencia: 2000 },
    });

    const res = await api.get(`/api/productos?incluirCosto=true&categoriaId=${categoria.id}`);
    expect(res.status).toBe(200);
    const fila = res.body.find((p: { id: number }) => p.id === producto.id);
    expect(fila.ultimoCosto).toBeNull();
    expect(fila.ultimoCostoFecha).toBeNull();
    expect(fila.costoEsEstimado).toBe(true);
    expect(fila.costoEfectivo).toBe(2000);
  });

  it("filtra por categoría (y sus subcategorías) igual que el listado normal", async () => {
    const otraCategoria = await prisma.categoria.create({ data: { codigo: `CAT-CP2-${Date.now()}`, nombre: "Otra categoría control precios", nivel: 1 } });
    const otroProducto = await prisma.producto.create({
      data: { plu: `PLU-CP2-${Date.now()}`, descripcion: "De otra categoría", categoriaId: otraCategoria.id, precio: 3000, flagBalanza: "NORMAL" },
    });
    const { productoCarniceria } = await crearFixturesBasicas();

    const res = await api.get(`/api/productos?incluirCosto=true&categoriaId=${otraCategoria.id}`);
    expect(res.status).toBe(200);
    expect(res.body.some((p: { id: number }) => p.id === otroProducto.id)).toBe(true);
    expect(res.body.some((p: { id: number }) => p.id === productoCarniceria.id)).toBe(false);
  });
});
