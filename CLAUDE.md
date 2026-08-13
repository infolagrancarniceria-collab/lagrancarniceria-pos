# Sistema POS Carnicería

## Sobre este proyecto
Software de punto de venta para reemplazar un sistema comercial anticuado
(Ingepav/Gexus, ~10 años de antigüedad) que usa mi papá en su carnicería.
Yo (quien te está hablando) no tengo experiencia programando, así que
necesito que propongas las decisiones técnicas (stack, arquitectura) antes
de escribir código, me las expliques en simple, y avances de a un módulo
a la vez.

## Objetivo Fase 1
Reemplazar los módulos de mayor uso diario: gestión de precios, envío de
precios a la balanza, inventario y reportes de ventas. La emisión de
boletas queda **fuera de esta fase** — se sigue haciendo aparte con la
máquina Transbank y la app del SII (pagos con tarjeta se emiten solos;
efectivo se ingresa manualmente ahí mismo).

## Cómo trabajar conmigo en este proyecto
- Antes de escribir código: proponme la arquitectura y el stack, y por qué,
  en términos simples. Espera mi aprobación antes de avanzar.
- Construyamos por módulos, en este orden: (1) gestión de precios,
  (2) inventario, (3) reportes de ventas, (4) envío a balanza (al final,
  porque depende de información que todavía estoy juntando).
- Explícame en simple cada decisión importante, no asumas que entiendo
  jerga técnica.
- Avísame si algo del alcance de abajo no tiene sentido técnicamente antes
  de construirlo.

## Contexto del hardware (balanza)
- **Modelo:** Mettler Toledo bPlus-T2M-BB15D-MW0, certificación CL (Chile),
  6/15 kg, e=2/5g.
- **Conectividad:** Ethernet, USB, RS232 (según configuración).
- **Protocolo real confirmado (corregido):** bTwin NO usa un SDK/DLL
  separado — la idea de un "SDK bTwin" era un malentendido de cómo se ve el
  sistema actual (la segunda app tipo "Win32 DLL Demo" es una herramienta
  de demostración de Mettler Toledo, no una dependencia obligatoria). La
  comunicación real es directa por **socket TCP/IP** hacia la
  **dirección IP de la balanza** (ej. 192.168.0.13) en el puerto de
  comunicación (usualmente **3001**, modo "Batch"), enviando un **bloque de
  texto plano con campos de ancho fijo** (cada dato — código, tipo, precio,
  nombre — ocupa una posición y cantidad de caracteres exacta dentro de la
  línea). No hace falta SDK, DLL, ni paquete de terceros — se puede
  construir nativo en Node.js con el módulo `net` (sockets TCP), que ya es
  parte del lenguaje.
- **Pendiente:** conseguir o reconstruir la especificación exacta del
  formato de ancho fijo (qué campo va en qué posición, cuántos caracteres,
  relleno con espacios o ceros, mayúsculas, fin de línea, etc.) — ver
  preguntas abiertas abajo.

### Modelo de datos de producto (confirmado por manual del sistema actual)
- Cada producto tiene un campo **"Flag Balanza"**: Normal / Pesable / Importe
  — determina si el producto necesita ir a la balanza.
- **Categorías en 3 niveles**, codificadas jerárquicamente, ej:
  `01 Aves > 0101 Pollos > 010101 Trutros`.
- **EAN (código de barras) es un campo aparte del PLU**, y solo aplica a
  productos que NO son pesables/importe (la balanza imprime su propio
  código con el peso/precio embebido).
- Otros campos del maestro de producto vistos en el sistema actual:
  descripción, nombre corto, marca, contenido, capacidad x caja, envase,
  categoría, impuesto adicional, duración, código proveedor.

### Preguntas técnicas abiertas (bloquean el módulo 4)
1. Especificación exacta del formato de ancho fijo (qué campo va en qué
   posición/cuántos caracteres, relleno, fin de línea) — pendiente.
2. Dirección IP y puerto reales y confirmados de la balanza de la
   carnicería (se ha usado 192.168.0.13 / 3001 como ejemplo, falta
   confirmar el valor real).
3. Si existe algún archivo de ejemplo o log del sistema actual con el
   texto exacto que se envía hoy a la balanza — sería la forma más rápida
   y confiable de calcar el formato exacto, en vez de adivinarlo de cero.

### Meta de automatización para el módulo de balanza
Como el envío es directo por socket TCP (sin segunda app ni SDK de por
medio), el objetivo pasa a ser directamente el nivel más alto: el sistema
arma el texto y lo envía por socket con un clic, sin pasos manuales
adicionales — no hay una "segunda app" que reproducir.

## Decisión de alcance: módulo de caja / punto de venta
**El sistema actual tiene un módulo completo de caja (GexusPOS)** separado
del back office: apertura de caja (fondo fijo), reportes X y Z, anulación
de productos con clave de supervisor, múltiples medios de pago, cuenta
corriente de clientes. De ahí sale toda la data de ventas.

**Decisión:** el sistema no se pondrá en producción frente a clientes reales
hasta haber hecho simulaciones y confirmar que funciona bien — eso ya cubre
el riesgo de manejar dinero en tiempo real, así que **no** es la razón para
posponer la caja.

La razón real es de **dependencia técnica**: la caja necesita que el
catálogo de productos y precios ya exista para poder funcionar (buscar
por PLU, calcular totales, etc.) — no se puede construir ni probar bien
sin eso. Además es, de los módulos, el más complejo estructuralmente
(estados de venta, pagos combinados, anulaciones con clave de supervisor,
cierre de caja X/Z).

**Orden de construcción de este proyecto (no fases separadas en el
tiempo, sino orden de dependencia):**
1. Gestión de precios
2. Inventario
3. Reportes de ventas
4. Envío a balanza
5. Caja / punto de venta (al final, porque depende de 1)

**Consecuencia técnica pendiente de resolver:** mientras el sistema nuevo
no tenga el módulo de caja listo, si se sigue usando el Gexus actual para
cobrar en paralelo, el catálogo de productos/precios del sistema nuevo
tiene que reflejarse también en el viejo. Si el módulo de caja se construye
pronto después del de precios, este problema de sincronización puede ser
solo temporal y menor.

## Alcance Fase 1

### 1. Gestión de precios
- CRUD de productos: código/PLU, nombre, precio por kg, categoría, código
  de barras (si aplica).
- Cambio de precio individual y cambio masivo (por categoría o carga desde
  planilla).
- Historial de cambios de precio (quién, cuándo, precio anterior → nuevo).

### 2. Inventario
- Registro de entrada de mercadería (proveedor, producto, cantidad, fecha,
  costo).
- Registro de salida/merma (venta, descarte, ajuste).
- Stock actual por producto.
- Alerta de stock bajo (umbral configurable).

### 3. Reportes de ventas
- Resumen diario/semanal/mensual de ventas.
- Producto más vendido, por volumen y por ingreso.
- Margen estimado (precio venta vs. costo registrado en inventario).

### 4. Envío a balanza
- Exportar tabla de PLU/precios en el formato que use la balanza.
- Botón "Actualizar balanza" que dispare la exportación.
- Confirmación visual de éxito/error.

## Explícitamente fuera de alcance (Fase 1)
- Emisión de boletas/facturas electrónicas (SII) — sigue vía Transbank/app SII.
- Múltiples sucursales/bodegas.
- Self-checkout / totem.

## Preguntas pendientes con mi papá (para afinar antes de construir cada módulo)
- ¿Cómo registra hoy la merma?
- ¿Qué reporte mira más seguido hoy — cuál le sirve más para decidir?

## Arquitectura y stack (aprobado)
Todo corre **local**, en el PC de la carnicería, sin depender de internet:

- **App de escritorio:** Electron + React + TypeScript. Se abre con doble
  clic como cualquier programa de Windows.
- **Servidor local:** Node.js + TypeScript + Express, corre dentro de la
  misma app y escucha en la red del local (no solo en el PC), para que
  tablet/celular se puedan conectar por WiFi entrando a la IP del PC.
- **Base de datos:** SQLite (un solo archivo). Respaldo = copiar ese
  archivo. Si más adelante se necesita más robustez, se puede migrar a
  Postgres sin rehacer todo, porque se usa Prisma (ORM) como capa
  intermedia.
- **Balanza (módulo 4, pendiente):** no requiere un componente aparte en
  C#/.NET ni ningún SDK — el envío es un socket TCP directo con texto de
  ancho fijo, algo que Node.js hace nativo (módulo `net`). Se construye
  dentro del mismo servidor Node/Express del resto del sistema.
- **Usuarios:** solo una persona usa el sistema a la vez. El "login" es
  elegir el nombre de una lista (sin contraseña), solo para dejar registro
  de quién hizo cada cambio (ej. en el historial de precios).

## Estado de módulos
1. **Gestión de precios** — listo (productos, categorías, cambio individual/masivo, historial).
2. **Inventario** — listo (proveedores, entradas, salidas/merma, stock actual con alerta de stock bajo, historial de movimientos).
3. **Reportes** — listo: inventario (entradas/salidas por motivo, top productos con más merma), precios (cambios y mayores variaciones) y ventas (cantidad de ventas, total vendido, más vendidos por cantidad y por ingreso), los tres por rango de fechas.
4. Envío a balanza — no iniciado (bloqueado por documentación SDK bTwin).
5. **Caja / punto de venta** — listo (apertura con fondo fijo, punto de venta con carrito y pagos combinados efectivo/tarjeta, anulación de ítems con clave de supervisor, cierre con reporte X/Z y diferencia de efectivo). Cuenta corriente de clientes queda fuera de esta primera versión (a pedido del usuario). Cada venta confirmada genera automáticamente movimientos de inventario (motivo "venta"), reutilizando la misma validación de stock del módulo de inventario.
6. **Asistente de IA** — listo el backend y las pantallas; **pendiente la prueba real** con una clave de API válida (se probó todo el flujo con una clave falsa: guardar, error de clave inválida). Ver "Decisiones tomadas en el asistente de IA" más abajo.

## Instalador de Windows
Armado con `electron-builder` (`npm run dist:win`, ver README para el
detalle técnico). Se hizo antes de la primera prueba real con datos, a
pedido del usuario, para que el sistema se pueda abrir con doble clic como
cualquier programa de Windows, sin usar la terminal.

Un workflow de GitHub Actions (`.github/workflows/build-installer.yml`)
arma el instalador en una PC Windows real cada vez que cambia algo relevante
al empaquetado, y confirma que la app abre sin crashear — así los errores
específicos de Windows (hubo varios, ver git log) se detectan sin depender
de que alguien lo pruebe a mano. El `.exe` queda descargable como artefacto
en la página de cada ejecución del workflow, sin necesidad de instalar
Node.js para generarlo.

Confirmado en CI (Windows real, GitHub Actions): el instalador se arma y la
app abre sin crashear. **Confirmado también por el usuario**, instalando y
abriendo el programa en su propia PC con Windows.

Confirmado en CI (Windows real, GitHub Actions): el instalador se arma y la
app abre sin crashear. **Pendiente:** confirmación del usuario probándolo en
su propia PC — crear un producto de prueba y usar el sistema con normalidad
desde el programa instalado.

## Decisiones tomadas en el módulo de caja
- Clave de supervisor: una sola clave compartida (no hay cuentas ni
  contraseñas por persona en el sistema), guardada hasheada. Se pide solo
  para anular un ítem de una venta en curso.
- Cuenta corriente de clientes: fuera de esta primera versión (confirmado
  con el usuario) — caja soporta efectivo y tarjeta, con pagos combinados.
- El stock de cada producto se descuenta recién al **confirmar** la venta
  (no al agregar un ítem al carrito), para no descontar stock de ventas que
  se cancelan antes de pagar.
- Los pagos registrados deben sumar exactamente el total de la venta para
  poder confirmarla (no se modela "vuelto"/cambio).

## Decisiones tomadas en el módulo de inventario
- La merma hoy no se registra formalmente (confirmado con el usuario) — este
  módulo es el primer registro formal de ese dato.
- El stock no se edita a mano en la ficha del producto: solo cambia a través
  de movimientos de entrada/salida, igual que el precio solo cambia a través
  del endpoint de cambio de precio (mismo patrón, mismo motivo: dejar rastro
  de auditoría).
- "Ajuste" por conteo físico que encuentra *más* stock del registrado se
  maneja como una entrada sin proveedor (no se creó un tercer tipo de
  movimiento que sume o reste).

## Decisiones tomadas en el asistente de IA
- **Regla central de seguridad: "la IA propone, la persona confirma"** — sin
  excepciones, ni para cambios chicos. El asistente puede llamar dos tipos de
  herramientas: de **lectura** (consultar productos, categorías, proveedores,
  reportes de inventario/precios/ventas), que ejecuta directo porque no
  cambian nada; y de **escritura** ("proponer_cambio_precio",
  "proponer_crear_categoria", "proponer_entrada_inventario", etc.), que
  nunca ejecuta — solo arma una propuesta con una descripción en español que
  se le muestra a la persona. Si confirma, el frontend llama exactamente al
  mismo endpoint que usaría a mano (mismo `usuarioId`, misma validación,
  mismo registro en el historial); si cancela, no pasa nada. La IA nunca
  tiene un camino propio para escribir datos.
- Acceso: cualquiera que use el sistema puede usar el asistente, mismo
  criterio que el resto (no hay contraseñas por persona).
- La clave de API de Anthropic se guarda en la misma base de datos local
  (tabla `ConfiguracionIA`), en texto plano — no tiene sentido cifrarla con
  una clave maestra en una app de escritorio de un solo archivo local; el
  cifrado ahí no agrega seguridad real sin un sistema de gestión de claves
  aparte. Nunca se sube a git, nunca se le muestra de vuelta al frontend, y
  el usuario la ingresa directo en la app (nunca por este chat, por
  seguridad).
- Modelo usado: Claude Sonnet — el intermedio de Anthropic, buen balance de
  costo/calidad para este uso (consultas ocasionales de un solo local).
- La conversación con la IA no se guarda en la base de datos — el historial
  vive en el frontend mientras la pantalla esté abierta, y se manda de
  vuelta en cada mensaje nuevo (patrón sin estado, más simple).
