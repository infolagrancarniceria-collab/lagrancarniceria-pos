import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

async function venderProducto(sesionCajaId: number, usuarioId: number, productoId: number, cantidad: number, precioUnitario: number) {
  const venta = await prisma.venta.create({
    data: { sesionCajaId, usuarioId, estado: "pagada", total: cantidad * precioUnitario },
  });
  await prisma.itemVenta.create({
    data: { ventaId: venta.id, productoId, cantidad, precioUnitario, subtotal: cantidad * precioUnitario },
  });
}

// Ítem 5 del pedido del usuario: "menos vendidos" (nuevo) y poder ver el
// detalle de una categoría puntual (porCategoria[].masVendidos, para la
// pestaña "Comparar fechas").
describe("GET /api/reportes/ventas — menos vendidos y detalle por categoría", () => {
  it("menosVendidosPorCantidad ordena ascendente y no incluye productos sin ninguna venta", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();
    const productoSinVentas = await prisma.producto.create({
      data: {
        plu: `PLU-SINVENTA-${Date.now()}`,
        descripcion: "Nunca se vendió",
        categoriaId: productoCarniceria.categoriaId,
        precio: 1000,
        flagBalanza: "NORMAL",
        stockActual: 10,
      },
    });
    const productoMasVendido = await prisma.producto.create({
      data: {
        plu: `PLU-MASVENDIDO-${Date.now()}`,
        descripcion: "Se vende mucho",
        categoriaId: productoCarniceria.categoriaId,
        precio: 1000,
        flagBalanza: "NORMAL",
        stockActual: 50,
      },
    });

    await venderProducto(sesionCaja.id, usuario.id, productoCarniceria.id, 2, 8990);
    await venderProducto(sesionCaja.id, usuario.id, productoMasVendido.id, 20, 1000);
    void productoSinVentas;

    const res = await api.get(`/api/reportes/ventas?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);

    const ids = res.body.menosVendidosPorCantidad.map((p: { productoId: number }) => p.productoId);
    expect(ids).not.toContain(productoSinVentas.id);
    const indiceMenosVendido = ids.indexOf(productoCarniceria.id);
    const indiceMasVendido = ids.indexOf(productoMasVendido.id);
    expect(indiceMenosVendido).toBeGreaterThanOrEqual(0);
    expect(indiceMasVendido).toBeGreaterThanOrEqual(0);
    expect(indiceMenosVendido).toBeLessThan(indiceMasVendido);
  });

  it("porCategoria[].masVendidos solo trae productos de esa categoría, no de otras", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();
    const otraCategoria = await prisma.categoria.create({
      data: { codigo: `CAT-OTRA-VENTAS-${Date.now()}`, nombre: "Otra categoría ventas test", nivel: 1 },
    });
    const productoOtraCategoria = await prisma.producto.create({
      data: {
        plu: `PLU-OTRACAT-${Date.now()}`,
        descripcion: "De otra categoría",
        categoriaId: otraCategoria.id,
        precio: 2000,
        flagBalanza: "NORMAL",
        stockActual: 10,
      },
    });

    await venderProducto(sesionCaja.id, usuario.id, productoCarniceria.id, 3, 8990);
    await venderProducto(sesionCaja.id, usuario.id, productoOtraCategoria.id, 4, 2000);

    const res = await api.get(`/api/reportes/ventas?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);

    const categoriaDelProducto = await prisma.categoria.findUnique({ where: { id: productoCarniceria.categoriaId } });
    const filaCategoria = res.body.porCategoria.find((c: { categoria: string }) => c.categoria === categoriaDelProducto!.nombre);
    expect(filaCategoria).toBeDefined();
    const idsMasVendidos = filaCategoria.masVendidos.map((p: { productoId: number }) => p.productoId);
    expect(idsMasVendidos).toContain(productoCarniceria.id);
    expect(idsMasVendidos).not.toContain(productoOtraCategoria.id);

    const filaOtraCategoria = res.body.porCategoria.find((c: { categoria: string }) => c.categoria === "Otra categoría ventas test");
    expect(filaOtraCategoria).toBeDefined();
    const idsOtraCategoria = filaOtraCategoria.masVendidos.map((p: { productoId: number }) => p.productoId);
    expect(idsOtraCategoria).toContain(productoOtraCategoria.id);
    expect(idsOtraCategoria).not.toContain(productoCarniceria.id);
  });
});
