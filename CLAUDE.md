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
- **Protocolo real confirmado (corregido dos veces):** bTwin NO usa un
  SDK/DLL separado — la idea de un "SDK bTwin" era un malentendido de cómo
  se ve el sistema actual (la segunda app tipo "Win32 DLL Demo" es una
  herramienta de demostración de Mettler Toledo, no una dependencia
  obligatoria). La comunicación real es directa por **socket TCP/IP** hacia
  la **dirección IP de la balanza** en el puerto **3001** — confirmado con
  una captura real de red (Wireshark).
- **Formato del mensaje (confirmado por captura real, corrige la hipótesis
  anterior de "texto de ancho fijo"):** es **XML**, no texto de ancho fijo.
  Cada mensaje viene envuelto en `<Message>...</Message>`, con un
  `<ARTSCommonHeader MessageType="Request"/>` (o `"Response"`) seguido de un
  elemento específico de la acción. Ejemplo real capturado — mensaje de
  "descubrimiento" (pedirle a la balanza que se identifique, no es el envío
  de precio):
  ```
  Request:  <Message><ARTSCommonHeader MessageType="Request"/><NetworkExploration ActionCode="Read"/></Message>
  Response: <Message><ARTSCommonHeader MessageType="Response"/><NetworkExploration><DeviceMap>
              <DeviceID>00:10:52:CD:3E:27</DeviceID><ModelName>bPlus</ModelName>
              <SerialNumber>B834307144</SerialNumber><IPAddress>192.168.18.120</IPAddress>
              <TCPPort>3001</TCPPort>...</DeviceMap></NetworkExploration></Message>
  ```
  Esto sigue (o se parece mucho a) el estándar **ARTS/IXRetail XML** para
  comunicación con balanzas de red, no un formato propietario inventado por
  Mettler Toledo. Confirma también IP `192.168.18.120` = balanza 2, puerto
  3001, modelo bPlus — todo coincide con lo ya documentado.
- **Mensaje de actualización de precios — CONFIRMADO por captura real
  completa.** Cada vez que se aprieta "Execute Task", Gexus manda **el
  catálogo completo** (se capturó un envío real con 200 productos) en un
  solo mensaje grande, no solo lo que cambió. Estructura por producto:
  ```xml
  <Message><ARTSCommonHeader MessageType="Request"/><ItemTransaction ActionCode="Update">
    <Item>
      <PLU>42</PLU>
      <DepartmentID>0</DepartmentID>
      <AlternativeItemIDs Action="Create"><AlternativeItemID>0000000000042</AlternativeItemID></AlternativeItemIDs>
      <Descriptions Action="Create">
        <Description Type="ItemName">CHULETA DE CENTRO</Description>
        <Description ID="0" Type="ExtraText"></Description>
      </Descriptions>
      <ItemPrices Action="Update">
        <ItemPrice ValueTypeCode="BasePrice" Index="0" UnitOfMeasureCode="KGM" PriceOverrideFlag="false" DiscountFlag="false" Hidden="false">1234</ItemPrice>
      </ItemPrices>
      <Dates Action="Create">
        <DateOffset Type="PackedDate" UnitOfOffset="day" IsPrintEnabled="true">0</DateOffset>
        <DateOffset Type="SellBy" UnitOfOffset="day" IsPrintEnabled="true">005</DateOffset>
      </Dates>
      <LabelFormats Action="Create"><LabelFormatID Index="0">2</LabelFormatID></LabelFormats>
      <TargetWeights Action="Create"><TargetWeight Index="0" LowerTolerance="0" UpperTolerance="0" UnitOfMeasureCode="KGM">0</TargetWeight></TargetWeights>
    </Item>
    <!-- ...un <Item> por cada producto, todos dentro del mismo <ItemTransaction>... -->
  </ItemTransaction></Message>
  ```
  La balanza responde con un mensaje vacío de confirmación:
  `<Message><ARTSCommonHeader MessageType="Response"/></Message>`.

  Notas del formato, confirmadas comparando varios productos del catálogo
  real capturado:
  - `PLU`: el código del producto, sin ceros a la izquierda.
  - `AlternativeItemID`: el mismo PLU, pero como texto de 13 dígitos con
    ceros a la izquierda (ej. PLU 42 → `0000000000042`).
  - `Description Type="ItemName"`: el nombre/descripción del producto.
  - `ItemPrice` (dentro de `ItemPrices`): el precio, como número entero en
    pesos chilenos (sin decimales, ej. `1234` = $1.234).
  - `UnitOfMeasureCode`: `KGM` para productos que se venden por kilo (van a
    la balanza como pesables) o `PCS` para productos que se venden por
    unidad pero igual se imprimen en la balanza (ej. "POLLO ENTERO",
    "HAMBURGUESA QUESO 150 GRS") — hipótesis: esto corresponde al campo
    "Flag Balanza" (Pesable → `KGM`, Importe → `PCS`); los productos con
    flag "Normal" probablemente no van en este mensaje. **Falta confirmar
    esta hipótesis con el usuario.**
  - `Dates`, `LabelFormats`, `TargetWeights`: en los 200 productos
    capturados, estos valores fueron siempre los mismos (`SellBy` = 5 días,
    `LabelFormatID` = 2, `TargetWeight` = 0) — parecen ser configuración
    fija del sistema, no algo que varía por producto. **Falta confirmar si
    esto debe ser configurable o si un valor fijo por ahora está bien.**

### Modelo de datos de producto (confirmado por manual del sistema actual)
- Cada producto tiene un campo **"Flag Balanza"**: Normal / Pesable / Importe
  — determina si el producto necesita ir a la balanza.
- **Categorías en 3 niveles**, codificadas jerárquicamente, ej:
  `01 Aves > 0101 Pollos > 010101 Trutros`.
- **EAN (código de barras) es un campo aparte del PLU**, y solo aplica a
  productos que NO son pesables/importe (la balanza imprime su propio
  código con el peso/precio embebido). **Confirmado con foto real de
  ticket:** el código que imprime la balanza para un producto pesable
  sigue el patrón `2 + PLU (6 dígitos) + peso en gramos (5 dígitos) +
  dígito verificador` (ej. PLU 1, 226 g → `2000001002261`) — es un dato
  que la balanza genera sola combinando el PLU con el peso real pesado,
  no algo que nuestro sistema le manda. Relevante para más adelante (leer
  ese código al cobrar en caja), no para el módulo 4 en sí.
- Otros campos del maestro de producto vistos en el sistema actual:
  descripción, nombre corto, marca, contenido, capacidad x caja, envase,
  categoría, impuesto adicional, duración, código proveedor.

### Hay dos balanzas físicas, cada una con su propia IP (confirmado)
- Balanza 1: `192.168.18.122`
- Balanza 2: `192.168.18.120`
- Puerto de comunicación: 3001 (a confirmar si es el mismo para ambas).
- **Confirmado con el usuario:** las dos balanzas son espejo — todo el
  catálogo se manda igual a las dos IP, no hay reparto por
  producto/sección. El botón "Actualizar balanza" dispara el envío a
  ambas direcciones.

### Preguntas técnicas abiertas (ya no bloquean iniciar el módulo 4)
1. ¿`UnitOfMeasureCode` = `KGM`/`PCS` corresponde exactamente al "Flag
   Balanza" (Pesable/Importe) de cada producto? ¿Los productos "Normal" se
   excluyen del mensaje?
2. ¿Los valores fijos observados (`SellBy` 5 días, `LabelFormatID` 2,
   `TargetWeight` 0) deben ser configurables o está bien dejarlos fijos
   por ahora?

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

## Migración de datos del sistema viejo (Gexus)
- **Pendiente:** confirmar si Gexus tiene alguna forma de exportar/imprimir
  el listado completo de productos (Excel, CSV, PDF, reporte de "Maestro de
  productos"). Es el camino más directo para traer el catálogo completo
  (con categorías, marca, EAN, etc.) al sistema nuevo sin tener que
  tipearlo todo a mano.
- **Adelanto ya cargado:** mientras se resuelve eso, se importaron 199
  productos reales (PLU, nombre, precio, Pesable/Importe) usando los datos
  que ya teníamos de la captura de red de la balanza — quedaron en la
  categoría "Sin categorizar" para ordenar después. Herramienta reutilizable
  para cuando se consiga el listado completo (pantalla Productos → "Importar
  productos (CSV)").

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
  intermedia. **Actualizaciones:** al iniciar, el programa revisa si a la
  base de datos existente del usuario le faltan tablas de versiones más
  nuevas y las agrega solas, sin perder los datos ya ingresados (antes
  solo se preparaba la base de datos la primerísima vez, así que
  actualizar el programa sin esto dejaba tablas nuevas sin crear —
  causaba que pantallas como "Configuración" se quedaran cargando para
  siempre sin ningún error).
- **Balanza (módulo 4, pendiente):** no requiere un componente aparte en
  C#/.NET ni ningún SDK — el envío es un socket TCP directo con texto de
  ancho fijo, algo que Node.js hace nativo (módulo `net`). Se construye
  dentro del mismo servidor Node/Express del resto del sistema.
- **Usuarios:** solo una persona usa el sistema a la vez. El "login" es
  elegir el nombre de una lista (sin contraseña), solo para dejar registro
  de quién hizo cada cambio (ej. en el historial de precios).

## Estado de módulos
1. **Gestión de precios** — listo (productos, categorías, cambio individual/masivo, historial). Además, importación de productos nuevos desde CSV (columnas plu/descripción/precio/flag balanza/categoría — categoría opcional, cae en "Sin categorizar" si se deja vacía). Se usó para cargar 199 productos reales (PLU, nombre, precio) sacados de la captura de red de la balanza, como adelanto mientras se resuelve la migración completa desde el sistema viejo (Gexus) — ver "Migración de datos del sistema viejo" más abajo. También "Categorizar varios" (en la pantalla Productos): marcar productos con casillas (filtrando por "Sin categorizar" y/o buscando) y asignarles una categoría a todos de una vez — pensado para ordenar en bloque el catálogo importado. El filtro por categoría de Inventario reutiliza esas mismas categorías para hacer más rápido un conteo físico por sección.
2. **Inventario** — listo (proveedores, entradas, salidas/merma, stock actual con alerta de stock bajo y filtro por categoría, historial de movimientos).
3. **Reportes** — listo: inventario (entradas/salidas por motivo, top productos con más merma), precios (cambios y mayores variaciones) y ventas (cantidad de ventas, total vendido, más vendidos por cantidad y por ingreso), los tres por rango de fechas.
4. **Envío a balanza** — listo: botón "Actualizar balanza" en su propia
   pantalla, manda el catálogo completo (productos Pesable/Importe) por
   socket TCP directo a las dos balanzas (IP y puerto configurables),
   mostrando éxito/error por cada una. Verificado que el mensaje armado
   por el sistema es **idéntico, carácter por carácter**, al capturado de
   una balanza real (Wireshark). Quedan dos hipótesis sin confirmar al
   100% con el usuario (documentadas arriba): el mapeo Pesable→KGM /
   Importe→PCS, y si Dates/LabelFormats/TargetWeights deberían ser
   configurables en vez de fijos — ambas fáciles de ajustar si se
   confirma lo contrario. **Pendiente la prueba real** contra las
   balanzas físicas del local (todo lo anterior se probó contra una
   balanza falsa simulada, replicando el protocolo capturado).
5. **Caja / punto de venta** — listo (apertura con fondo fijo, punto de venta con carrito y pagos combinados efectivo/tarjeta/crédito, anulación de ítems con clave de supervisor solo una vez que hay pagos registrados, cierre con reporte X/Z y diferencia de efectivo). Crédito (fiado) agregado luego a pedido del usuario — ver "Decisiones tomadas en el módulo de caja" para el detalle (solo pide nombre del cliente, pantalla aparte de "Créditos pendientes" para cobrar después). También "Buscar venta" (por fecha o N° de venta) para ver el detalle/vale de una venta pasada e imprimirlo. Cada venta confirmada genera automáticamente movimientos de inventario (motivo "venta"), reutilizando la misma validación de stock del módulo de inventario.
6. **Asistente de IA** — listo y **confirmado funcionando con una clave de API real** por el usuario. Ver "Decisiones tomadas en el asistente de IA" más abajo.
7. **Gastos generales** — listo: registro de gastos del negocio (sueldos, luz, agua, etc., separado de las compras de mercadería) con resumen por categoría y total por rango de fechas. Ver "Módulo de gastos generales" más abajo.
8. **Despachos a domicilio** — listo: comunas con costo de envío fijo, marcar una venta como despacho (suma el costo al total), y reporte por comuna. Ver "Módulo de despachos a domicilio" más abajo.

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
- Cuenta corriente de clientes: originalmente fuera de esta primera
  versión — **decisión revisada**, se agregó una versión liviana: **crédito
  (fiado)** como tercer medio de pago, junto a efectivo y tarjeta. No es una
  cuenta corriente completa (no hay ficha de cliente ni historial de
  compras por persona) — solo pide el **nombre** del cliente al dejar la
  venta a crédito, y hay una pantalla aparte ("Créditos pendientes") para
  ver lo que se debe (agrupado por nombre) y marcarlo como cobrado después,
  eligiendo con qué medio pagó realmente (efectivo/tarjeta) en ese momento.
  Esa plata cobrada se suma al cierre X/Z del **día en que se cobra**, no
  del día en que se hizo la venta original — el crédito otorgado en sí NO
  cuenta como efectivo/tarjeta real hasta que se cobra, para no inflar el
  efectivo esperado en caja con plata que no entró.
- El stock de cada producto se descuenta recién al **confirmar** la venta
  (no al agregar un ítem al carrito), para no descontar stock de ventas que
  se cancelan antes de pagar.
- Los pagos **registrados** deben sumar exactamente el total de la venta
  para poder confirmarla — eso no cambió. Lo que sí se agregó: **vuelto en
  efectivo** (decisión revisada, antes se exigía pago exacto). El cajero
  escribe lo que el cliente entregó en la mano; el sistema registra solo la
  parte que cubre lo que falta y muestra el resto como vuelto en pantalla,
  sin guardarlo en ningún lado (no es dinero que quede en la caja, así que
  no afecta el cálculo de cierre X/Z). Solo aplica a efectivo — en tarjeta
  se sigue cobrando el monto exacto.
- **Lectura de código de barras:** la pantalla de Punto de Venta reconoce
  un lector físico tipo "teclado" (escribe el código y presiona Enter
  solo, sin drivers especiales). Prueba dos formatos, en este orden: (1)
  el código de fábrica exacto (campo `codigoBarras`, solo productos Flag
  Balanza = Normal); (2) si no hay coincidencia, el código de 13 dígitos
  que imprime la balanza para productos Pesable (`2` + PLU 6 dígitos +
  peso en gramos 5 dígitos + dígito verificador EAN-13 — ver
  `server/lib/codigoBarras.ts`), agregando automáticamente el peso real
  como cantidad. Probado con el código exacto de la foto del ticket real
  (`2000001002261` → 0,226 kg de CHURRASCO DE VACUNO, mismo total que el
  ticket). **No confirmado todavía:** el formato del código para productos
  "Importe" (precio fijo) — falta una foto de ticket de ese tipo de
  producto para confirmarlo; por ahora solo se decodifica el caso Pesable.
  **Ajustado tras feedback de uso real:** el lector no requiere hacer clic
  en ningún campo — un detector global (`useEscanerCodigoBarras`) reconoce
  el tipeo característico de un lector físico (carácter por carácter,
  muchísimo más rápido que una persona, termina en Enter) sin importar
  dónde esté el foco en ese momento, y no interfiere con el tipeo humano
  normal en el resto de la pantalla.
- **Vuelto como aviso emergente:** tras feedback de uso real ("se pierde
  fácilmente cuánto es"), el vuelto en efectivo se muestra con un popup
  bloqueante (no solo texto en la pantalla) para que sea imposible de
  perder de vista.
- **Búsqueda de producto con lista clickeable:** el buscador manual de
  productos (por PLU/nombre) mostraba los resultados dentro de un
  `<select>` que había que abrir para ver — con nombres ambiguos (ej. dos
  productos "arrollado" distintos) esto obligaba a un paso extra para
  distinguirlos. Ahora los resultados aparecen como una lista visible
  debajo del buscador, con nombre completo y precio, para elegir con un
  clic sin pasos intermedios.
- **Pantalla de Caja con letra y botones más grandes** (clase
  `.punto-de-venta`) — pensado para uso de pie en el mesón, no sentado
  frente a un mouse/teclado tradicional.
- **Teclado numérico en pantalla y medios de pago con íconos**, al estilo
  del sistema anterior (Gexus) — el usuario mostró fotos del sistema viejo
  y pidió replicar esos dos elementos puntuales (confirmó que el mesón usa
  mouse y teclado normal, no pantalla táctil, así que no se rehizo toda la
  pantalla al estilo del sistema viejo, solo estas dos partes). El teclado
  (`TecladoNumerico`) es un agregado junto a los campos de Cantidad y
  Efectivo recibido — el teclado físico se sigue pudiendo usar igual. Los
  medios de pago (antes un `<select>`) ahora son dos botones grandes con
  ícono (💵 Efectivo / 💳 Tarjeta, los únicos que maneja el sistema).
- **Fondo fijo con teclado numérico**: el mismo componente `TecladoNumerico`
  se agregó también al abrir caja, junto al campo de fondo fijo inicial —
  a pedido del usuario, para poder escribirlo rápido cada día sin
  necesitar el teclado físico.
- **Anular ítem del carrito sin clave, antes de pagar**: la clave de
  supervisor originalmente se pedía para anular cualquier ítem, incluso
  antes de empezar a pagar la venta. A pedido del usuario (caso real: el
  cliente cambia de opinión sobre un producto antes de pagar), ahora **no
  se pide clave si la venta todavía no tiene ningún pago registrado** — no
  hay plata ni stock comprometido todavía, así que no hay nada que
  proteger. Apenas se registra el primer pago, volver a quitar un ítem sí
  pide clave, para dejar rastro. El botón cambió de un texto "Anular" a
  una "✕" compacta.
- **Buscar venta y ver el detalle (vale) con opción de imprimir**: nueva
  pantalla "Buscar venta" (por rango de fechas o N° de venta) que muestra
  el detalle completo de una venta ya confirmada — productos, cantidades,
  medios de pago, total — con un botón "Imprimir" que usa la impresora que
  ya esté configurada en Windows (sin integrar una impresora térmica
  especial; `window.print()` con estilos propios para que solo se imprima
  el vale, no el resto de la pantalla).

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
- **N° de factura del proveedor**: campo opcional en las entradas por
  compra (junto a proveedor/costo), a pedido del usuario, para tener el
  respaldo de la factura ligado a esa compra. Se puede buscar/filtrar el
  historial de movimientos por ese número. No es un módulo de facturas
  separado — es solo un dato más de la entrada que ya se registraba.

## Módulo de gastos generales
Nuevo módulo, a pedido del usuario, para gastos del negocio que **no** son
compra de mercadería (sueldos, luz, agua, arriendo, etc. — la mercadería se
sigue registrando aparte, como entrada de inventario). Cada gasto es un
registro simple: fecha, categoría (texto libre, con sugerencias comunes),
descripción opcional, monto, quién lo registró. Pantalla con resumen por
categoría y total de un rango de fechas (para armar la planilla de fin de
mes), formulario para registrar, y opción de eliminar un gasto mal
ingresado (a diferencia del historial de precios/inventario, un gasto no
tiene ningún efecto en cadena sobre otros datos, así que corregirlo
borrándolo es seguro).

## Módulo de despachos a domicilio
Nuevo, a pedido del usuario, para poder informarle al asistente de IA
estadísticas de a qué comunas se despachan más pedidos y cuánto se cobra
por envío — antes esto no existía en el sistema (los pedidos con despacho
de la página web separada quedan solo en su propia planilla de Google
Sheets, sin relación con este sistema).

- **Comunas** (pantalla nueva, enlazada desde Caja): lista fija de
  comunas con su costo de envío predefinido — el usuario prefirió esto
  antes que texto libre, para que el cajero elija de una lista en vez de
  escribir la comuna cada vez (evita errores de tipeo y hace las
  estadísticas más confiables). CRUD simple (crear, editar, eliminar).
- **Marcar una venta como despacho** (en Punto de Venta): casilla "Es
  despacho a domicilio" + selector de comuna. El costo de envío de la
  comuna elegida se copia a la venta (no cambia después si el costo de
  esa comuna se actualiza) y se **suma al total que paga el cliente**.
  No se pidió trackear cuánto se le paga a quien reparte (eso quedó
  fuera a propósito, solo se registra lo que se cobra).
- **Detalle técnico importante:** la casilla de despacho NO llama al
  backend apenas se marca — primero solo muestra el selector de comuna en
  pantalla (estado local), y el despacho recién se confirma (llamada al
  backend, que exige una comuna) cuando se elige una comuna real. La
  primera versión llamaba al backend apenas se marcaba la casilla, sin
  comuna todavía, lo que el servidor rechazaba correctamente (falta la
  comuna) — pero visualmente la casilla "rebotaba" a destildada. Se
  corrigió antes de subir el instalador.
- **Reporte de despachos** (en Reportes): cantidad de despachos y total
  cobrado por envío en el rango de fechas, desglosado por comuna — para
  responder justo lo que pidió el usuario ("¿a qué comunas se despacha
  más?", "¿cuánto se cobra por envío?").
- El vale/detalle de una venta (pantalla "Buscar venta") muestra la
  comuna y el costo de envío cuando la venta fue despacho.

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
- **Herramientas de escritura masivas**, a pedido del usuario, para pedidos
  del tipo "pégale el texto de una factura y que la registre" o "cambia el
  precio/categoría de esta lista de productos" — sin esto, cada gestión
  necesitaba una propuesta separada por producto, muy lento para lotes.
  Tres herramientas nuevas, todas dentro de la misma regla de "propone,
  la persona confirma" (siguen contando como **una sola** propuesta por
  pedido, solo que ahora una propuesta puede traer varias líneas adentro):
  - `proponer_entradas_inventario_masivas`: para pegar el texto de una
    factura y registrar todas sus líneas de una vez (mismo proveedor y N°
    de factura, cada línea con su propio producto/cantidad/costo).
  - `proponer_categorizar_masivo`: asignar la misma categoría a varios
    productos a la vez (reutiliza el endpoint `categorizar-masivo` del
    módulo de precios).
  - `proponer_cambios_precio_masivos`: cambiar el precio de varios
    productos DISTINTOS a la vez, cada uno a su propio precio nuevo (para
    una lista de precios pegada, a diferencia de
    `proponer_cambio_precio_masivo_categoria` que aplica el mismo % a toda
    una categoría).
  Para las tres, el frontend ejecuta la confirmación llamando el mismo
  endpoint de un solo producto que usaría una persona a mano, una vez por
  cada línea (o el endpoint ya masivo, en el caso de categorizar) — nunca
  un camino de escritura aparte.
  **Salvaguarda clave para la parte de "leer factura":** el prompt le
  exige a la IA usar `buscar_productos` para encontrar el `productoId`
  real de cada línea, y **nunca adivinar** — si el nombre de una línea no
  tiene un match único y claro en el catálogo, tiene que preguntarle a la
  persona en vez de incluirlo en la propuesta (evita que, por ejemplo, un
  "Arrollado" ambiguo entre "ARROLLADO DE HUASO" y "ARROLLADO DE HUASO
  INTERNET" se resuelva mal solo).
  **Pantalla de confirmación mejorada:** para estas tres herramientas, la
  propuesta ahora muestra una tabla con el detalle línea por línea
  (producto, cantidad, precio/costo) además del resumen en texto — antes
  solo se mostraba una frase, insuficiente para revisar un lote de varios
  cambios con confianza.
  **Probado con respuestas simuladas del asistente** (este entorno de
  desarrollo no tiene una clave de Anthropic real configurada) contra el
  backend real: entrada masiva con proveedor/factura, categorización
  masiva y cambio de precios masivo — los tres aplicaron los cambios
  correctamente y quedaron reflejados en la base de datos. **Pendiente:**
  confirmar con el usuario que el modelo real (Claude) arma bien las
  propuestas a partir de texto de factura real, con su propia clave de
  API — el comportamiento de la IA en sí no se pudo probar en este
  entorno.
