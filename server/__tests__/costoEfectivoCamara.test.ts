import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// Bug reportado por el usuario: el costo "efectivo" de un producto (usado
// en Control de precios, Mejor margen, Reportes de utilidad y el
// Asistente) solo miraba las compras de "Cargar factura"
// (MovimientoInventario) — nunca las de "Ingreso a cámara" (LoteCamara).
// Como la mayoría de la carne fresca entra solo por cámara, su costo
// quedaba desactualizado (o nunca cargado) a pesar de registrarse compras
// reales ahí. Corregido para usar la compra real más reciente entre
// ambas fuentes (ver resolverCostoEfectivo en productos.ts).
describe("Costo efectivo considera también las compras de Ingreso a cámara", () => {
  it("GET /api/productos?incluirCosto=true usa el costo de cámara cuando es la única compra real", async () => {
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT-CAM-${Date.now()}`, nombre: "Camara test", nivel: 1 } });
    const producto = await prisma.producto.create({
      data: { plu: `PLU-CAM-${Date.now()}`, descripcion: "Solo compra por cámara", categoriaId: categoria.id, precio: 15000, flagBalanza: "PESABLE" },
    });
    const { usuario } = await crearFixturesBasicas();
    await prisma.loteCamara.create({
      data: {
        productoId: producto.id,
        familiaNombre: "Vacuno",
        procedencia: "Nacional",
        cantidadCajas: 1,
        pesoTotalKg: 20,
        costoNetoKg: 7500,
        totalNeto: 150000,
        creadoPorId: usuario.id,
      },
    });

    const res = await api.get("/api/productos?incluirCosto=true");
    expect(res.status).toBe(200);
    const fila = res.body.find((p: { id: number }) => p.id === producto.id);
    expect(fila.costoEfectivo).toBe(7500);
    expect(fila.costoEsEstimado).toBe(false);
  });

  it("usa la compra MÁS RECIENTE entre factura y cámara, no siempre la de factura", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();

    await prisma.movimientoInventario.create({
      data: {
        productoId: productoCarniceria.id,
        usuarioId: usuario.id,
        tipo: "entrada",
        motivo: "compra",
        cantidad: 10,
        costoUnitario: 8000,
        fecha: new Date("2026-01-01"),
      },
    });
    await prisma.loteCamara.create({
      data: {
        productoId: productoCarniceria.id,
        familiaNombre: "Vacuno",
        cantidadCajas: 1,
        pesoTotalKg: 10,
        costoNetoKg: 9000,
        totalNeto: 90000,
        creadoPorId: usuario.id,
        fechaIngreso: new Date("2026-02-01"),
      },
    });

    const res = await api.get("/api/productos?incluirCosto=true");
    const fila = res.body.find((p: { id: number }) => p.id === productoCarniceria.id);
    expect(fila.costoEfectivo).toBe(9000);

    // Si la factura es la más reciente, debe ganar ella en vez de cámara.
    await prisma.movimientoInventario.create({
      data: {
        productoId: productoCarniceria.id,
        usuarioId: usuario.id,
        tipo: "entrada",
        motivo: "compra",
        cantidad: 10,
        costoUnitario: 8500,
        fecha: new Date("2026-03-01"),
      },
    });
    const res2 = await api.get("/api/productos?incluirCosto=true");
    const fila2 = res2.body.find((p: { id: number }) => p.id === productoCarniceria.id);
    expect(fila2.costoEfectivo).toBe(8500);
  });

  it("GET /api/productos/margenes incluye un producto que solo compró por cámara (antes quedaba fuera de conCosto)", async () => {
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT-CAM2-${Date.now()}`, nombre: "Camara margenes test", nivel: 1 } });
    const producto = await prisma.producto.create({
      data: { plu: `PLU-CAM2-${Date.now()}`, descripcion: "Solo cámara, para margenes", categoriaId: categoria.id, precio: 12000, flagBalanza: "PESABLE" },
    });
    const { usuario } = await crearFixturesBasicas();
    await prisma.loteCamara.create({
      data: {
        productoId: producto.id,
        familiaNombre: "Cerdo",
        cantidadCajas: 1,
        pesoTotalKg: 15,
        costoNetoKg: 5000,
        totalNeto: 75000,
        creadoPorId: usuario.id,
      },
    });

    const res = await api.get(`/api/productos/margenes?categoriaId=${categoria.id}`);
    expect(res.status).toBe(200);
    const fila = res.body.conCosto.find((p: { id: number }) => p.id === producto.id);
    expect(fila).toBeDefined();
    expect(fila.costoEfectivo).toBe(5000);
  });

  it("GET /api/productos/:id también resuelve el costo efectivo con la compra de cámara", async () => {
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT-CAM3-${Date.now()}`, nombre: "Camara ficha test", nivel: 1 } });
    const producto = await prisma.producto.create({
      data: { plu: `PLU-CAM3-${Date.now()}`, descripcion: "Ficha, solo cámara", categoriaId: categoria.id, precio: 9000, flagBalanza: "PESABLE" },
    });
    const { usuario } = await crearFixturesBasicas();
    await prisma.loteCamara.create({
      data: {
        productoId: producto.id,
        familiaNombre: "Pollo",
        cantidadCajas: 1,
        pesoTotalKg: 8,
        costoNetoKg: 3200,
        totalNeto: 25600,
        creadoPorId: usuario.id,
      },
    });

    const res = await api.get(`/api/productos/${producto.id}`);
    expect(res.status).toBe(200);
    expect(res.body.costoEfectivo).toBe(3200);
    expect(res.body.costoEsEstimado).toBe(false);
  });
});
