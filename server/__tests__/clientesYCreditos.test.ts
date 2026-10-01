import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

async function crearVentaACredito(usuarioId: number, productoId: number, clienteId: number) {
  const venta = await api.post("/api/caja/ventas").send({ usuarioId, auxiliar: true });
  expect(venta.status).toBe(201);
  const conItem = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId, cantidad: 1 });
  expect(conItem.status).toBe(201);
  const total = conItem.body.total;
  const pago = await api
    .post(`/api/caja/ventas/${venta.body.id}/pagos`)
    .send({ medio: "credito", monto: total, clienteId });
  expect(pago.status).toBe(201);
  const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });
  expect(confirmar.status).toBe(200);
  const pagoCredito = confirmar.body.pagos.find((p: { medio: string }) => p.medio === "credito");
  return { ventaId: venta.body.id, pagoId: pagoCredito.id, total };
}

describe("Créditos — comprobante de pago", () => {
  it("al cobrar un crédito, la respuesta trae lo necesario para el comprobante (venta y quién lo cobró)", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const cliente = await prisma.cliente.create({ data: { nombre: "Cliente de prueba" } });

    const { pagoId } = await crearVentaACredito(usuario.id, productoCarniceria.id, cliente.id);

    const cobro = await api.post(`/api/caja/creditos/${pagoId}/cobrar`).send({ medioCobro: "efectivo", usuarioId: usuario.id });
    expect(cobro.status).toBe(200);
    expect(cobro.body.cobrado).toBe(true);
    expect(cobro.body.venta).toBeTruthy();
    expect(cobro.body.venta.id).toBeTruthy();
    expect(cobro.body.usuarioCobro).toBeTruthy();
    expect(cobro.body.usuarioCobro.nombre).toBe(usuario.nombre);
  });
});

describe("Clientes — editar y eliminar", () => {
  it("edita el nombre, teléfono y RUT de un cliente", async () => {
    const cliente = await prisma.cliente.create({ data: { nombre: "Nombre viejo" } });

    const res = await api.put(`/api/clientes/${cliente.id}`).send({ nombre: "Nombre nuevo", telefono: "+56912345678", rut: "11.111.111-1" });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe("Nombre nuevo");
    expect(res.body.telefono).toBe("+56912345678");
  });

  it("no deja eliminar un cliente que todavía tiene crédito pendiente sin cobrar", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const cliente = await prisma.cliente.create({ data: { nombre: "Debe plata" } });
    await crearVentaACredito(usuario.id, productoCarniceria.id, cliente.id);

    const res = await api.delete(`/api/clientes/${cliente.id}`);
    expect(res.status).toBe(409);

    const listado = await api.get("/api/clientes");
    expect(listado.body.some((c: { id: number }) => c.id === cliente.id)).toBe(true);
  });

  it("elimina (soft-delete) un cliente sin deuda pendiente, y deja de listarse pero conserva su historial", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const cliente = await prisma.cliente.create({ data: { nombre: "Ya pagó todo" } });
    const { pagoId } = await crearVentaACredito(usuario.id, productoCarniceria.id, cliente.id);
    await api.post(`/api/caja/creditos/${pagoId}/cobrar`).send({ medioCobro: "efectivo", usuarioId: usuario.id });

    const eliminar = await api.delete(`/api/clientes/${cliente.id}`);
    expect(eliminar.status).toBe(204);

    const listado = await api.get("/api/clientes");
    expect(listado.body.some((c: { id: number }) => c.id === cliente.id)).toBe(false);

    const estadoCuenta = await api.get(`/api/clientes/${cliente.id}/estado-cuenta`);
    expect(estadoCuenta.status).toBe(200);
    expect(estadoCuenta.body.pagos).toHaveLength(1);
  });
});
