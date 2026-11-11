import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Ítem 5 del pedido del usuario: "mostrar el detalle de compras, ventas por
// internet y gastos por separado con filtro por fecha". El detalle de
// gastos ya se prueba en reporteUtilidad.test.ts junto con la utilidad —
// acá se cubren compras (nuevo en /api/reportes/inventario) y ventas por
// internet (nuevo en /api/reportes/ventas).
describe("Detalle de compras en /api/reportes/inventario", () => {
  it("una entrada de inventario con motivo compra suma a comprasTotal y aparece en comprasDetalle", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor Test ${Date.now()}` } });

    await prisma.movimientoInventario.create({
      data: {
        productoId: productoCarniceria.id,
        usuarioId: usuario.id,
        tipo: "entrada",
        motivo: "compra",
        cantidad: 10,
        costoUnitario: 4000,
        proveedorId: proveedor.id,
        numeroFactura: "F-1234",
      },
    });

    const res = await api.get(`/api/reportes/inventario?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    expect(res.body.comprasTotal).toBeGreaterThanOrEqual(40000);
    const linea = res.body.comprasDetalle.find((c: { numeroFactura: string }) => c.numeroFactura === "F-1234");
    expect(linea).toBeDefined();
    expect(linea.proveedor).toBe(proveedor.nombre);
    expect(linea.cantidad).toBe(10);
    expect(linea.costoUnitario).toBe(4000);
    expect(linea.subtotal).toBe(40000);
  });

  it("una entrada por ajuste (sin motivo compra) no suma a comprasTotal", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();

    await prisma.movimientoInventario.create({
      data: { productoId: productoCarniceria.id, usuarioId: usuario.id, tipo: "entrada", motivo: "ajuste", cantidad: 5 },
    });

    const res = await api.get(`/api/reportes/inventario?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    expect(res.body.comprasDetalle.some((c: { cantidad: number }) => c.cantidad === 5)).toBe(false);
  });
});

describe("Detalle de compras — también incluye lotes de Ingreso a cámara", () => {
  it("un lote de cámara aparece en comprasDetalle con fuente camara y suma a comprasTotal", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor Cámara ${Date.now()}` } });

    const lote = await prisma.loteCamara.create({
      data: {
        productoId: productoCarniceria.id,
        familiaNombre: "Vacuno",
        procedencia: "Nacional",
        cantidadCajas: 3,
        pesoTotalKg: 45,
        costoNetoKg: 6000,
        totalNeto: 270000,
        proveedorId: proveedor.id,
        numeroFactura: "CAM-5678",
        creadoPorId: usuario.id,
      },
    });

    const res = await api.get(`/api/reportes/inventario?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    expect(res.body.comprasTotal).toBeGreaterThanOrEqual(270000);
    const linea = res.body.comprasDetalle.find((c: { id: number; fuente: string }) => c.id === lote.id && c.fuente === "camara");
    expect(linea).toBeDefined();
    expect(linea.proveedor).toBe(proveedor.nombre);
    expect(linea.numeroFactura).toBe("CAM-5678");
    expect(linea.cantidad).toBe(45);
    expect(linea.costoUnitario).toBe(6000);
    expect(linea.subtotal).toBe(270000);
  });
});

describe("Detalle de ventas por internet en /api/reportes/ventas", () => {
  it("una venta pagada con canal online aparece en ventasOnlineDetalle con su cantidad de items", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 8990, canal: "online" },
    });
    await prisma.itemVenta.create({
      data: { ventaId: venta.id, productoId: productoCarniceria.id, cantidad: 1, precioUnitario: 8990, subtotal: 8990 },
    });

    const res = await api.get(`/api/reportes/ventas?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    const detalle = res.body.ventasOnlineDetalle.find((v: { id: number }) => v.id === venta.id);
    expect(detalle).toBeDefined();
    expect(detalle.total).toBe(8990);
    expect(detalle.cantidadItems).toBe(1);
  });

  it("una venta local (canal por defecto) no aparece en ventasOnlineDetalle", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();
    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, estado: "pagada", total: 1000 },
    });

    const res = await api.get(`/api/reportes/ventas?desde=${hoy()}&hasta=${hoy()}`);
    expect(res.status).toBe(200);
    expect(res.body.ventasOnlineDetalle.some((v: { id: number }) => v.id === venta.id)).toBe(false);
  });
});
