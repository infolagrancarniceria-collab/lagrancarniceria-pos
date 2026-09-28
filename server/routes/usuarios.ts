import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const usuariosRouter = Router();

usuariosRouter.get("/", async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
  });
  // El hash de la clave personal (módulo charcutería) nunca debe llegar al
  // cliente, ni siquiera hasheado — mismo criterio que ya se aplica en todo
  // el resto del sistema con ClaveSupervisor (nunca se expone). Esta
  // versión de Prisma no tiene el helper "omit" del cliente disponible, así
  // que se saca el campo a mano antes de responder.
  res.json(usuarios.map(({ hashClavePersonal: _hashClavePersonal, ...resto }) => resto));
});

const crearUsuarioSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre no puede estar vacío"),
});

usuariosRouter.post("/", async (req, res) => {
  const parsed = crearUsuarioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const existente = await prisma.usuario.findUnique({
    where: { nombre: parsed.data.nombre },
  });
  if (existente) {
    if (!existente.activo) {
      const reactivado = await prisma.usuario.update({
        where: { id: existente.id },
        data: { activo: true },
      });
      return res.status(200).json(reactivado);
    }
    return res.status(409).json({ error: "Ya existe un usuario con ese nombre" });
  }

  const usuario = await prisma.usuario.create({ data: { nombre: parsed.data.nombre } });
  res.status(201).json(usuario);
});
