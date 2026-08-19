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

## Diferencia de $2.000 comparando una venta contra el sistema viejo (Gexus)
El usuario probó una venta real en el sistema nuevo con los mismos productos
de una venta ya hecha en Gexus, y encontró una diferencia de $2.000 en el
total ($67.389 en Gexus vs. $69.389 en el sistema nuevo). Con fotos de
ambas pantallas, se comparó línea por línea: **todos los productos y
cálculos coinciden exactamente** (incluido el redondeo de los pesables,
ej. 1,534 kg × $4.980 = $7.639 en ambos) — **excepto uno**: "POLLO GANSO",
2 unidades, aparece a $12.980 c/u en Gexus ($25.960 total) pero a $13.980
c/u en el sistema nuevo ($27.960 total). $1.000 de diferencia × 2 unidades
= exactamente los $2.000 de diferencia total reportados.

**Conclusión: no es un bug de cálculo** — el sistema nuevo suma y redondea
igual que Gexus en todos los demás casos. Es un **dato de precio
desactualizado** para ese producto específico en uno de los dos sistemas.
**Pendiente confirmar con el usuario** cuál de los dos precios es el
vigente hoy, para corregir el que esté mal (vía Productos → editar
producto → cambiar precio, deja registro en el historial de precios como
cualquier otro cambio).

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
5. **Caja / punto de venta** — listo (apertura con fondo fijo, punto de venta con carrito y pagos combinados efectivo/tarjeta/crédito, anulación de ítems y cancelación de venta completa siempre con clave de supervisor + nombre de quien autoriza + motivo, cierre con reporte X/Z y diferencia de efectivo). Crédito (fiado) agregado luego a pedido del usuario — ver "Decisiones tomadas en el módulo de caja" para el detalle (solo pide nombre del cliente, pantalla aparte de "Créditos pendientes" para cobrar después). También "Buscar venta" (por fecha o N° de venta, con opción de anular ahí mismo una venta ya pagada — devuelve el stock, ver "Anular una venta ya confirmada" más abajo), "Anulaciones" (historial de productos anulados/ventas canceladas, antes o después de pagar) y "Revisiones" (productos con stock negativo pendientes de ajustar). Cada venta confirmada genera automáticamente movimientos de inventario (motivo "venta") — no bloquea por falta de stock, se corrige después con un ajuste manual si queda negativo.
6. **Asistente de IA** — listo y **confirmado funcionando con una clave de API real** por el usuario. Ver "Decisiones tomadas en el asistente de IA" más abajo.
7. **Gastos generales** — listo: registro de gastos del negocio (sueldos, luz, agua, etc., separado de las compras de mercadería) con resumen por categoría y total por rango de fechas. Ver "Módulo de gastos generales" más abajo.
8. **Despachos a domicilio** — listo: comunas con costo de envío fijo, marcar una venta como despacho (suma el costo al total), y reporte por comuna. Ver "Módulo de despachos a domicilio" más abajo.
9. **Cámara frigorífica** — en construcción, por etapas. Ver "Módulo de cámara frigorífica" más abajo para el detalle completo (alcance, decisiones tomadas, y estado de cada etapa).

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

### "Se pega" al usar el programa — diagnosticado y corregido
El usuario reportó que la ventana se quedaba congelada de vez en cuando (ej.
categorizando productos uno por uno), y que un click en la pantalla de inicio
de Windows la "descongelaba" al toque. Se le pidió revisar la consola de
Chrome DevTools (Ctrl+Shift+I / F12, ya funciona en el programa instalado
porque Electron trae el menú por defecto) la próxima vez que pasara: la
pestaña Console no mostró ningún error, y la pestaña Network mostró que todas
las llamadas al servidor (`categorizar-masivo`, `productos?categoriaId=...`)
respondieron 200 (éxito) sin ninguna quedar pendiente — descartando un
cuelgue real del servidor o la base de datos. Combinado con el detalle de que
un click afuera lo destraba, esto apunta a un problema conocido de
Chromium/Electron en Windows: la ventana deja de redibujarse por un problema
de aceleración por hardware (GPU/drivers), no un cuelgue del programa en sí.
**Corregido** agregando `app.disableHardwareAcceleration()` en
`electron/main.js` — la ventana se dibuja por CPU en vez de GPU, imperceptible
para una pantalla simple como esta. **Pendiente:** confirmación del usuario
de que el problema no vuelve a aparecer con la próxima versión instalada.

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
- **Cantidad de productos pesables con 3 decimales (gramos), no 2**:
  probando una venta real, un Choclillo pesó 1,382 kg en la balanza física
  ($19.320), pero el sistema solo dejaba ingresar 1,38 o 1,39 kg — una
  diferencia de $28, significativa para el usuario. El campo Cantidad (en
  Punto de Venta, y también en Registrar entrada/salida de inventario) tenía
  `step="0.01"` (dos decimales, o sea precisión de 10 gramos); se cambió a
  `step="0.001"` (precisión de 1 gramo) para que coincida con lo que
  realmente muestra la balanza. Además, ya que el peso pesado trae
  decimales, `precio × cantidad` puede dar centavos que no existen en pesos
  chilenos (ej. $19.320,36) — se agregó redondeo a peso entero al calcular
  el subtotal de cada ítem, igual que la balanza física redondea el total
  que imprime en su propio ticket. Probado end-to-end con los números
  reales del caso reportado (Choclillo a $13.980/kg × 1,382 kg): el sistema
  ahora da exactamente $19.320, igual que el ticket de la balanza.
- **Tarjeta autocompleta el monto**: a pedido del usuario, al hacer clic en
  el botón "💳 Tarjeta" el campo Monto se llena solo con lo que falta pagar
  de la venta — en tarjeta siempre se cobra el monto exacto (a diferencia de
  efectivo, donde el cajero escribe lo que el cliente entregó en la mano),
  así que no tiene sentido escribirlo a mano cada vez. Además, a pedido del
  usuario, el foco queda listo en ese campo para que apretar Enter agregue
  el pago al toque, sin soltar el teclado (reutiliza el mismo mecanismo de
  "Enter manda el formulario en el último campo" ya usado en el resto del
  sistema — con tarjeta, el campo Monto es el único campo del formulario de
  pago, así que Enter ahí ya lo manda).
- **Descuento manual (opcional), en porcentaje o en monto fijo**: a pedido
  del usuario, nueva sección "Descuento" en Punto de Venta (entre Despacho y
  Pagos). Se elige el tipo (Porcentaje / Monto fijo) y el valor, y se aplica
  con un botón — solo puede haber un descuento a la vez por venta, con
  botón "Quitar descuento" para sacarlo. El descuento aplica solo sobre el
  subtotal de los productos, no sobre el costo de envío. El de porcentaje
  se recalcula solo si el carrito cambia después de aplicado (ej. se agrega
  otro producto); el de monto fijo es un número fijo de pesos que no
  cambia. El vale de una venta ya confirmada (pantalla "Buscar venta")
  también muestra el descuento aplicado, si tuvo uno.
- **Anular SIEMPRE pide clave de supervisor (decisión revisada), y ahora
  también pide el nombre de quien autoriza**: a pedido del usuario, tanto
  quitar un producto del carrito (✕) como cancelar la venta completa piden
  clave en todos los casos — se saca la excepción que existía ("no hace
  falta clave si la venta todavía no tiene ningún pago registrado"). Además,
  el modal nuevo (`ModalConfirmarClave`, reutilizado en ambas acciones) pide
  elegir **el nombre de quien autoriza** de una lista, no solo la clave —
  así el registro queda a nombre de la persona real que aprobó la
  anulación, que no necesariamente es quien tiene la sesión de caja abierta
  (ej. un cajero junior pide la anulación, un supervisor la autoriza con su
  nombre y clave). `ItemVenta` ya guardaba `usuarioAnulacionId` /
  `motivoAnulacion` / `fechaAnulacion` desde el principio pero no se
  mostraban en ningún lado; se agregaron los mismos campos a `Venta` para
  cuando se cancela la venta completa. La pantalla "Buscar venta" ahora
  muestra una sección "Productos anulados" (no se imprime en el vale del
  cliente, solo visible en pantalla) con producto, cantidad, quién anuló y
  cuándo — el "registro" que pidió el usuario. Probado end-to-end: anular
  un ítem sin pagos registrados igual pide el modal, clave incorrecta la
  rechaza con error sin cerrar el modal, y el registro aparece correctamente
  en el detalle de la venta confirmada.
- **Motivo de anulación, con opciones rápidas + "Otro"**: agregado al mismo
  `ModalConfirmarClave`, con una lista corta para elegir rápido en vez de
  escribir a mano cada vez — distinta según sea anular un producto ("Ítem
  duplicado", "Cliente canceló ese producto", "Precio equivocado",
  "Producto equivocado", "Error de peso o cantidad") o cancelar la venta
  completa ("Cliente canceló la compra", "Venta duplicada", "Error del
  cajero"), más "Otro" en ambas para texto libre cuando ninguna calza. Es
  obligatorio elegir uno (o escribir el de "Otro") para poder confirmar,
  igual que el nombre y la clave. `Venta` necesitó un campo
  `motivoAnulacion` nuevo (mismo patrón que ya tenía `ItemVenta`). La tabla
  "Productos anulados" en "Buscar venta" ahora también muestra la columna
  Motivo. Probado end-to-end: falta elegir motivo bloquea la confirmación,
  "Otro" muestra el campo de texto libre y lo guarda tal cual.
- **Pantalla más compacta, en 2 columnas**: el usuario (con feedback de su
  papá probando el sistema) encontró que había que bajar mucho con el mouse
  para llegar a Pagos. Se reorganizó en dos columnas — izquierda: buscador +
  Carrito (lo que más se usa); derecha: Despacho, Descuento y Pagos — y
  Despacho/Descuento (que no se usan en cada venta) quedan plegados por
  defecto, mostrando solo un botón "+ Despacho a domicilio" / "+ Agregar
  descuento" hasta que se necesitan. Se agregó `overflow-x: auto` a
  `.tarjeta` de paso, porque con la columna más angosta alguna tabla se
  recortaba visualmente.
- **Atajos de teclado (F2/F3/F4) y aviso del lector en una sola línea**:
  feedback del papá del usuario usando la Caja real — el texto de aviso del
  lector de código de barras ocupaba 3 líneas, y quería que Despacho,
  Descuento y el buscador de productos no ocuparan espacio en pantalla.
  Se acortó el aviso a una sola línea, y el buscador de productos ("Agregar
  producto manualmente") ahora también empieza plegado igual que Despacho y
  Descuento (tiene sentido porque el lector de código de barras es la forma
  principal de agregar productos — el buscador manual es el respaldo, no
  hace falta tenerlo siempre abierto). Se agregaron atajos de teclado
  globales: **F2** abre el buscador y deja el foco listo para escribir,
  **F3** abre/cierra Despacho, **F4** abre/cierra Descuento — no chocan con
  el lector de código de barras (que ignora teclas que no sean un solo
  carácter, ver `useEscanerCodigoBarras`) ni con el tipeo normal en otros
  campos.
- **Vender sin stock disponible, corrigiendo después con un ajuste
  manual**: a pedido del usuario, se sacó la validación que bloqueaba
  agregar un producto al carrito (o confirmar la venta) si el stock
  registrado en el sistema no alcanzaba. Caso real: a veces el producto
  físico sí está disponible pero el stock del sistema todavía no refleja
  una entrada reciente (ej. una res recién despostada, antes de registrar
  la entrada formal). El stock puede quedar en negativo tras confirmar la
  venta — se corrige después con un ajuste manual en Inventario, como ya
  se hacía para otros casos de descuadre. Probado end-to-end: agregar y
  confirmar una venta de un producto con stock 0 no bloquea nada, y el
  stock queda en negativo, listo para ajustar.
- **Pantalla aparte "Anulaciones"**: a pedido del usuario, para ver de un
  vistazo todos los productos anulados y ventas canceladas de un rango de
  fechas, sin tener que abrir venta por venta en "Buscar venta". Nueva
  pantalla (enlazada desde Caja) con dos tablas — productos anulados
  (fecha, N° de venta, producto, cantidad, motivo, quién anuló) y ventas
  canceladas completas (fecha, N° de venta, total que tenía, motivo, quién
  anuló) — filtrables por rango de fechas, reutilizando el mismo patrón de
  fechas que Reportes/Buscar venta. Nuevo endpoint `GET /api/caja/anulaciones`.
- **Pantalla aparte "Revisiones"**: a pedido del usuario, para revisar los
  productos que quedaron con stock negativo tras venderse sin stock
  suficiente (ver "Vender sin stock disponible" arriba). Nueva pantalla
  (enlazada desde Inventario y desde Caja, porque el caso se origina ahí)
  que lista los productos con `stockActual < 0` — es una lista de
  pendientes, no un historial: apenas alguien corrige el stock con un
  ajuste, el producto deja de aparecer solo. Reutiliza el endpoint
  `GET /api/productos` existente con un filtro nuevo (`?stockNegativo=true`)
  en vez de crear un endpoint aparte.
- **Pantalla más compacta, en 2 columnas (rediseño)**: feedback del papá del
  usuario usando la Caja real, tras el primer reordenamiento en columnas:
  quería el Carrito bien visible (para ver de un vistazo qué está llevando
  el cliente y si hay que anular algo), no scrolear con el mouse, y navegar
  más con el teclado. Confirmado con el usuario (con preguntas antes de
  tocar código, dado lo grande del cambio): **izquierda** — Buscar producto
  y Pagos; **derecha** — Carrito arriba, Despacho y Descuento abajo (en
  tarjetas más chicas, clase `.tarjeta-mini` con menos padding y botones
  `.boton-chico`). **Navegación con flechas ↑/↓** entre las 4 secciones
  (Buscar → Despacho → Descuento → Pagos, en ese orden — el orden en que se
  usan al armar una venta, no necesariamente el orden visual en pantalla):
  salta directo al primer campo/botón de la siguiente sección. Se ignoran
  las flechas si el foco está en un input/select/textarea, para no pisar el
  comportamiento nativo (flechas del spinner numérico, cambiar de opción en
  un select) — hay que salir del campo (Tab, Escape, o click afuera) para
  volver a usarlas. Enter dentro de cada sección sigue funcionando como
  siempre (salta de campo en campo, manda el formulario en el último).
- **Descuento por producto (alternativo al descuento de toda la venta)**: a
  pedido del usuario, para poder descontar un producto puntual (ej. dañado,
  para convencer al cliente) en vez de solo la venta completa, con un
  registro más claro de qué se descontó. **Confirmado con el usuario**: los
  dos tipos de descuento son excluyentes — o se descuenta toda la venta, o
  se descuentan productos individuales, nunca los dos a la vez en la misma
  venta (evita confusión de "cuánto se descontó en total"). Nuevos campos
  `descuentoTipo`/`descuentoValor` en `ItemVenta` (mismo patrón que
  `Venta`), endpoint `PUT /ventas/:id/items/:itemId/descuento`, y el
  `subtotal` del ítem queda guardado ya con el descuento aplicado (redondeado
  a peso entero). El backend rechaza aplicar un tipo de descuento si el otro
  ya está activo, con un mensaje explicando qué hay que quitar primero; el
  frontend además oculta/reemplaza los botones correspondientes para que no
  se llegue a intentar. En el Carrito, cada fila tiene un botón "+ Desc."
  (columna nueva "Descuento") que abre un formulario chico en la misma fila
  (tipo %/$ + valor + OK). El vale de una venta confirmada ("Buscar venta")
  también muestra el descuento por producto, si tuvo uno. Probado
  end-to-end: aplicar 10% a un ítem baja el total correctamente, intentar
  aplicar descuento a toda la venta con un ítem ya descontado lo rechaza
  (backend y frontend), y aplicar descuento a toda la venta oculta el botón
  de descuento por producto en cada fila.

## Comentario opcional, medio de pago con flechas, e impresión automática del vale
Tres ajustes a Punto de Venta, a pedido del usuario, tras probar la caja con
una venta real de reposición:
- **Comentario opcional en la venta**: nueva sección "Comentario" (igual de
  compacta que Despacho/Descuento, atajo **F5**) para anotar algo libre sobre
  la venta (ej. "cliente pidió sin hueso", "entregar mañana"). Campo nuevo
  `Venta.comentario` (texto libre, opcional, máx. 500 caracteres), endpoint
  `PUT /api/caja/ventas/:id/comentario`. Se muestra también en el vale
  impreso (pantalla "Buscar venta"), justo debajo del vendedor.
- **Medio de pago (Efectivo/Tarjeta/Crédito) con flechas ←/→**: parado sobre
  cualquiera de los tres botones grandes, las flechas izquierda/derecha
  cambian el medio de pago seleccionado sin necesitar el mouse — simulan un
  click sobre el botón correspondiente para reusar exactamente la misma
  lógica que un click real (ej. autocompletar el monto en Tarjeta), leyendo
  cuál está activo desde el HTML en vez de depender del estado de React (el
  atajo de teclado se registra una sola vez al abrir la pantalla, así que
  guardarse el medio de pago "de memoria" ahí quedaría desactualizado).
  **Detalle técnico corregido durante la prueba:** el botón de Tarjeta ya
  movía el foco al campo Monto automáticamente (para que Enter cobre al
  toque) — eso hacía que, tras llegar a Tarjeta con las flechas, seguir
  presionando flecha se quedara "pegado" ahí, porque las flechas se ignoran
  a propósito cuando el foco está en un campo de texto (para no pisar el
  cursor). Se corrigió devolviendo el foco al botón justo después, así las
  flechas se pueden seguir usando en cadena (Efectivo → Tarjeta → Crédito y
  viceversa) sin quedar atascadas.
- **Impresión automática del vale al confirmar la venta**: antes solo se
  podía imprimir volviendo a buscar la venta a mano en "Buscar venta". Ahora,
  al confirmar, la pantalla salta directo a "Buscar venta" con esa venta ya
  abierta y **la manda a imprimir sola** (mismo botón/estilo que ya existía
  para imprimir a mano — usa la impresora que ya esté configurada en
  Windows). Probado con Playwright: `window.print()` se llama exactamente
  una vez apenas se carga el detalle de la venta recién confirmada.

## Anular una venta ya confirmada (pagada), devolviendo el stock
El usuario preguntó si al anular una venta el stock volvía al inventario.
Revisando el código se encontró que **no siempre** — anular un producto del
carrito o cancelar la venta completa *antes de confirmarla* (antes de
pagar) siempre estuvo bien, porque el stock recién se descuenta al
confirmar, así que ahí no hay nada que devolver. Pero **una vez que la
venta ya estaba confirmada (pagada), el sistema no tenía ninguna forma de
anularla** — si un cliente devolvía algo después de pagar, había que
corregir el stock a mano en Inventario, sin dejar registro de que fue por
una devolución.

**Decidido junto al usuario (entre las opciones más simples y las más
completas):** por ahora, anular una venta ya pagada solo se puede hacer
**completa** (no producto por producto — una devolución parcial requeriría
además decidir qué hacer con la plata ya cobrada de más, que queda para
más adelante si hace falta), y **solo mientras la caja del día en que se
hizo siga abierta** (para no reescribir el total de un cierre X/Z de un
día ya cerrado — si hace falta corregir algo de un día viejo, se sigue
pudiendo hacer a mano con un ajuste en Inventario).

Nuevo botón **"Anular venta"** en el detalle de una venta pagada (pantalla
"Buscar venta"), junto a "Imprimir" — mismo `ModalConfirmarClave` que ya se
usa para anular un producto o cancelar una venta sin pagar (motivo + quién
autoriza + clave de supervisor). Al confirmar: la venta pasa a estado
"anulada" (se saca automáticamente de los reportes y del cálculo del
cierre X/Z de esa caja, igual que ya pasaba con las cancelaciones antes de
pagar) y se devuelve el stock de cada producto activo de la venta, con un
movimiento de inventario nuevo por cada uno (motivo **"Devolución (venta
anulada)"**, visible en "Movimientos de inventario"). La pantalla
"Anulaciones" ya mostraba ventas canceladas antes de pagar — como
reutiliza el mismo campo `estado: "anulada"`, automáticamente también
muestra estas anulaciones de ventas ya pagadas, sin cambios ahí. El vale
de una venta anulada muestra un aviso ("Venta anulada — motivo, quién
autorizó, fecha") en pantalla (no se imprime).

Probado end-to-end: confirmar una venta de 2 kg de un producto, anularla
con clave de supervisor, y verificar que el stock quedó exactamente igual
que antes de la venta (con un movimiento "salida/venta" y uno "entrada/
venta_anulada" de la misma cantidad); intentar anular una venta de una
caja ya cerrada lo rechaza con el mensaje explicando que hay que corregirlo
a mano; intentar anular una venta que ya estaba anulada también se
rechaza.

## Impresión automática realmente silenciosa, y Punto de Venta más compacto
A pedido del usuario, tras confirmar que la "impresión automática" agregada
antes en realidad mostraba un aviso de Windows preguntando por la impresora
(el navegador/Electron muestra su propio diálogo de impresión por defecto,
por seguridad) — la idea era que fuera 100% sin intervención.

- **Impresión silenciosa real, solo en la app instalada (Electron):** se
  agregó `electron/preload.js` (puente seguro, con `contextIsolation`
  activado) que expone `window.electronAPI.imprimirSilencioso()`, la cual
  llama por IPC a un handler nuevo en `electron/main.js`
  (`ipcMain.handle("imprimir-silencioso", ...)`) que usa
  `webContents.print({ silent: true })` — esto sí se puede saltar el diálogo
  porque es la propia app, no una página web cualquiera. El vale
  (`web/src/pages/BuscarVenta.tsx`) ahora usa `window.electronAPI` cuando
  existe, y cae de vuelta a `window.print()` normal si no (necesario para
  cuando se prueba en un navegador de desarrollo).
  **Limitación de fondo, confirmada con el usuario:** el PC del mesón se usa
  hoy por navegador (conectado por WiFi a la IP del PC principal, sin el
  programa instalado ahí) — un navegador normal SIEMPRE muestra su propio
  diálogo de impresión por seguridad, no hay forma de evitarlo desde el
  código de una página web. El usuario eligió configurar ese PC en **"modo
  impresión silenciosa" (kiosk printing)** en vez de instalar el programa
  completo ahí — guía entregada (acceso directo de Chrome con la bandera
  `--kiosk-printing` apuntando a la URL del PC principal). **Primer intento
  falló** porque la IP de ejemplo de la guía (`192.168.1.15`, solo un
  ejemplo a reemplazar) se copió tal cual en vez de la IP real de la red del
  local (`192.168.18.x`, confirmada por la dirección que aparece al pie de
  un ticket impreso real) — corregido explicando que hay que sacar la IP
  real desde Configuración → "Conectar otro equipo" en el PC principal.
  **Pendiente:** confirmación del usuario de que el acceso directo con la
  IP correcta funciona.
- **Punto de Venta más compacto**, para que quepa en una pantalla de
  notebook sin scrollear: títulos y márgenes de tarjetas bastante más
  chicos (los botones/inputs/tabla mantienen su letra grande, pensada para
  usar de pie en el mesón — ver nota de arriba en el CSS). El buscador
  manual de productos ahora **se cierra solo** después de agregar un
  producto (igual que Despacho/Descuento/Comentario cuando no se usan — el
  lector de código de barras es la forma principal de agregar productos, el
  buscador es el respaldo). El **Total de la venta se movió al encabezado**,
  arriba a la derecha junto al título "Punto de venta" — a pedido del
  usuario, para que sea lo primero visible sin tener que bajar (como en el
  sistema anterior), en vez de solo aparecer al final de la tarjeta
  Carrito (que ya no lo repite, para no duplicar). El Carrito, si tiene
  muchos productos, ahora scrolea puertas adentro con el encabezado de la
  tabla siempre visible (`.carrito-scroll`), en vez de estirar toda la
  página — con un carrito de pocos productos no aparece ningún scroll.
  **Medido con Playwright** en varios tamaños de pantalla: en un monitor
  grande (1920x1080) ya no hace falta scrollear nada; en una notebook
  (1366x768) bajó de necesitar ~610px de scroll a solo ~140px — mejora
  grande, pero **no 100% eliminado todavía** en pantallas chicas. Falta
  confirmar con el usuario el tamaño de pantalla real que usan para seguir
  ajustando si hace falta.

## Módulo de cámara frigorífica
Módulo nuevo y grande, pedido a partir de un prototipo HTML que el papá del
usuario (Marco) ya venía usando (`camara_actual_referencia.html`, guardaba
todo en `localStorage` del navegador — sin base de datos compartida). El
usuario mandó un README detallado especificando el alcance; se hizo un
diagnóstico del sistema actual contra lo pedido, y varias rondas de
preguntas antes de tocar código (ver respuestas abajo). Se construye por
etapas, cada una probada antes de seguir a la próxima — igual que el resto
del proyecto.

**Idea central:** la cámara es una zona de almacenamiento *aparte* de la
sala de venta. Cada caja física tiene identidad propia (número, fecha de
ingreso, peso inicial, saldo, costo) — no es solo un número de stock
agregado como ya existe hoy para el resto del inventario
(`Producto.stockActual`). Una caja entra a cámara, y solo cuando sale hacia
"Sala de venta" corresponde generar una entrada en el inventario general
(`MovimientoInventario`) que aumente el stock vendible — recién ahí ese
producto queda disponible para vender en Caja. Salidas a producción,
merma, donación o mayorista NO tocan el stock de sala.

### Decisiones tomadas (con el usuario, antes de programar)
- **Roles/permisos:** no hay roles separados por acción (registrar/ajustar/
  reconciliar/administrar, como sugería el README original) — igual que el
  resto del sistema, cualquiera de los dos operadores puede hacer cualquier
  movimiento, pero queda registrado quién y cuándo.
- **Impresora de etiquetas:** una Gainscha térmica, ya comprada y conectada,
  ya probada con el prototipo HTML (que imprime bien, con "algunos ajustes"
  pendientes de precisar más adelante). El prototipo trae su propio
  generador de código de barras Code128-C en SVG (sin depender de ninguna
  librería externa) y usa `@page { size: 100mm 50mm; margin: 0 }` — se
  reutiliza esa misma lógica en el sistema nuevo, en vez de escribir un
  generador de códigos de barras desde cero.
- **Modo sin conexión:** solo para el celular (cuando se aleja del wifi del
  local), casos ocasionales y breves, necesita poder registrar salidas/
  ajustes (no solo consultar). Diseño: cada movimiento que cambia stock se
  guarda primero en el celular con una clave de idempotencia única; si hay
  conexión se manda al servidor al toque, si no, queda pendiente y se
  reintenta sola apenas vuelve la señal — sin duplicar ni perder ningún
  movimiento, gracias a esa clave (ya validada a nivel de base de datos,
  columna `MovimientoCamara.claveIdempotencia`, única). Falta implementar
  la cola local en el celular (etapa 7 del plan).
- **Salida a "Mayorista":** un registro simple y propio (`SalidaMayorista`)
  — no pasa por toda la lógica de Caja (sesión abierta, medios de pago,
  vuelto, etc.). Guarda producto, cantidad, precio total, y un estado que
  se puede marcar rápido entre "pagado" / "pendiente", más el nombre del
  cliente si corresponde.
- **Número de caja:** el README pedía un número de 6 dígitos generado por
  una secuencia de base de datos (nunca calculado en el navegador, para
  evitar duplicados). Se adaptó a la convención ya usada en todo el
  proyecto: se deriva del `id` autoincremental de Prisma (ej. id 28 →
  `"000028"`), sin guardar un campo aparte — mismo patrón que "Venta #22"
  en el resto del sistema. Sigue cumpliendo el requisito (nunca se calcula
  el próximo número en el navegador, la base de datos lo asigna sola).

### Modelo de datos (Prisma) — Etapa 1, lista
Tablas nuevas, todas `CREATE TABLE` (no se tocó ninguna tabla existente):
- **`CajaCamara`**: producto, familia (instantánea del nombre al ingresar
  — si el producto cambia de categoría después, la caja conserva la que
  tenía), fecha de ingreso, peso inicial, saldo, costo neto por kg, estado
  (`en_camara` | `parcial` | `salida` | `ajuste_pendiente`), si el peso es
  estimado (repartido desde un total de lote), quién la creó, y un campo
  `version` para control de concurrencia (evita que dos operadores
  descuenten la misma caja al mismo tiempo — se valida al momento de hacer
  el movimiento, etapa 3).
- **`MovimientoCamara`**: movimiento inmutable por caja (mismo principio
  que `MovimientoInventario` — nunca se reemplaza el historial editando
  solo el saldo). Tipo, peso, origen/destino, motivo, referencia opcional a
  otro registro (ej. una `SalidaMayorista`), usuario, dispositivo, y
  `claveIdempotencia` única (para el modo sin conexión y para rechazar
  reintentos duplicados en general).
- **`SesionInventarioCamara`**, **`InventarioCamaraEsperado`** (instantánea
  de las cajas con saldo esperado al ABRIR la sesión — indispensable para
  no generar falsos faltantes si entra/sale una caja durante el conteo) y
  **`EscaneoInventarioCamara`** (un escaneo por sesión+caja, índice único
  para que un doble escaneo no duplique el conteo).
- **`SalidaMayorista`**: producto, cantidad, precio total, estado de pago,
  cliente, caja de origen opcional, usuario.

Probado con un script de smoke test (no permanece en el repo): crear caja
→ movimiento → sesión de inventario → esperado → escaneo → salida
mayorista, y confirmar que el índice único rechaza un doble escaneo y que
`claveIdempotencia` rechaza un movimiento duplicado — todo correcto.
Confirmado que el catálogo de productos y las ventas existentes quedan
exactamente iguales después de la migración (189 productos, 16 ventas,
sin cambios). La migración nueva se aplica sola en instalaciones
existentes la próxima vez que se abra el programa, con el mismo mecanismo
ya usado para el resto de las actualizaciones (`aplicarMigracionesPendientes`,
`server/lib/migraciones.ts`) — no hace falta nada especial para esta.

### Etapa 2 — entrada de cajas + impresión de etiqueta, lista
Pantalla nueva **"Entrada de cámara"** (menú → Cámara → "Entrada de cajas"):
elegir producto (mismo buscador que ya se usa en el resto del sistema),
cantidad de cajas, y el peso — **de dos formas**: "se pesó cada caja" (peso
real, un valor que se copia igual a todas) o "solo se sabe el peso total
del lote" (se reparte estimado entre las cajas, marcadas `pesoEstimado:
true` para poder corregirlas después con un ajuste, en una etapa futura).
Más el costo neto por kilo. Al guardar (`POST /api/camara/cajas`, todo
dentro de una transacción): crea las N cajas y un `MovimientoCamara` tipo
`"entrada"` por cada una — **no toca el stock general** (`Producto.
stockActual`) ni crea `MovimientoInventario`, porque cámara es una zona de
almacenamiento aparte de sala de venta (ver "Idea central" más arriba); eso
recién pasa cuando una caja sale con destino `"sala_venta"`, en una etapa
futura.

- **Reparto exacto del peso total:** se trabaja en gramos enteros y el
  resto de la división se reparte de a un gramo extra en las primeras
  cajas (`repartirPesoKg` en `server/routes/camara.ts`) — así la suma de
  los pesos repartidos siempre da exactamente el total del lote, nunca se
  pierde ni gana nada por redondeo. Probado con varios casos (225kg/10
  cajas, 22,567kg/3 cajas, 100kg/7 cajas, etc.) — todos calzan exacto.
- **Familia:** se guarda una instantánea del nombre de la categoría nivel 1
  del producto al momento de crear la caja (`obtenerCategoriaRaiz`,
  `server/lib/categorias.ts`), no una referencia que cambie después si el
  producto se recategoriza.
- **Etiqueta (100×50mm):** se porta el código de barras Code128-C del
  prototipo HTML **tal cual** — se verificó con un script que la tabla de
  patrones y el resultado del algoritmo son **idénticos, bit por bit**, al
  del prototipo original para números de caja reales, así que sigue
  funcionando igual de bien con la impresora Gainscha ya probada. Todas las
  etiquetas del lote se muestran en pantalla (para poder revisarlas o
  reimprimir cualquiera después), cada una con su botón "Imprimir" — al
  apretarlo, solo esa etiqueta se manda a imprimir (no las demás), usando
  la misma impresión silenciosa de Electron que ya usa el vale de venta
  (`imprimirSilencioso`, ahora en `web/src/lib/imprimir.ts`, compartida
  entre boleta y etiqueta en vez de duplicada).
  **Detalle técnico:** boleta (80mm) y etiqueta (100×50mm) necesitan un
  tamaño de página de impresión distinto. Se probó primero "páginas con
  nombre" de CSS (`@page nombre` + `page: nombre`), pero no se pudo
  confirmar que el motor de impresión las respete de forma confiable —
  se cambió a una alternativa más simple y sí verificada: justo antes de
  imprimir una etiqueta se agrega una hoja de estilo aparte que fija el
  tamaño a 100×50mm, y se saca apenas termina de imprimir (dejando todo
  como estaba para la próxima boleta). Verificado con una exportación a
  PDF de prueba que el tamaño de página resultante da exactamente 100×50mm
  para la etiqueta y no afecta el de la boleta (80mm) en ningún sentido.
- **Probado de punta a punta** (Playwright): lote de 3 cajas con peso real
  conocido, lote de 7 cajas con peso total repartido (suma exacta
  verificada), código de barras con barras renderizadas, impresión de una
  sola etiqueta sin duplicar las demás, y validaciones del servidor
  (pedir los dos pesos a la vez, no pedir ninguno, producto o usuario
  inválido) — todas rechazadas con el mensaje correcto.

### Plan de las próximas etapas (sin empezar todavía)
3. Salida completa y parcial, con aviso FIFO.
4. Inventario por escaneo + conciliación de faltantes.
5. Mayorista + reportes.
6. Importador del prototipo HTML actual (para no perder lo ya cargado ahí).
7. Modo sin conexión del celular (cola local + reintento).
8. Pruebas de punta a punta.

## Elegir qué impresora usa cada cosa (arreglo de "la etiqueta no imprime")
El usuario probó imprimir una etiqueta de cámara desde el PC principal y no
salió nada — ni aviso, ni papel. Diagnosticado junto al usuario: en ese PC
hay una sola impresora física conectada (la Gainscha, para etiquetas — el
PC principal no tiene la impresora de boletas conectada). El código de
impresión silenciosa siempre mandaba el trabajo a la impresora
**predeterminada de Windows**, sin poder elegir una en particular ni
avisar si algo fallaba — así que si la predeterminada resultaba ser otra
cosa (ej. una impresora virtual como "Microsoft Print to PDF", que Windows
no siempre reemplaza sola al conectar una impresora nueva), el trabajo se
iba silenciosamente a ningún lado.

**Arreglado con dos cambios:**
- **Elegir impresora por tipo de documento**, en Configuración → nueva
  sección "Impresoras" (solo visible en la app instalada, no en el
  navegador): dos listas desplegables, "Boletas de venta" y "Etiquetas de
  cámara", con todas las impresoras que Windows detecta en ese PC (`electron.
  webContents.getPrintersAsync()`, expuesto como `listarImpresoras()` en
  `electron/preload.js`) — dejando "La predeterminada de Windows" como
  opción por defecto para no obligar a configurar nada si no hace falta.
  Es una preferencia de **ese PC en particular** (cada equipo tiene sus
  propias impresoras conectadas), guardada en `localStorage`
  (`web/src/lib/impresoras.ts`), mismo patrón que "modo caja exclusiva".
  `imprimir-silencioso` (`electron/main.js`) ahora acepta un `deviceName`
  opcional para mandar el trabajo a esa impresora puntual en vez de la
  predeterminada.
- **Avisar si la impresión falla**, en vez de no hacer nada: `web/src/lib/
  imprimir.ts` ahora revisa el resultado de `imprimirSilencioso()` y, si
  falló, muestra una alerta con el motivo (cuando Electron lo informa) y
  sugiere revisar Configuración → Impresoras. Antes, cualquier falla
  quedaba completamente en silencio — parecía que el botón "Imprimir" no
  hacía nada, exactamente el problema reportado.

Probado en el sandbox (sin impresora física real, pero validando la
mecánica): `listarImpresoras()` no revienta cuando no hay impresoras
conectadas (muestra un aviso en vez de una lista vacía confusa), y se
confirmó que pedir imprimir con un nombre de impresora inválido devuelve
un error claro (`"Invalid deviceName provided"`) en vez de fallar en
silencio — la persona sabrá exactamente qué revisar la próxima vez que
pase algo así.

### Segunda vuelta: elegir la impresora por nombre no fue suficiente
El usuario probó con la Gainscha real, ya elegida por nombre en
Configuración (el arreglo de arriba) — la etiqueta salía igual, esta vez
"tira la etiqueta, pero no imprime, sale en blanco" (antes no salía nada
en absoluto). Se descartó de a uno cada sospechoso con preguntas al
usuario en vez de adivinar: no es un problema de dos impresoras
compitiendo (solo hay una conectada en ese PC), no es que la Gainscha no
tenga página de prueba disponible, y **no es que estuviera mal
seleccionada** — el usuario confirmó que la había elegido por nombre en la
lista de Configuración.

El dato decisivo: **imprimir la misma pantalla con el diálogo normal de
Windows (Ctrl+P desde Chrome) sí funciona bien con esa misma impresora
física.** Eso aísla el problema a la impresión *silenciosa* de Electron
(`webContents.print({ silent: true, deviceName })`) en sí — con esta
impresora/driver en particular, ese camino no funciona aunque el
`deviceName` esté bien apuntado, mientras que el camino con diálogo
(`window.print()`) sí.

**Arreglo final:** la etiqueta de cámara ahora **siempre** usa el diálogo
normal de impresión (`window.print()`), incluso desde la app instalada —
a diferencia de la boleta, que se queda con la impresión silenciosa (ese
camino nunca se ha reportado fallando). Como imprimir una etiqueta es
algo ocasional (al recibir mercadería, no varias veces por hora como la
boleta), el clic extra de confirmar el diálogo es un costo aceptable a
cambio de que realmente imprima. Se sacó el selector "Etiquetas de
cámara" de Configuración → Impresoras (ya no tiene sentido, ese camino no
usa `deviceName`) y se dejó una nota explicando que las etiquetas siempre
muestran el diálogo de Windows.

Como la boleta (80mm) y la etiqueta (100×50mm) necesitan un tamaño de
página de impresión distinto y CSS no permite tener dos reglas `@page`
activas a la vez para el mismo documento, `imprimirEtiquetaCamara()`
(`web/src/lib/imprimir.ts`) agrega una hoja de estilo aparte que
sobrescribe el tamaño a 100×50mm justo antes de llamar a `window.print()`,
y la saca después — dejando todo como estaba para la próxima boleta (se
había probado antes "páginas con nombre" de CSS para esto, pero no se
pudo confirmar que el motor de impresión las respete de forma confiable).

Probado en el sandbox: el flujo completo (crear etiqueta → clic Imprimir
→ se agrega el estilo de página → se llama a `window.print()` → se saca
el estilo después) funciona correctamente. También se verificó, abriendo
la app real de Electron, que el clic ahora sí dispara un diálogo nativo de
impresión de verdad (se detectó el proceso de sistema que Chromium/Electron
usa específicamente para el diálogo de impresión, algo que no aparece con
impresión silenciosa) — confirmando que el cambio de código realmente
cambió el comportamiento y no se quedó pegado en el camino silencioso de
antes. **Pendiente:** confirmación del usuario de que, con el diálogo de
Windows apareciendo esta vez, la etiqueta física sale con contenido real
(no en blanco).

## Ajustes tras la primera semana de uso real: crédito, carrito y modo caja
Feedback del usuario tras usar el sistema unos días, comparándolo con
Gexus (con fotos de ambos). Antes de tocar nada se le hicieron preguntas —
ver el detalle de cada decisión abajo.

- **Tarjeta autocompleta el monto**: a pedido del usuario, al hacer clic en
  el botón "💳 Tarjeta" el campo Monto se llena solo con lo que falta pagar
  de la venta — en tarjeta siempre se cobra el monto exacto (a diferencia de
  efectivo, donde el cajero escribe lo que el cliente entregó en la mano),
  así que no tiene sentido escribirlo a mano cada vez. Además, a pedido del
  usuario, el foco queda listo en ese campo para que apretar Enter agregue
  el pago al toque, sin soltar el teclado (reutiliza el mismo mecanismo de
  "Enter manda el formulario en el último campo" ya usado en el resto del
  sistema — con tarjeta, el campo Monto es el único campo del formulario de
  pago, así que Enter ahí ya lo manda).
- **Crédito también autocompleta el monto**: mismo patrón que Tarjeta — el
  usuario notó que Crédito no lo hacía y pidió igualarlo. El foco queda en
  el nombre del cliente (el único dato que falta) en vez del monto.
- **Carrito simplificado, sin scroll ni horizontal ni vertical con un
  carrito normal**: el usuario reportó que después de la última compactación
  el carrito quedaba "peor" — con 5-6 columnas apretadas en la columna
  angosta de la derecha, hacía falta scrollear tanto para el costado (para
  ver Subtotal, que quedaba cortado) como para abajo (para ver los
  siguientes productos). Diagnóstico: el nombre del producto se cortaba en
  dos líneas por falta de espacio, inflando la altura de cada fila.
  **Elegido junto al usuario** (entre mantener 6 columnas comprimidas o
  simplificar la tabla): se sacó la columna "Descuento" como columna
  aparte — ahora el descuento por producto se ve como una anotación chica
  bajo el Subtotal (ej. "-$500 desc.") cuando está aplicado, y el botón para
  agregarlo/quitarlo es un ícono (🏷️) junto al de quitar el producto (✕),
  no una columna propia. Las columnas de la tabla ahora tienen un ancho fijo
  (`table-layout: fixed`) en vez de ajustarse solas, y el nombre del
  producto se corta con "..." si no cabe (con el nombre completo disponible
  al pasar el mouse encima, `title`) en vez de partirse en dos líneas.
  Probado con Playwright: un carrito de 3 productos (tamaño típico, según
  una boleta real que mostró el usuario) ya no necesita scroll en ninguna
  dirección, en monitor grande y en notebook.
- **"Modo caja exclusiva" para el PC del mesón**: el papá del usuario pidió
  que el PC que se usa solo para cobrar en el mesón no muestre el resto del
  menú (Productos, Inventario, Reportes, etc.), para que ese equipo quede
  dedicado solo a la Caja. **Elegido junto al usuario** (entre esconder solo
  el menú vs. bloquear también el acceso escribiendo la URL a mano): por
  ahora la versión simple — nuevo toggle "Activar modo caja exclusiva en
  este PC" en Configuración (`web/src/lib/modoCaja.ts`, guardado en
  `localStorage`, o sea es una preferencia de ESE navegador/PC puntual, no
  de la base de datos ni de una cuenta). Activado, el menú de arriba se
  reduce a "Caja", "Créditos" y "Configuración" (esta última se deja
  disponible a propósito, para poder volver a desactivarlo desde ahí
  mismo), y la pantalla de inicio pasa a ser Caja en vez de Productos. No es
  un bloqueo real — alguien que escriba otra dirección a mano igual podría
  entrar — el usuario prefirió empezar por lo simple y pidió ajustarlo
  después si hace falta más seguridad.

## Ticket con demasiado espacio en blanco (impresora térmica de 80mm)
El usuario mandó una foto del ticket impreso real: el detalle de la venta
salía arriba de todo, pero después quedaba mucho papel en blanco antes del
pie de página del navegador — confirmó que su impresora es térmica, de
rollo continuo, de **80mm** de ancho.

**Causa:** no había ninguna regla `@page` en el CSS de impresión, así que
el navegador usaba el largo de página que tuviera configurado por defecto
esa impresora (pensado para hojas normales), en vez de cortar el papel
apenas terminaba el contenido del vale.

**Arreglado** agregando `@page { size: 80mm auto; margin: 0; }` dentro de
`@media print` (`web/src/styles.css`) — el `auto` en el alto es la técnica
estándar para impresoras de rollo continuo: corta la página donde termina
el contenido, en vez de un largo fijo. Verificado con Playwright que el
ancho de 80mm se respeta exactamente (no se pudo verificar el alto "auto"
directamente porque generar un PDF de prueba exige una altura fija — es
una limitación de esa forma de probarlo, no de la técnica en sí, que es
ampliamente usada para este tipo de impresoras).

De paso se encontró que la tabla del vale (con columna "Descuento" aparte)
era demasiado ancha para 80mm y se habría cortado en el papel real —
mismo arreglo que ya se había hecho en el carrito de Punto de Venta: el
descuento por producto ahora es una anotación bajo el Subtotal en vez de
columna propia, y se agregó letra más chica específicamente en impresión
(`.vale` a `0.85rem`) para que quepa cómodo en 80mm. Verificado con
Playwright emulando el ancho real de impresión: la tabla completa (4
columnas) entra sin cortarse.

**Pendiente:** confirmación del usuario probando en la impresora física —
todo lo anterior se verificó con herramientas de navegador headless, no
contra el hardware real.

## Conectar otro equipo por WiFi (sin instalar el programa ahí)
El usuario instaló el programa completo en un segundo PC/monitor (el del
mesón de atención) para probar la Caja ahí, y no tenía ningún dato — porque
cada instalación crea su propia base de datos vacía, por diseño (para poder
funcionar sin internet). La arquitectura ya estaba pensada para este caso
desde el principio (ver "Arquitectura y stack"): el servidor escucha en la
red local, no solo en el PC, para que otros equipos se conecten **por
navegador**, sin instalar nada — el PC principal actúa de servidor mientras
el programa esté abierto ahí.

Como encontrar la IP a mano con `ipconfig` es incómodo, se agregó una
sección "Conectar otro equipo" en Configuración que detecta y muestra
automáticamente la dirección (ej. `http://192.168.1.15:5175`) usando
`os.networkInterfaces()` de Node (se descartan direcciones internas/
loopback). También recuerda que hay que revisar el Firewall de Windows si
la conexión no carga desde el otro equipo (bloquea conexiones entrantes por
defecto en algunas configuraciones).

## Margen (%) al cambiar el precio de un producto
A pedido del usuario, que mostró una captura real del sistema anterior
(Gexus) donde la pantalla de cambio de precio/costo mostraba un "Margen
(%)" junto al precio de venta. Se agregó lo mismo a la pantalla de editar
producto (junto al campo de cambiar precio): muestra el costo más reciente
registrado (la última entrada por compra de ese producto en Inventario —
no hay un campo "costo" fijo en la ficha del producto, así que se usa el
dato real más reciente) y el margen (%) actual, más un preview en vivo del
margen que quedaría si se aplica el precio nuevo que se está escribiendo.
Si el producto no tiene ninguna compra registrada todavía, se avisa en vez
de mostrar un número inventado.

**Fórmula, reproducida a partir de la captura real** (no está documentada
en ningún lado, se dedujo comparando los números exactos de la foto):
margen (%) = ((precio de venta ÷ 1,19) − costo) ÷ costo × 100 — es decir,
el margen de Gexus es un *markup sobre el costo*, calculado con el precio
de venta *sin IVA* (el precio que se carga en el sistema incluye IVA).
Verificado con el caso real de la captura (costo $11.190, precio venta
$18.980) — la fórmula da 42,53%, el mismo número exacto que mostraba
Gexus. **Pendiente de confirmar con el usuario** si esta fórmula (markup
sobre costo, con IVA 19% descontado del precio de venta) es efectivamente
la que quiere usar en general, ya que se dedujo de un solo ejemplo — fácil
de ajustar si no es exactamente así.

## Eliminar productos rápidamente (limpieza de datos)
A pedido del usuario, para limpiar productos basura que quedaron del CSV
importado inicial (ej. 13 productos con descripción literal "NULO" y
precios sin sentido), la pantalla Productos reutiliza el mismo modo de
selección que ya existía para categorizar varios a la vez (ahora llamado
"Seleccionar varios", en vez de "Categorizar varios" — mismo
checkbox por fila + "seleccionar todos"), agregando un botón "Eliminar
seleccionados" junto al de asignar categoría. Elimina (soft-delete,
`activo: false`, igual que el borrado individual desde la ficha del
producto) todos los productos marcados de una vez, con una confirmación
que aclara que no se puede deshacer desde la pantalla y que no borra
movimientos ya registrados. Probado end-to-end: los 13 productos "NULO"
reales de la base de datos de prueba se filtran con el buscador, se
seleccionan con "todos" y se eliminan en un solo clic — confirmado que
dejan de aparecer en el listado normal de productos.

## Selector de categoría en cascada (en vez de una lista larga)
El usuario reportó que mover productos entre categorías (ej. pescados
congelados que habían quedado mal puestos en "Artesanales") ya era posible
con "Seleccionar varios" (funciona para mover productos que YA tienen
categoría, no solo para categorizar los que no tienen ninguna), pero el
selector en sí era una sola lista larga con guiones indicando el nivel
("— 0501 Mariscos", "— — 050201 Atun") — con varias categorías y
subcategorías se volvía "un listado interminable" difícil de leer.

**Elegido junto al usuario (entre 3 opciones)**: reemplazar esa lista larga
por un selector en cascada de hasta 3 listas cortas — nivel 1, luego nivel 2
(solo las hijas de lo elegido en nivel 1), luego nivel 3 (solo las hijas de
lo elegido en nivel 2) — en vez de mantener una sola lista con indentado
visual, o construir un árbol desplegable tipo explorador de archivos (las
otras dos opciones ofrecidas, descartadas por menor beneficio o mayor
esfuerzo respectivamente).

Componente nuevo y reutilizable (`web/src/components/SelectorCategoria.tsx`)
usado en las 4 pantallas que antes tenían la lista larga con guiones:
filtro de categoría en Productos, categoría destino al mover productos en
lote (Productos), filtro de categoría en Inventario, categoría por producto
en el formulario de producto (ProductoForm), y categoría en Cambio masivo
por categoría. Se puede elegir una categoría y quedarse en cualquier nivel
(ej. asignar directo a "Vacuno" sin necesidad de elegir una subcategoría) —
cada lista intermedia trae una opción "(toda la categoría X)" para eso.
Cambiar una lista de más arriba reinicia las de más abajo. Donde hace falta
un filtro de "ver todo" (Productos, Inventario) el primer selector incluye
una opción "Todas las categorías"; donde se exige elegir una categoría
concreta (ProductoForm, Cambio masivo, destino al mover en lote) no la
incluye. Probado end-to-end con una jerarquía de prueba de 3 niveles
(Congelados > Mariscos > Atún): guardar un producto en cualquier nivel
queda con el `categoriaId` correcto, el filtro jerárquico de Productos
sigue mostrando también las categorías hijas al filtrar por una categoría
padre (reutiliza `obtenerIdsCategoriaYDescendientes`, ya existente), y
cambiar la selección de nivel 1 colapsa correctamente las listas de niveles
inferiores si la nueva categoría no tiene hijas.

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
- **Buscador de producto y proveedor con lista clickeable** en "Registrar
  entrada de mercadería": antes eran dos `<select>` planos — a pedido del
  usuario (mismo problema que ya habíamos resuelto en la búsqueda de
  producto de la Caja), ahora ambos son campos de texto con resultados
  clickeables debajo. Producto busca en el servidor a medida que se
  escribe (como en Caja, por el volumen de productos); Proveedor muestra
  la lista completa de una vez sin necesitar escribir nada (son pocos), y
  se puede escribir para filtrar por las iniciales.

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
