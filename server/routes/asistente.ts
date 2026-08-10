import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "../db";
import { procesarMensaje, type MensajeHistorial } from "../lib/asistenteIA";

export const asistenteRouter = Router();

const mensajeSchema = z.object({
  mensaje: z.string().trim().min(1, "Escribe algo primero"),
  historial: z.array(z.any()).optional().default([]),
});

asistenteRouter.post("/mensaje", async (req, res) => {
  const parsed = mensajeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { mensaje, historial } = parsed.data;

  const config = await prisma.configuracionIA.findFirst();
  if (!config) {
    return res.status(400).json({ error: "Falta configurar la clave de API de IA. Ve a Configuración." });
  }

  try {
    const resultado = await procesarMensaje(config.claveApiAnthropic, mensaje, historial as MensajeHistorial[]);
    res.json(resultado);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(400).json({ error: "La clave de API no es válida. Revísala en Configuración." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(400).json({ error: "Se alcanzó el límite de uso de la IA por ahora. Intenta de nuevo en un momento." });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(400).json({ error: "No se pudo conectar con el servicio de IA. Intenta de nuevo." });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
