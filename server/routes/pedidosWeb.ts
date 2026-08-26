import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const pedidosWebRouter = Router();

const ESTADOS = ["pendiente", "atendido", "anulado"] as const;

function serializar(p: {
  id: number;
  idWeb: string;
  fecha: Date;
  clienteNombre: string;
  clienteTelefono: string;
  tipoEntrega: string;
  clienteDireccion: string | null;
  comunaNombre: string | null;
  costoEnvio: number | null;
  fechaEntrega: string | null;
  medioPago: string | null;
  itemsJson: string;
  comentario: string | null;
  estado: string;
  atendidoPorId: number | null;
  atendidoEn: Date | null;
  sincronizadoEn: Date;
}) {
  const { itemsJson, ...resto } = p;
  let items: unknown = [];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    items = [];
  }
  return { ...resto, items };
}

pedidosWebRouter.get("/", async (req, res) => {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  if (estado && !ESTADOS.includes(estado as (typeof ESTADOS)[number])) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  const pedidos = await prisma.pedidoWeb.findMany({
    where: estado ? { estado } : undefined,
    orderBy: { fecha: "desc" },
  });
  res.json(pedidos.map(serializar));
});

const atenderSchema = z.object({ usuarioId: z.number().int().positive() });

pedidosWebRouter.put("/:id/atender", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = atenderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existente = await prisma.pedidoWeb.findUnique({ where: { id } });
  if (!existente) return res.status(404).json({ error: "Pedido no encontrado" });

  const usuario = await prisma.usuario.findUnique({ where: { id: parsed.data.usuarioId } });
  if (!usuario || !usuario.activo) return res.status(400).json({ error: "Usuario inválido" });

  const pedido = await prisma.pedidoWeb.update({
    where: { id },
    data: { estado: "atendido", atendidoPorId: parsed.data.usuarioId, atendidoEn: new Date() },
  });
  res.json(serializar(pedido));
});
