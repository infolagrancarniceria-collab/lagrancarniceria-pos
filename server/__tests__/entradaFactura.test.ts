import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario, "Cargar factura" (POST /entrada-factura) volvió a
// quedar disponible, pero restringida: solo productos que no se venden por
// peso (flagBalanza !== "PESABLE") o que son de la categoría raíz
// "Congelados" — la carne fresca por peso sigue entrando exclusivamente por
// Ingreso a cámara (ver server/routes/camara.ts).
describe("POST /api/inventario/entrada-factura — restricción a congelados/por unidad", () => {
  it("rechaza una línea de un producto PESABLE que no es de Congelados", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor Test ${Date.now()}` } });

    const res = await api.post("/api/inventario/entrada-factura").send({
      proveedorId: proveedor.id,
      numeroFactura: `F-${Date.now()}`,
      usuarioId: usuario.id,
      lineas: [{ productoId: productoCarniceria.id, cantidad: 5, costoUnitario: 1000 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/se vende por peso/);
    const movimientos = await prisma.movimientoInventario.findMany({ where: { productoId: productoCarniceria.id } });
    expect(movimientos).toHaveLength(0);
  });

  it("acepta una línea de un producto PESABLE de la categoría Congelados", async () => {
    const { usuario } = await crearFixturesBasicas();
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor Test ${Date.now()}` } });
    const categoriaCongelados = await prisma.categoria.create({
      data: { codigo: `CONG-${Date.now()}`, nombre: "Congelados", nivel: 1 },
    });
    const productoCongelado = await prisma.producto.create({
      data: {
        plu: `PLU-CONG-${Date.now()}`,
        descripcion: "Pulpa congelada test",
        categoriaId: categoriaCongelados.id,
        precio: 5990,
        flagBalanza: "PESABLE",
        stockActual: 0,
      },
    });

    const res = await api.post("/api/inventario/entrada-factura").send({
      proveedorId: proveedor.id,
      numeroFactura: `F-${Date.now()}`,
      usuarioId: usuario.id,
      lineas: [{ productoId: productoCongelado.id, cantidad: 10, costoUnitario: 2000 }],
    });

    expect(res.status).toBe(201);
    const producto = await prisma.producto.findUniqueOrThrow({ where: { id: productoCongelado.id } });
    expect(producto.stockActual).toBe(10);
  });

  it("acepta una línea de un producto no PESABLE (venta por unidad) de cualquier categoría", async () => {
    const { usuario } = await crearFixturesBasicas();
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor Test ${Date.now()}` } });
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT2-${Date.now()}`, nombre: "Envasados test", nivel: 1 } });
    const productoUnidad = await prisma.producto.create({
      data: {
        plu: `PLU-UNI-${Date.now()}`,
        descripcion: "Salsa envasada test",
        categoriaId: categoria.id,
        precio: 2990,
        flagBalanza: "NORMAL",
        stockActual: 0,
      },
    });

    const res = await api.post("/api/inventario/entrada-factura").send({
      proveedorId: proveedor.id,
      numeroFactura: `F-${Date.now()}`,
      usuarioId: usuario.id,
      lineas: [{ productoId: productoUnidad.id, cantidad: 24, costoUnitario: 900 }],
    });

    expect(res.status).toBe(201);
  });

  it("actualiza el umbral de stock bajo del producto cuando se indica en la línea", async () => {
    const { usuario } = await crearFixturesBasicas();
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor Test ${Date.now()}` } });
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT3-${Date.now()}`, nombre: "Envasados test 2", nivel: 1 } });
    const producto = await prisma.producto.create({
      data: {
        plu: `PLU-UMB-${Date.now()}`,
        descripcion: "Conserva test",
        categoriaId: categoria.id,
        precio: 1990,
        flagBalanza: "NORMAL",
        stockActual: 0,
        umbralStockBajo: null,
      },
    });

    const res = await api.post("/api/inventario/entrada-factura").send({
      proveedorId: proveedor.id,
      numeroFactura: `F-${Date.now()}`,
      usuarioId: usuario.id,
      lineas: [{ productoId: producto.id, cantidad: 12, costoUnitario: 500, umbralStockBajo: 6 }],
    });

    expect(res.status).toBe(201);
    const actualizado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect(actualizado.umbralStockBajo).toBe(6);
  });
});
