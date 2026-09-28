import { prisma } from "../db";
import { hashClave } from "../lib/clave";

// Datos mínimos que cualquier test del módulo de charcutería necesita para
// poder transferir/producir/vender algo: un usuario admin con clave
// personal, clave de supervisor, categoría + producto de carnicería con
// stock, y una caja abierta.
export async function crearFixturesBasicas() {
  const usuario = await prisma.usuario.create({
    data: { nombre: `Test-${Date.now()}-${Math.random()}`, rol: "admin", hashClavePersonal: hashClave("1234") },
  });

  await prisma.claveSupervisor.deleteMany();
  await prisma.claveSupervisor.create({ data: { hashClave: hashClave("1234") } });

  const categoria = await prisma.categoria.create({ data: { codigo: `CAT-${Date.now()}`, nombre: "Carnes test", nivel: 1 } });
  const productoCarniceria = await prisma.producto.create({
    data: { plu: `PLU-${Date.now()}`, descripcion: "Lomo Vetado test", categoriaId: categoria.id, precio: 8990, flagBalanza: "PESABLE", stockActual: 100 },
  });

  const sesionCaja = await prisma.sesionCaja.create({ data: { usuarioAperturaId: usuario.id, fondoFijoInicial: 20000 } });

  return { usuario, productoCarniceria, sesionCaja };
}
