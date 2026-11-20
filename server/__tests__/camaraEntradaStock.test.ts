import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// A pedido del usuario: el stock de venta (Producto.stockActual) debe
// subir de inmediato al cargar una factura de mercadería a Cámara (modo
// "Por kilo"), sin un paso aparte — antes solo subía cuando, más tarde, se
// hacía "Salida de cajas" a sala de venta, y si eso no pasaba el stock de
// venta quedaba desactualizado contra la mercadería real. Ver el
// comentario en crearLoteYCajas (server/routes/camara.ts).
describe("Cámara — entrada de factura suma de inmediato a Producto.stockActual", () => {
  it("POST /cajas (entrada de un solo producto) suma el peso al stock", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const stockAntes = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;

    const res = await api.post("/api/camara/cajas").send({
      productoId: productoCarniceria.id,
      familia: "Otros",
      cantidadCajas: 1,
      pesoTotalKg: 12.5,
      costoNetoKg: 5000,
      usuarioId: usuario.id,
    });
    expect(res.status).toBe(201);

    const productoDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(productoDespues?.stockActual).toBeCloseTo(stockAntes + 12.5, 5);
  });

  it("POST /cajas/factura suma el peso de cada línea a su producto", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const categoria2 = await prisma.categoria.create({ data: { codigo: `CAT-${Date.now()}-${Math.random()}`, nombre: "Cerdo test", nivel: 1 } });
    const producto2 = await prisma.producto.create({
      data: { plu: `PLU-${Date.now()}-${Math.random()}`, descripcion: "Costillar test", categoriaId: categoria2.id, precio: 5990, flagBalanza: "PESABLE", stockActual: 0 },
    });
    const proveedor = await prisma.proveedor.create({ data: { nombre: `Proveedor-${Date.now()}-${Math.random()}` } });

    const stockAntes1 = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;

    const res = await api.post("/api/camara/cajas/factura").send({
      proveedorId: proveedor.id,
      numeroFactura: `F-${Date.now()}`,
      usuarioId: usuario.id,
      lineas: [
        { productoId: productoCarniceria.id, familia: "Otros", cantidadCajas: 2, pesoTotalKg: 20, costoNetoKg: 4000 },
        { productoId: producto2.id, familia: "Cerdo", cantidadCajas: 1, pesoTotalKg: 8, costoNetoKg: 3500 },
      ],
    });
    expect(res.status).toBe(201);

    const p1Despues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(p1Despues?.stockActual).toBeCloseTo(stockAntes1 + 20, 5);
    const p2Despues = await prisma.producto.findUnique({ where: { id: producto2.id } });
    expect(p2Despues?.stockActual).toBeCloseTo(8, 5);
  });
});

describe("Cámara — salida de cajas y Producto.stockActual", () => {
  async function entrarCaja(usuarioId: number, productoId: number, pesoKg: number) {
    const res = await api.post("/api/camara/cajas").send({
      productoId,
      familia: "Otros",
      cantidadCajas: 1,
      pesoTotalKg: pesoKg,
      costoNetoKg: 5000,
      usuarioId,
    });
    return res.body[0] as { id: number; version: number };
  }

  it("destino sala_venta NO cambia el stock (ya se contó al entrar)", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const caja = await entrarCaja(usuario.id, productoCarniceria.id, 10);
    const stockTrasEntrar = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;

    const salida = await api.post(`/api/camara/cajas/${caja.id}/salida`).send({
      destino: "sala_venta",
      pesoKg: 4,
      usuarioId: usuario.id,
      version: caja.version,
    });
    expect(salida.status).toBe(200);

    const stockDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespues?.stockActual).toBeCloseTo(stockTrasEntrar, 5);
  });

  it("destino merma resta del stock", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const caja = await entrarCaja(usuario.id, productoCarniceria.id, 10);
    const stockTrasEntrar = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;

    const salida = await api.post(`/api/camara/cajas/${caja.id}/salida`).send({
      destino: "merma",
      pesoKg: 3,
      motivo: "Se echó a perder",
      usuarioId: usuario.id,
      version: caja.version,
    });
    expect(salida.status).toBe(200);

    const stockDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespues?.stockActual).toBeCloseTo(stockTrasEntrar - 3, 5);
  });

  it("destino mayorista resta del stock, y anular la venta por mayor lo devuelve", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const caja = await entrarCaja(usuario.id, productoCarniceria.id, 10);
    const stockTrasEntrar = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;

    const salida = await api.post(`/api/camara/cajas/${caja.id}/salida`).send({
      destino: "mayorista",
      pesoKg: 5,
      usuarioId: usuario.id,
      version: caja.version,
      mayorista: { precioTotal: 50000, estadoPago: "pendiente" },
    });
    expect(salida.status).toBe(200);
    const salidaMayoristaId = salida.body.salidaMayorista.id as number;

    const stockDespuesVenta = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespuesVenta?.stockActual).toBeCloseTo(stockTrasEntrar - 5, 5);

    const anular = await api.post(`/api/camara/mayoristas/${salidaMayoristaId}/anular`).send({
      usuarioId: usuario.id,
      motivo: "Prueba",
      clave: "1234",
    });
    expect(anular.status).toBe(200);

    const stockDespuesAnular = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespuesAnular?.stockActual).toBeCloseTo(stockTrasEntrar, 5);
  });
});

describe("Cámara — anular entrada y corregir lote ajustan Producto.stockActual", () => {
  async function entrarCaja(usuarioId: number, productoId: number, pesoKg: number) {
    const res = await api.post("/api/camara/cajas").send({
      productoId,
      familia: "Otros",
      cantidadCajas: 1,
      pesoTotalKg: pesoKg,
      costoNetoKg: 5000,
      usuarioId,
    });
    return res.body[0] as { id: number; loteId: number; version: number };
  }

  it("anular la entrada de una caja resta lo que había sumado", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const stockAntes = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;
    const caja = await entrarCaja(usuario.id, productoCarniceria.id, 7);

    const anular = await api.post(`/api/camara/cajas/${caja.id}/anular-entrada`).send({
      usuarioId: usuario.id,
      motivo: "Caja de prueba",
      clave: "1234",
    });
    expect(anular.status).toBe(200);

    const stockDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespues?.stockActual).toBeCloseTo(stockAntes, 5);
  });

  it("anular un lote completo resta el peso de todas sus cajas", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const stockAntes = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;
    const res = await api.post("/api/camara/cajas").send({
      productoId: productoCarniceria.id,
      familia: "Otros",
      cantidadCajas: 3,
      pesoTotalKg: 15,
      costoNetoKg: 5000,
      usuarioId: usuario.id,
    });
    const loteId = res.body[0].loteId as number;

    const anular = await api.post(`/api/camara/lotes/${loteId}/anular`).send({
      usuarioId: usuario.id,
      motivo: "Lote de prueba",
      clave: "1234",
    });
    expect(anular.status).toBe(200);

    const stockDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespues?.stockActual).toBeCloseTo(stockAntes, 5);
  });

  it("corregir un lote del mismo producto ajusta el stock por el delta de peso", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const stockAntes = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;
    const caja = await entrarCaja(usuario.id, productoCarniceria.id, 10);

    const corregir = await api.put(`/api/camara/lotes/${caja.loteId}`).send({
      productoId: productoCarniceria.id,
      familia: "Otros",
      pesoTotalKg: 14,
      costoNetoKg: 5000,
      usuarioId: usuario.id,
      motivo: "Peso mal ingresado",
      clave: "1234",
    });
    expect(corregir.status).toBe(200);

    const stockDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockDespues?.stockActual).toBeCloseTo(stockAntes + 14, 5);
  });

  it("corregir un lote y cambiarle el producto resta del viejo y suma al nuevo", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const categoria2 = await prisma.categoria.create({ data: { codigo: `CAT-${Date.now()}-${Math.random()}`, nombre: "Otro test", nivel: 1 } });
    const otroProducto = await prisma.producto.create({
      data: { plu: `PLU-${Date.now()}-${Math.random()}`, descripcion: "Otro corte", categoriaId: categoria2.id, precio: 4990, flagBalanza: "PESABLE", stockActual: 0 },
    });

    const stockViejoAntes = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;
    const caja = await entrarCaja(usuario.id, productoCarniceria.id, 10);

    const corregir = await api.put(`/api/camara/lotes/${caja.loteId}`).send({
      productoId: otroProducto.id,
      familia: "Otros",
      pesoTotalKg: 10,
      costoNetoKg: 5000,
      usuarioId: usuario.id,
      motivo: "Producto mal elegido",
      clave: "1234",
    });
    expect(corregir.status).toBe(200);

    const stockViejoDespues = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockViejoDespues?.stockActual).toBeCloseTo(stockViejoAntes, 5);
    const stockNuevoDespues = await prisma.producto.findUnique({ where: { id: otroProducto.id } });
    expect(stockNuevoDespues?.stockActual).toBeCloseTo(10, 5);
  });
});

describe("Cámara — conteo por escaneo y Producto.stockActual", () => {
  it("confirmar-falta resta el peso perdido; encontrada no lo vuelve a tocar", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const stockAntes = (await prisma.producto.findUnique({ where: { id: productoCarniceria.id } }))!.stockActual;

    const res = await api.post("/api/camara/cajas").send({
      productoId: productoCarniceria.id,
      familia: "Otros",
      cantidadCajas: 1,
      pesoTotalKg: 9,
      costoNetoKg: 5000,
      usuarioId: usuario.id,
    });
    const cajaId = res.body[0].id as number;

    // Simula lo que deja un conteo por escaneo al no encontrar la caja.
    await prisma.cajaCamara.update({ where: { id: cajaId }, data: { estado: "ajuste_pendiente" } });

    const falta = await api.post(`/api/camara/cajas/${cajaId}/confirmar-falta`).send({ usuarioId: usuario.id });
    expect(falta.status).toBe(200);

    const stockTrasFalta = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockTrasFalta?.stockActual).toBeCloseTo(stockAntes, 5); // 9 entró y 9 se perdió: vuelve al mismo valor

    // "Encontrada" es la rama contraria a "confirmar-falta" (misma caja no
    // puede pasar por las dos) — se prueba con una caja nueva, separada.
    const res2 = await api.post("/api/camara/cajas").send({
      productoId: productoCarniceria.id,
      familia: "Otros",
      cantidadCajas: 1,
      pesoTotalKg: 6,
      costoNetoKg: 5000,
      usuarioId: usuario.id,
    });
    const cajaId2 = res2.body[0].id as number;
    const stockTrasSegundaEntrada = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });

    await prisma.cajaCamara.update({ where: { id: cajaId2 }, data: { estado: "ajuste_pendiente" } });
    const encontrada = await api.post(`/api/camara/cajas/${cajaId2}/encontrada`).send({ usuarioId: usuario.id });
    expect(encontrada.status).toBe(200);

    const stockFinal = await prisma.producto.findUnique({ where: { id: productoCarniceria.id } });
    expect(stockFinal?.stockActual).toBeCloseTo(stockTrasSegundaEntrada!.stockActual, 5); // sin cambios
  });
});
