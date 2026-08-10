import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const configuracionRouter = Router();

configuracionRouter.get("/ia/estado", async (_req, res) => {
  const config = await prisma.configuracionIA.findFirst();
  res.json({ configurada: !!config });
});

const configurarIaSchema = z.object({
  claveApiAnthropic: z.string().trim().min(1, "Falta la clave de API"),
});

configuracionRouter.post("/ia", async (req, res) => {
  const parsed = configurarIaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { claveApiAnthropic } = parsed.data;

  const existente = await prisma.configuracionIA.findFirst();
  if (existente) {
    await prisma.configuracionIA.update({ where: { id: existente.id }, data: { claveApiAnthropic } });
  } else {
    await prisma.configuracionIA.create({ data: { claveApiAnthropic } });
  }
  res.status(204).send();
});
