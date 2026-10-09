import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { prisma } from "../db";
import { crearFixturesBasicas, crearPedidoWeb } from "./fixtures";

const api = request(app);

describe("Caja Online — crear venta desde un pedido web", () => {
  it("crea una venta auxiliar ligada al pedido, sin bloquear la caja del mesón", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();

    const res = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });

    expect(res.status).toBe(201);
    expect(res.body.esAuxiliar).toBe(true);
    expect(res.body.canal).toBe("online");
    expect(res.body.origenPedidoWebId).toBe(pedido.id);
    expect(res.body.estado).toBe("abierta");
  });

  it("es idempotente: pedir la venta dos veces para el mismo pedido reusa la misma, no crea una segunda", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();

    const primera = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    const segunda = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect(segunda.body.id).toBe(primera.body.id);

    const todas = await prisma.venta.findMany({ where: { origenPedidoWebId: pedido.id } });
    expect(todas).toHaveLength(1);
  });

  it("es idempotente incluso si dos clics llegan casi a la vez (choque contra el índice único, no duplica)", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();

    const [primera, segunda] = await Promise.all([
      api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id }),
      api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id }),
    ]);

    expect([primera.status, segunda.status].sort()).toEqual([200, 201]);
    expect(primera.body.id).toBe(segunda.body.id);

    const todas = await prisma.venta.findMany({ where: { origenPedidoWebId: pedido.id } });
    expect(todas).toHaveLength(1);
  });

  it("no bloquea la venta si la comuna del pedido ya no calza con ninguna del catálogo (ej. se renombró después)", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb({ tipoEntrega: "despacho", comunaNombre: "Comuna Que Ya No Existe", costoEnvio: 2000 });

    const res = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });

    expect(res.status).toBe(201);
    expect(res.body.esDespacho).toBe(true);
    expect(res.body.comunaId).toBeNull();
    expect(res.body.costoEnvio).toBe(2000);
  });

  it("no deja crear una venta desde un pedido anulado", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb({ estado: "anulado" });

    const res = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    expect(res.status).toBe(400);
  });

  it("no deja crear una segunda venta si el pedido ya se cobró (venta ya confirmada)", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();

    const venta = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    const conItem = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: productoCarniceria.id, cantidad: 1 });
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "pedido_web", monto: conItem.body.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId: usuario.id });
    expect(confirmar.status).toBe(200);

    const segundaVenta = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    expect(segundaVenta.status).toBe(400);
    expect(segundaVenta.body.error).toContain("ya se cobró");

    const todas = await prisma.venta.findMany({ where: { origenPedidoWebId: pedido.id } });
    expect(todas).toHaveLength(1);
  });
});

describe("Caja Online — pago pendiente del pedido (\"pedido_web\")", () => {
  async function pistolearYConfirmar(usuarioId: number, pedidoId: number, productoId: number) {
    const venta = await api.post(`/api/caja/ventas/desde-pedido-web/${pedidoId}`).send({ usuarioId });
    expect(venta.status).toBe(201);
    const conItem = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId, cantidad: 1 });
    expect(conItem.status).toBe(201);
    const total = conItem.body.total;
    const pago = await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "pedido_web", monto: total });
    expect(pago.status).toBe(201);
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId });
    expect(confirmar.status).toBe(200);
    return { ventaId: venta.body.id, pagoId: confirmar.body.pagos[0].id };
  }

  it("queda con el pago pendiente (cobrado:false) al confirmar, y marca el pedido como atendido", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();

    const { pagoId } = await pistolearYConfirmar(usuario.id, pedido.id, productoCarniceria.id);

    const pago = await prisma.pagoVenta.findUnique({ where: { id: pagoId } });
    expect(pago?.medio).toBe("pedido_web");
    expect(pago?.cobrado).toBe(false);

    const pedidoActualizado = await prisma.pedidoWeb.findUnique({ where: { id: pedido.id } });
    expect(pedidoActualizado?.estado).toBe("atendido");
  });

  it("resuelve o crea el cliente a partir del teléfono del pedido, sin pedirlo a mano", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb({ clienteTelefono: "+56999887766", clienteNombre: "Juanita Pérez" });

    const { pagoId } = await pistolearYConfirmar(usuario.id, pedido.id, productoCarniceria.id);

    const pago = await prisma.pagoVenta.findUnique({ where: { id: pagoId }, include: { cliente: true } });
    expect(pago?.cliente?.telefono).toBe("+56999887766");
    expect(pago?.cliente?.nombre).toBe("Juanita Pérez");
  });

  it("aparece en /creditos-pendientes?medio=pedido_web pero no en el listado de créditos sin filtro", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();
    const { pagoId } = await pistolearYConfirmar(usuario.id, pedido.id, productoCarniceria.id);

    const filtrado = await api.get("/api/caja/creditos-pendientes?medio=pedido_web");
    expect(filtrado.body.some((p: { id: number }) => p.id === pagoId)).toBe(true);

    const sinFiltro = await api.get("/api/caja/creditos-pendientes");
    expect(sinFiltro.body.some((p: { id: number }) => p.id === pagoId)).toBe(false);
  });

  it("se puede cobrar a través de /creditos/:pagoId/cobrar, igual que un crédito normal", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();
    const { pagoId } = await pistolearYConfirmar(usuario.id, pedido.id, productoCarniceria.id);

    const cobro = await api.post(`/api/caja/creditos/${pagoId}/cobrar`).send({ medioCobro: "efectivo", usuarioId: usuario.id });
    expect(cobro.status).toBe(200);
    expect(cobro.body.cobrado).toBe(true);

    const sinFiltro = await api.get("/api/caja/creditos-pendientes?medio=pedido_web");
    expect(sinFiltro.body.some((p: { id: number }) => p.id === pagoId)).toBe(false);
  });

  it("si ya se pagó al pistolear (ej. efectivo), no queda nada pendiente", async () => {
    const { usuario, productoCarniceria } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();

    const venta = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    const conItem = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: productoCarniceria.id, cantidad: 1 });
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "efectivo", monto: conItem.body.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId: usuario.id });

    expect(confirmar.status).toBe(200);
    const pagoPedidoWeb = await prisma.pagoVenta.findFirst({ where: { ventaId: venta.body.id, medio: "pedido_web" } });
    expect(pagoPedidoWeb).toBeNull();

    const pendientes = await api.get("/api/caja/creditos-pendientes?medio=pedido_web");
    expect(pendientes.body.some((p: { ventaId: number }) => p.ventaId === venta.body.id)).toBe(false);
  });
});

describe("Caja Online — combos siguen descontando/devolviendo stock de sus componentes", () => {
  async function crearProductoComboConComponente() {
    const categoria = await prisma.categoria.create({ data: { codigo: `CAT-${Date.now()}-${Math.random()}`, nombre: "Combos test", nivel: 1 } });
    const componente = await prisma.producto.create({
      data: { plu: `PLU-COMP-${Date.now()}`, descripcion: "Longaniza test", categoriaId: categoria.id, precio: 3000, flagBalanza: "NORMAL", stockActual: 50 },
    });
    const combo = await prisma.producto.create({
      data: {
        plu: `PLU-COMBO-${Date.now()}`,
        descripcion: "Combo Parrillero test",
        categoriaId: categoria.id,
        precio: 10000,
        flagBalanza: "NORMAL",
        esCombo: true,
        stockActual: 0,
      },
    });
    await prisma.comboComponente.create({ data: { comboProductoId: combo.id, componenteProductoId: componente.id, cantidad: 2 } });
    return { combo, componente };
  }

  it("al confirmar una venta con un combo, descuenta el stock del componente (no del combo)", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();
    const { combo, componente } = await crearProductoComboConComponente();

    const venta = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    const conItem = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: combo.id, cantidad: 1 });
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "pedido_web", monto: conItem.body.total });
    const confirmar = await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId: usuario.id });
    expect(confirmar.status).toBe(200);

    const componenteActualizado = await prisma.producto.findUnique({ where: { id: componente.id } });
    expect(componenteActualizado?.stockActual).toBe(48); // 50 - (2 por combo * 1 combo)
    const comboActualizado = await prisma.producto.findUnique({ where: { id: combo.id } });
    expect(comboActualizado?.stockActual).toBe(0); // el combo mismo nunca se mueve
  });

  it("al anular esa venta ya confirmada, devuelve el stock del componente", async () => {
    const { usuario } = await crearFixturesBasicas();
    const pedido = await crearPedidoWeb();
    const { combo, componente } = await crearProductoComboConComponente();

    const venta = await api.post(`/api/caja/ventas/desde-pedido-web/${pedido.id}`).send({ usuarioId: usuario.id });
    const conItem = await api.post(`/api/caja/ventas/${venta.body.id}/items`).send({ productoId: combo.id, cantidad: 1 });
    await api.post(`/api/caja/ventas/${venta.body.id}/pagos`).send({ medio: "pedido_web", monto: conItem.body.total });
    await api.post(`/api/caja/ventas/${venta.body.id}/confirmar`).send({ usuarioId: usuario.id });

    const cancelar = await api
      .post(`/api/caja/ventas/${venta.body.id}/cancelar`)
      .send({ clave: "1234", usuarioId: usuario.id, motivo: "prueba" });
    expect(cancelar.status).toBe(200);

    const componenteActualizado = await prisma.producto.findUnique({ where: { id: componente.id } });
    expect(componenteActualizado?.stockActual).toBe(50); // de vuelta al valor original
  });
});
