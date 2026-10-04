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

// Un PedidoWeb nunca se crea por una ruta propia — solo llega por el sync
// con la web (ver pedidosWebRouter POST /sincronizar) — así que los tests
// de Caja Online lo insertan directo con Prisma, como si ya hubiera
// sincronizado. itemsJson es solo texto para mostrar (ver comentario del
// modelo); no hace falta que combine con ningún Producto real.
export async function crearPedidoWeb(datos: Partial<Parameters<typeof prisma.pedidoWeb.create>[0]["data"]> = {}) {
  return prisma.pedidoWeb.create({
    data: {
      idWeb: `WEB-${Date.now()}-${Math.random()}`,
      fecha: new Date(),
      clienteNombre: "Cliente Web",
      clienteTelefono: "+56911112222",
      tipoEntrega: "retiro",
      itemsJson: JSON.stringify([{ plu: "PLU-1", nombre: "Lomo Vetado", cantidad: 1, unidad: "kg", precioUnitario: 8990 }]),
      ...datos,
    },
  });
}
