import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas } from "./fixtures";

const api = request(app);

// Antes de este fix, si la venta que bloqueaba el cierre era de un canal
// distinto a "local" (ej. Caja Online, Venta Mayorista), quedaba totalmente
// invisible para el cajero: "/ventas/abierta(s)" (lo único que usa Punto de
// Venta) filtra por canal "local", así que no había forma de encontrarla ni
// resolverla desde la interfaz — el mensaje de error solo decía "confírmala
// o cancélala", sin dar ningún camino para hacerlo.
describe("Cerrar caja bloqueada por una venta sin terminar", () => {
  it("una venta abierta de canal 'online' bloquea el cierre y aparece en /ventas-abiertas de esa sesión", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, canal: "online", esAuxiliar: true },
    });
    await prisma.itemVenta.create({
      data: {
        ventaId: venta.id,
        productoId: productoCarniceria.id,
        cantidad: 1,
        precioUnitario: productoCarniceria.precio,
        subtotal: productoCarniceria.precio,
      },
    });

    const cierre = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({ efectivoContado: 20000, usuarioId: usuario.id });
    expect(cierre.status).toBe(400);
    expect(cierre.body.error).toMatch(/venta sin terminar/i);

    const bloqueantes = await api.get(`/api/caja/sesiones/${sesionCaja.id}/ventas-abiertas`);
    expect(bloqueantes.status).toBe(200);
    expect(bloqueantes.body).toHaveLength(1);
    expect(bloqueantes.body[0].id).toBe(venta.id);
    expect(bloqueantes.body[0].canal).toBe("online");
  });

  it("cancelando la venta bloqueante desde ahí, el cierre funciona después", async () => {
    const { usuario, productoCarniceria, sesionCaja } = await crearFixturesBasicas();

    const venta = await prisma.venta.create({
      data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id, canal: "mayorista", esAuxiliar: true },
    });
    await prisma.itemVenta.create({
      data: {
        ventaId: venta.id,
        productoId: productoCarniceria.id,
        cantidad: 1,
        precioUnitario: productoCarniceria.precio,
        subtotal: productoCarniceria.precio,
      },
    });

    const primerIntento = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({ efectivoContado: 20000, usuarioId: usuario.id });
    expect(primerIntento.status).toBe(400);

    const cancelar = await api.post(`/api/caja/ventas/${venta.id}/cancelar`).send({ usuarioId: usuario.id, clave: "1234", motivo: "Venta antigua abandonada" });
    expect(cancelar.status).toBe(200);

    const segundoIntento = await api.post(`/api/caja/sesiones/${sesionCaja.id}/cerrar`).send({ efectivoContado: 20000, usuarioId: usuario.id });
    expect(segundoIntento.status).toBe(200);
  });

  it("/ventas-abiertas no cuenta un carrito vacío (sin ítems) como bloqueante", async () => {
    const { usuario, sesionCaja } = await crearFixturesBasicas();

    await prisma.venta.create({ data: { sesionCajaId: sesionCaja.id, usuarioId: usuario.id } });

    const bloqueantes = await api.get(`/api/caja/sesiones/${sesionCaja.id}/ventas-abiertas`);
    expect(bloqueantes.status).toBe(200);
    expect(bloqueantes.body).toHaveLength(0);
  });
});
