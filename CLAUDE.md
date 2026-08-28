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
9. **Cámara frigorífica** — listo (las 7 etapas: entrada de cajas con etiqueta impresa, salida con aviso FIFO y venta por mayor, inventario por escaneo con conciliación de faltantes, importador del sistema anterior, modo sin conexión del celular, y pruebas de punta a punta de todo junto). Ver "Módulo de cámara frigorífica" más abajo para el detalle completo. **Pendiente:** prueba con la impresora Gainscha real y confirmación del usuario usando el flujo completo con datos y hardware reales del local.
10. **Sincronización con la página web** — listo (catálogo/comunas/opciones de corte hacia lagrancarniceria.com, y pedidos web hacia el panel "Pedidos web"). Ver "Sincronización con la página web (lagrancarniceria.com)" más abajo. **Pendiente:** el usuario todavía no cargó el catálogo real completo (falta confirmar los PLU de Pollo y de algunos productos de Artesanales — ver esa sección) ni configuró la sync desde una instalación real (todo probado contra `dev.db` local).

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

### Etapa 3 — salida de cajas (completa o parcial), con aviso FIFO, lista
Pantalla nueva **"Salida de cámara"** (menú → Cámara → "Salida de cajas").
A pedido del usuario, se adelantó también el flujo completo de **venta por
mayor** (antes planeado para una Etapa 5 aparte) para que quedara junto con
el resto de los destinos de salida, en vez de dividirlo en dos etapas.

Antes de programar se le preguntó al usuario cómo debía identificarse la
caja al salir, qué tan estricto debía ser el aviso FIFO, y cómo se ingresa
el peso de una salida parcial — respuestas: **solo por escaneo** de la
etiqueta (no hace falta un buscador manual aparte), aviso **no bloqueante**
(se puede ignorar si hay una razón), y el peso de una salida parcial **se
escribe a mano** (el operador lo pesa aparte).

- **Identificación por escaneo**: reutiliza el mismo detector de lector de
  código de barras que ya usa Punto de Venta
  (`useEscanerCodigoBarras`) — como el número de la etiqueta ES el id de la
  caja (con ceros a la izquierda, ej. `000028` → caja 28), no hace falta
  decodificar nada especial, solo `parseInt` y pedir esa caja
  (`GET /api/camara/cajas/:id`). **Agregado después, a pedido del
  usuario:** un campo de texto + botón "Buscar" para escribir el número de
  caja a mano (misma pantalla, debajo del aviso de escaneo) — para cuando
  la etiqueta está dañada o ilegible y no se puede escanear. Llama a la
  misma función `buscarCaja` que ya usa el escaneo, sin duplicar lógica.
- **Destinos**: Sala de venta, Producción, Merma, Donación, Venta por
  mayor. Solo **Sala de venta** hace que el producto quede disponible para
  vender en Caja — genera un `MovimientoInventario` (motivo
  `"entrada_camara"`) que suma `Producto.stockActual`, igual que cualquier
  otra entrada de inventario. Los demás destinos (Producción, Merma,
  Donación, Mayorista) son salidas de cámara que **no** tocan el stock
  vendible, según la idea central del módulo (ver más arriba). El `tipo`
  de `MovimientoCamara` distingue completa/parcial solo para
  sala_venta/mayorista (`salida_completa`/`salida_parcial`); Producción,
  Merma y Donación usan un tipo propio (`consumo_produccion`, `merma`,
  `donacion`) sin esa distinción, porque una caja se puede consumir/mermar/
  donar de a poco igual.
- **Salida completa vs. parcial**: si el peso ingresado cubre todo el
  saldo de la caja (con una tolerancia de medio gramo para no rechazar por
  ruido de coma flotante), la caja pasa a estado `"salida"` con saldo 0; si
  no, queda `"parcial"` con el saldo restante — se puede volver a escanear
  esa misma caja después para seguir sacándole peso, hasta agotarla.
- **Aviso FIFO, no bloqueante**: al escanear una caja, se consulta si hay
  otra caja del mismo producto con saldo disponible y una fecha de ingreso
  más antigua (`GET /api/camara/cajas/:id/fifo`) — si la hay, se muestra
  una advertencia con el número de esa caja más vieja, pero no impide
  continuar (puede haber una razón válida, ej. la más vieja está en mal
  estado).
- **Control de concurrencia**: cada caja tiene un campo `version` que se
  manda de vuelta al confirmar la salida — si otra persona ya modificó esa
  caja mientras tanto (ej. dos operadores escanean la misma caja casi al
  mismo tiempo), el servidor rechaza con un error claro en vez de pisar el
  cambio ajeno, pidiendo volver a escanear.
- **Venta por mayor**: al elegir ese destino, el formulario pide cliente
  (opcional), precio total de la venta y estado de pago (pagado/pendiente,
  por defecto pendiente) — crea un registro `SalidaMayorista` ligado a la
  caja y al `MovimientoCamara` correspondiente (`referenciaTipo`/
  `referenciaId`), sin sumar al stock vendible (no pasa por Caja/Punto de
  venta, es un registro aparte y más simple, según ya se había decidido).
  Nueva pantalla **"Ventas por mayor"** (menú → Cámara → "Ventas por
  mayor"), mismo patrón que "Créditos pendientes" de Caja: lista filtrable
  por rango de fechas y por pendientes de pago, con un botón para marcar
  cada una como pagada (o volver a pendiente) después, sin tener que volver
  a la caja de origen.
- **Probado de punta a punta**: contra el backend real (salida completa a
  sala de venta con el stock subiendo correctamente, salida parcial a
  merma sin tocar el stock, intentar sacar más peso del que queda,
  concurrencia con `version` desactualizada, aviso FIFO detectando
  correctamente la caja más antigua sin bloquear la salida, venta por
  mayor completa con su registro y referencia cruzada, marcar/desmarcar
  pagada) y con Playwright contra la pantalla real (escanear una caja
  simulando el lector físico, ver el aviso FIFO en pantalla, elegir "Venta
  por mayor" y confirmar, verla aparecer en el listado nuevo) — todos los
  casos correctos.

### Etapa 4 — inventario por escaneo + conciliación de faltantes, lista
Nueva pantalla **"Inventario por escaneo"** (menú → Cámara → "Inventario
por escaneo") y una pantalla de resolución aparte, **"Ajustes
pendientes"**. Antes de programar se preguntó al usuario el alcance de
cada conteo (¿toda la cámara o por familia?), qué hacer si se escanea una
caja que no estaba en la foto esperada, qué hacer con las que faltan al
cerrar, y cómo se resuelven después — respuestas: **toda la cámara de una
vez** (sin filtro por familia por ahora), un escaneo no esperado **se
registra aparte sin bloquear**, las faltantes **quedan pendientes de
revisión manual** (no se ajustan solas), y se resuelven con **una pantalla
simple de dos botones** ("Confirmar que falta" / "Se encontró").

- **Abrir un conteo** (`POST /api/camara/inventario/sesiones`): toma una
  foto de qué cajas deberían estar en cámara en ese momento (todas las
  `en_camara`/`parcial`) guardada en `InventarioCamaraEsperado` — esta foto
  es indispensable para no generar falsos faltantes si entra o sale una
  caja mientras el conteo está en curso (esas cajas, ni a favor ni en
  contra, quedan fuera de la comparación). Solo puede haber **un conteo
  abierto a la vez** en todo el sistema — si alguien ya abrió uno, hay que
  cerrarlo antes de iniciar otro (evita que dos personas cuenten cámara al
  mismo tiempo con fotos distintas). Si se recarga la pantalla o alguien
  más la abre desde otro equipo, retoma automáticamente el conteo abierto
  en vez de ofrecer iniciar uno nuevo.
- **Escanear** (`POST /.../escanear`): reutiliza el mismo detector de
  lector de código de barras que ya usan Punto de Venta y Salida de
  cámara. Un doble escaneo de la misma caja **no duplica el conteo** (hay
  un índice único `sesionId+cajaId` en `EscaneoInventarioCamara`) — se
  avisa que ya estaba escaneada en vez de fallar. Si la caja escaneada no
  estaba en la foto esperada (ej. entró después de abrir el conteo, o
  técnicamente ya había salido pero seguía físicamente ahí), el escaneo se
  guarda igual y queda marcado como "no esperada" para revisar al cerrar —
  no bloquea el conteo.
- **Cerrar** (`POST /.../cerrar`): compara lo esperado contra lo
  escaneado. Las cajas esperadas que nunca se escanearon (posibles
  faltantes) quedan marcadas `estado: "ajuste_pendiente"` — **solo si
  siguen activas en cámara en ese momento**: si mientras tanto salieron
  por el flujo normal (Etapa 3), no faltó nada, simplemente ya no
  correspondía contarlas en este conteo. El reporte de cierre muestra
  ambas listas (faltantes y no esperadas) para revisar de un vistazo.
- **Ajustes pendientes** (pantalla nueva, listado de `estado:
  "ajuste_pendiente"`, mismo patrón que "Revisiones" para stock negativo):
  dos acciones por caja — **"Confirmar que falta"** la deja en saldo 0 y
  sale de cámara (`MovimientoCamara` tipo `"ajuste_salida"`, motivo
  "Faltante de inventario"), sin tocar el stock vendible de sala (la caja
  nunca pasó por "Sala de venta"); **"Se encontró"** la reactiva con el
  saldo que tenía antes del conteo (vuelve a `en_camara` o `parcial` según
  corresponda, `MovimientoCamara` tipo `"ajuste_entrada"`) — ambas quedan
  auditadas igual que cualquier otro movimiento de cámara.
- **Probado de punta a punta**: contra el backend real (foto esperada
  correcta al abrir, no deja abrir dos conteos a la vez, reintento de
  escaneo no duplica, caja creada después de abrir el conteo queda
  correctamente fuera de lo esperado, cierre marca solo las cajas
  realmente faltantes como `ajuste_pendiente`, no deja escanear ni cerrar
  una sesión ya cerrada, resolver como "encontrada" restaura el saldo
  exacto, resolver como "falta" no afecta el stock de sala) y con
  Playwright contra las pantallas reales (iniciar conteo, escanear
  simulando el lector físico, cerrar y ver el reporte, ver la caja
  faltante en "Ajustes pendientes" y resolverla) — todos los casos
  correctos.

### Etapa 5 — importador del prototipo HTML anterior, lista
Nueva pantalla **"Importar del sistema anterior"** (menú → Cámara →
"Importar del sistema anterior"). El prototipo que usaba el papá del
usuario (`camara_actual_referencia.html`) guardaba todo en `localStorage`
del navegador, sin base de datos compartida — esta pantalla trae esos
datos al sistema nuevo sin perder lo ya cargado ahí.

Antes de programar se le preguntó al usuario si la cámara del sistema
nuevo ya se había usado con datos reales (por si había riesgo de choque de
números de caja) — respuesta: **seguía vacía**, solo con datos de prueba.
Eso permitió la decisión clave: **preservar el mismo número de caja** que
ya está impreso en las etiquetas físicas del prototipo (ej. "000001" sigue
siendo la caja 1 en el sistema nuevo) en vez de asignar números nuevos —
así ninguna etiqueta física ya pegada necesita reimprimirse.

- **Cómo se obtienen los datos**: no hay botón de exportar en el
  prototipo (no se le agregó nada ahí, según la instrucción de no tocar
  el prototipo salvo lo necesario) — la pantalla explica cómo copiar el
  contenido con la consola del navegador
  (`copy(localStorage.getItem('granCarniceria_camara_v1')))`) y pegarlo,
  o subirlo como archivo `.json` si se guardó aparte.
- **Dos pasos: previsualizar y confirmar** (mismo patrón de "proponer,
  confirmar" usado en el resto del sistema, aplicado acá a una
  importación en vez de a la IA). `POST /previsualizar` agrupa las cajas
  del archivo por producto+familia (para no pedir una confirmación por
  cada caja individual, sino una por cada corte distinto) y busca una
  coincidencia **exacta** (insensible a mayúsculas) contra el catálogo de
  productos actual — si no hay coincidencia exacta, **no adivina**: queda
  sin sugerencia y hay que elegir el producto a mano con el mismo buscador
  que se usa en el resto del sistema, o dejarlo así para omitir esas
  cajas. También detecta de antemano qué números de caja ya existen en el
  sistema nuevo (conflicto) para excluirlos automáticamente y avisar.
  `POST /confirmar` vuelve a validar todo (no confía en lo que mandó el
  navegador) y crea las cajas con el número original preservado.
- **Qué se migra**: el estado actual de cada caja (producto, familia,
  peso inicial, saldo, costo, fecha de ingreso original) y un
  `MovimientoCamara` tipo `"entrada"` fechado en la fecha de ingreso
  original. **No se migra el historial detallado de salidas** del
  prototipo (los destinos que registraba no calzan uno a uno con los del
  sistema nuevo) — si una caja ya tenía saldo parcial, se resume en un
  solo movimiento de salida que deja el saldo correcto y auditado,
  aclarando en el motivo que el detalle original no se migró.
- **Probado de punta a punta**: contra el backend real (JSON inválido o
  con forma incorrecta se rechaza, agrupa correctamente por producto,
  sugiere el producto correcto sin importar mayúsculas/minúsculas, no
  sugiere nada para un nombre inventado, conflictos de número de caja se
  detectan y excluyen automáticamente, las cajas importadas conservan el
  número/saldo/fecha original, cajas sin producto elegido se omiten sin
  crear nada, reimportar el mismo archivo detecta las cajas ya importadas
  como conflicto en vez de duplicarlas, y el contador automático de la
  base de datos sigue funcionando bien después de insertar números altos
  a mano) y con Playwright contra la pantalla real (pegar el JSON,
  previsualizar, ver la sugerencia automática, confirmar y verificar que
  la caja quedó creada con los datos correctos).

### Etapa 6 — modo sin conexión del celular, lista
El diseño ya estaba definido desde antes de empezar el módulo (ver
"Decisiones tomadas" más arriba): cada movimiento que cambia stock se
guarda primero en el celular con una clave de idempotencia única; si hay
conexión se manda al servidor al toque, si no, queda pendiente y se
reintenta sola apenas vuelve la señal. Alcance acotado a **salidas y
ajustes** (los flujos que la respuesta original nombraba explícitamente) —
no incluye entrada de cajas ni el escaneo de un conteo de inventario, que
no se pidieron para este modo.

- **Cola local** (`web/src/lib/colaOffline.ts`, en `localStorage`, es de
  este celular en particular): `ejecutarOEncolar()` intenta la acción de
  inmediato; si el servidor la **rechaza de verdad** (ej. una validación,
  un conflicto de versión), lanza el error tal cual para que la pantalla
  lo muestre igual que siempre — la cola es solo para fallas de **conexión**
  (el `fetch` ni siquiera llega a responder), nunca para tapar un error real.
  Si falla por conexión, la acción queda guardada y la pantalla avisa
  "quedó guardada en este celular, se va a enviar sola" en vez de mostrar
  un error.
- **Reintento automático**: al recuperar señal (evento `online` del
  navegador) y además cada 15 segundos mientras la pantalla de Cámara esté
  abierta (por si el evento `online` no dispara de forma confiable en
  algún navegador) — implementado en `web/src/components/EstadoOffline.tsx`,
  un widget chico que se muestra en las pantallas de Cámara con cuántas
  acciones quedan pendientes de enviar.
- **Idempotencia real, verificada de punta a punta**: el celular genera la
  clave (`crypto.randomUUID()`) ANTES de intentar la petición, así que un
  reintento manda exactamente la misma clave. `server/routes/camara.ts`
  ahora revisa esa clave primero, antes de cualquier otra validación (ej.
  antes de comparar la versión de la caja, que ya cambió desde el primer
  envío exitoso) — si ya existe un `MovimientoCamara` con esa clave,
  devuelve el resultado ya guardado tal cual, sin tocar el saldo de nuevo.
  Aplica a `POST /cajas/:id/salida`, `POST /cajas/:id/confirmar-falta` y
  `POST /cajas/:id/encontrada`.
- **Si el reintento SÍ falla de verdad** (ej. mientras el celular seguía
  sin conexión, otra persona ya resolvió esa misma caja desde el local):
  la acción sale de la cola de pendientes — reintentarla para siempre no
  tiene sentido — y queda en una lista de "errores" aparte, visible en el
  mismo widget, para que la persona la revise a mano en vez de perderse en
  silencio.
- Los métodos `api.camara.salida` / `confirmarFalta` / `marcarEncontrada`
  (que no sabían de claves de idempotencia) se sacaron de `api.ts` —
  `CamaraSalida.tsx` y `CamaraAjustesPendientes.tsx` ahora llaman
  `ejecutarOEncolar()` directo, para no dejar un camino "directo" que
  alguien use por error sin el mecanismo de reintento.
- **Probado de punta a punta**: contra el backend real (un reintento con
  la misma clave pero con la versión vieja de la caja NO se rechaza por
  conflicto de versión — devuelve el mismo movimiento sin descontar saldo
  dos veces; mismo comportamiento verificado para confirmar-falta y
  encontrada) y con Playwright simulando una desconexión real (se
  interceptó y abortó la petición de red específica, no solo un mock) —
  confirmando que mientras "no hay señal" el servidor no registra ningún
  cambio, que el aviso correcto aparece en pantalla, que la sincronización
  automática (sin intervención) manda la acción sola en cuanto se destraba
  la conexión y el servidor sí aplica el cambio, y que una acción que el
  servidor rechaza al reintentarla (por un cambio real ocurrido mientras
  tanto) se saca de la cola y avisa en vez de reintentar para siempre.

### Etapa 7 — pruebas de punta a punta de todo el módulo junto, lista
Cada etapa ya se había probado por separado al construirla. Para esta
etapa final se armó un recorrido continuo que encadena TODAS las etapas
en una sola corrida, para confirmar que no se pisan entre sí (mismo
producto, mismas cajas, mismo catálogo compartido): entrada de un lote de
cajas → salida con aviso FIFO → salida a sala de venta (verificando que
sube el stock vendible) → venta por mayor y marcarla pagada → abrir un
conteo por escaneo, escanear solo parte de las cajas, cerrarlo → resolver
la caja que quedó pendiente → importar una caja del prototipo anterior
conviviendo con las cajas reales ya creadas en la misma corrida → una
salida en modo sin conexión que se sincroniza sola al final. Las 23
verificaciones del recorrido pasaron correctamente, confirmando que el
módulo completo (las 7 etapas) funciona como un solo sistema coherente,
no solo como piezas sueltas.

**Con esto, el módulo de cámara frigorífica queda completo** (las 7
etapas planeadas desde el diagnóstico inicial). Pendiente, fuera del
alcance de este módulo: la prueba con la impresora Gainscha real para las
etiquetas (Etapa 2) y la confirmación del usuario probando el flujo
completo con datos y hardware reales del local.

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
Gexus. **Confirmado con el usuario** (ver "Pantalla 'Mejor margen'" más
abajo): es la fórmula que efectivamente usa para fijar precios — explicó
que parte del costo, le aplica el % de ganancia que quiere, y recién ahí
agrega el IVA (ej. costo $1.000 → +40% → $1.400 → + IVA), que despejado
algebraicamente da exactamente esta misma cuenta.

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

## Cámara: revisar/anular entradas, etiqueta cortada en 2, e impresión de boleta que no imprimía con la Gainscha
Tres ajustes reportados por el usuario tras probar el módulo de cámara con
datos reales.

### Etiqueta cortada justo en el código de barras (pedía 2 etiquetas en vez de 1)
El usuario reportó que la etiqueta de 100×50mm no cabía completa: se
cortaba justo en el código de barras, y la impresora pedía una segunda
etiqueta para el resto. Comparando contra el prototipo original
(`camara_actual_referencia.html`), se encontró la causa: ese archivo tiene
**tres** bloques de estilo en cascada, y el tercero (el más específico,
agregado por el propio usuario con el comentario "más altura y aire
blanco para que teléfono y pistola enfoquen más rápido") **sobrescribe**
letra y márgenes más chicos en casi todos los elementos para compensar un
código de barras más alto — el ajuste final realmente usado por el
prototipo. Al portar la etiqueta al sistema nuevo (Etapa 2) se copió el
bloque **intermedio** (sin esa compensación final), dejando el contenido
total apenas por debajo de los 50mm de alto en teoría — pero los
navegadores calculan el alto real de una línea de texto usando las
métricas propias de la fuente (que suelen ser algo más altas que el
`font-size` nominal con `line-height: 1`), así que en la práctica se
pasaba de largo por muy poco. En pantalla no se notaba (`.etiqueta` tiene
`overflow: hidden`, que solo recorta visualmente), pero la impresora
física sí interpretaba que hacía falta una segunda etiqueta para el
sobrante.

**Arreglado** aplicando en `web/src/styles.css` los mismos valores del
bloque final del prototipo (letra y márgenes más chicos, código de barras
más alto: 18mm en vez de 15mm). Verificado con Playwright, generando una
entrada real y midiendo la altura real renderizada de todo el contenido
de la etiqueta (no solo el contenedor, que siempre da 50mm por el
`overflow: hidden`): **45,77mm** de 50mm disponibles — con margen de
sobra, contra los ~49,6mm nominales (y probablemente más de 50mm reales)
de antes.

### Boleta que no imprimía con la Gainscha seleccionada
El usuario reportó que, en Configuración → Impresoras → "Boletas de
venta", ya no lo dejaba usar la Gainscha para "imprimir el ticket
directamente". La causa es la misma limitación ya diagnosticada para las
etiquetas de cámara (ver más arriba, "Elegir qué impresora usa cada
cosa"): la impresión **silenciosa** de Electron
(`webContents.print({silent:true, deviceName})`) no funciona con el
driver de la Gainscha aunque el `deviceName` esté bien apuntado, mientras
que el diálogo normal de Windows sí — confirmado antes por el propio
usuario para las etiquetas. La boleta se había dejado a propósito en el
camino silencioso porque nunca se había reportado fallando, pero al
intentar usar la misma Gainscha también para boletas, aparece el mismo
problema.

**Arreglado en `web/src/lib/imprimir.ts`:** si la impresión silenciosa de
la boleta falla, en vez de solo mostrar una alerta sin imprimir nada, el
sistema **cae de vuelta automáticamente al diálogo normal de impresión**
(`window.print()`) — igual que ya hace la etiqueta siempre. El selector de
impresora en Configuración se mantiene (sigue siendo útil para impresoras
que sí soportan impresión silenciosa, evitando el diálogo en el caso
normal), pero ahora cualquier impresora que no la soporte igual termina
imprimiendo, solo que con un clic extra para confirmar el diálogo.

### Revisar y anular una entrada de cámara equivocada
El usuario hizo pruebas reales de "Entrada de cámara" y terminó con cajas
de prueba/duplicadas sin una forma de corregirlas con confianza de no
duplicar stock. Antes de programar se preguntó qué alcance debía tener
"anular" — respuesta: **solo para cajas sin ningún movimiento posterior**
(mismo principio que "Anular una venta ya confirmada" en Caja) — si una
caja ya tuvo una salida (completa o parcial), no se puede anular la
entrada directamente, hay que corregirlo aparte.

- **Nueva pantalla "Revisar entradas"** (menú → Cámara → "Revisar
  entradas"): lista todas las cajas de cámara de un rango de fechas
  (`GET /api/camara/cajas`, ahora con filtro opcional `desde`/`hasta`),
  con su producto, familia, fecha de ingreso, peso inicial, saldo, costo,
  estado y quién la creó.
- **Botón "Anular entrada"** visible solo en las cajas elegibles (estado
  `en_camara` y saldo todavía igual al peso inicial) — pide un motivo
  obligatorio y llama a `POST /api/camara/cajas/:id/anular-entrada`. El
  servidor vuelve a validar todo por su cuenta (no confía en que el botón
  estuviera oculto): rechaza si la caja ya tuvo alguna salida, o si ya
  tiene más de un `MovimientoCamara` (la propia entrada).
- **Nuevo estado `"anulada"`** para `CajaCamara` (no necesitó migración —
  `estado` ya era un campo de texto libre, no un enum de base de datos):
  la caja queda con saldo 0 y un `MovimientoCamara` tipo `"anulacion"` con
  el motivo. Al no ser `"en_camara"` ni `"parcial"`, una caja anulada
  **queda excluida automáticamente** de todo lo que ya filtraba por esos
  dos estados, sin tocar código aparte: el aviso FIFO, la foto esperada de
  un conteo por escaneo, y el listado de cajas activas. También se agregó
  el rechazo explícito al intentar sacarle algo desde "Salida de cámara"
  (antes solo rechazaba cajas ya con estado `"salida"`).
- **Probado de punta a punta**: contra el backend real (rechaza sin
  motivo, anula correctamente una caja recién creada, la caja anulada no
  aparece en listados activos ni en la foto esperada de un conteo nuevo,
  no se le puede sacar nada, no se puede volver a anular, rechaza anular
  una caja que ya tuvo una salida parcial, el filtro por fecha funciona) y
  con Playwright contra la pantalla real (la caja aparece en el listado,
  se anula con motivo desde la interfaz, el estado se actualiza y el
  botón desaparece).

## Revisión de seguridad del software
A pedido del usuario, revisión conversacional (preguntas antes de tocar
código, punto por punto según se fue encontrando cada cosa) de la
seguridad del sistema, con el contexto real confirmado por el usuario: es
una revisión preventiva general (no hay un incidente puntual), y la WiFi
del local es de confianza (solo familia/empleados, no hay clientes ni
terceros conectados a esa red).

### Contexto y decisión de fondo
El sistema no pide ninguna credencial para usar la API directamente —
confía en que quien esté conectado a la red WiFi del local ya es de
confianza (el "login" de elegir nombre sin contraseña ya era una decisión
tomada desde el principio, para mantenerlo simple). **Confirmado con el
usuario: esto se mantiene tal cual** — no se agrega un sistema de
sesión/token real por ahora. Lo que sí se hizo fueron mejoras puntuales
que no tocan ese modelo:

- **Bloqueo de la clave de supervisor tras varios intentos fallidos**:
  antes se podía probar las veces que se quisiera sin ningún freno.
  Ahora, tras 5 intentos fallidos seguidos desde el mismo equipo
  (identificado por IP, sin confiar en headers que cualquiera puede
  mandar — no hay un proxy real adelante que los agregue de forma
  confiable), se bloquea por 1 minuto antes de dejar intentar de nuevo —
  se levanta solo, sin reiniciar nada. Nuevo `verificarClaveConLimite()`
  en `server/lib/clave.ts`, usado en los 4 lugares del sistema que reciben
  la clave de supervisor directo de una petición HTTP (cambiarla, el
  endpoint de verificación que usa `ModalConfirmarClave`, anular un ítem
  de venta, cancelar/anular una venta). Probado de punta a punta: 4
  intentos fallidos no bloquean, el 5to sí dispara el bloqueo, un 6to
  intento (incluso con la clave correcta) se rechaza con 429 mientras
  dura el bloqueo, y pasado el minuto se levanta solo.
- **Límite de tamaño en las subidas**: no había ninguno puesto a
  propósito. El cuerpo JSON de las peticiones (`express.json()`) ahora
  tiene un límite explícito de 5mb (antes usaba el default de Express de
  100kb, que en realidad podía llegar a ser *insuficiente* para pegar un
  catálogo grande en el importador de cámara) y la subida de CSV de
  productos (`multer`) un límite de 10mb — antes no tenía ninguno,
  permitiendo subir un archivo de cualquier tamaño directo a memoria.
  Probado: un archivo normal sigue funcionando, uno de 15mb se rechaza.
- **Defensa liviana contra CSRF vía formulario**: se encontró que el
  endpoint de importar CSV (`multipart/form-data`) podía recibir una
  petición disparada por un formulario escondido en cualquier página web
  — a diferencia de un `fetch()` con JSON (que ya estaba protegido sin
  querer, porque el navegador exige una revisión previa —"preflight"— que
  el servidor no responde, así que la rechaza sola), un `<form>` HTML
  común puede mandar una petición `multipart/form-data` cruzando de sitio
  sin que el navegador la bloquee — el caso clásico de CSRF. Nuevo
  middleware en `server/index.ts`: cualquier pedido que cambia datos
  (POST/PUT/PATCH/DELETE) con un header `Origin` que apunte a un
  **hostname distinto** al del propio servidor se rechaza con 403. Se
  compara solo el hostname (sin el puerto) — un primer intento comparando
  origen completo con puerto rechazaba tráfico legítimo real (confirmado
  con una prueba de extremo a extremo: el proxy de Vite en desarrollo
  reenvía el pedido reescribiendo el puerto del header `Host`, aunque el
  `Origin` original del navegador se mantenga en el puerto de la
  pantalla) — comparar solo el hostname sigue bloqueando lo que importa
  (un sitio de dominio distinto) sin depender de que los puertos
  coincidan exactamente. Un pedido sin `Origin` (curl, algunos clientes
  que no son navegador) se deja pasar. Probado de punta a punta: tráfico
  real de la app (a través del proxy de Vite, y directo al backend) sigue
  funcionando, un origen de otro dominio se rechaza y no crea nada, un
  origen del mismo hostname en otro puerto se permite.

### Revisado y confirmado que ya estaba bien
- La clave de supervisor ya se guardaba con hash + sal aleatoria
  (`scrypt`) y comparación a prueba de "timing attacks" — no hacía falta
  cambiar el método, solo agregarle el bloqueo de intentos.
- Electron ya tenía la configuración seguro por defecto
  (`contextIsolation: true`, `nodeIntegration: false`).
- Prisma (el ORM) protege contra inyección SQL en todo el sistema — las
  únicas consultas SQL "crudas" (`$queryRawUnsafe`/`$executeRawUnsafe`,
  en `server/lib/migraciones.ts`) son internas, para aplicar
  actualizaciones de la base de datos, y no reciben nada que escriba el
  usuario.
- Sin vulnerabilidades conocidas en las dependencias (`npm audit` limpio).
- `.env` y la clave de la IA nunca se suben a git (ya documentado antes,
  ver "Decisiones tomadas en el asistente de IA").

## Ampliación del asistente de IA: 17 herramientas nuevas
A pedido del usuario, tras mostrarle el listado de las 14 herramientas que
tenía el asistente hasta ahora y proponerle una lista de cosas que podrían
agregarse — pidió incluirlas todas. Se agregaron **17 herramientas nuevas**
(10 de lectura, 7 de escritura con el mismo patrón "propone, la persona
confirma" de siempre), quedando **31 en total**.

### Lectura (se ejecutan directo, nunca cambian nada)
`consultar_venta` (detalle de una venta de Caja por número), `creditos_pendientes`,
`reporte_anulaciones`, `reporte_despachos`, `reporte_gastos`,
`historial_precio_producto` (todo el historial de UN producto, a diferencia
de `reporte_precios` que es agregado por rango de fechas),
`productos_stock_negativo`, `productos_sin_venta_reciente` (productos
activos sin ninguna venta confirmada en los últimos N días — para detectar
productos estancados), `consultar_camara` y `ventas_mayoristas_pendientes`
— el asistente antes no sabía nada de Caja, gastos, despachos ni cámara
frigorífica.

### Escritura (proponer_*)
`proponer_registrar_gasto`, `proponer_marcar_credito_cobrado`,
`proponer_crear_proveedor`, `proponer_desactivar_producto`,
`proponer_crear_comuna`, `proponer_entrada_camara` y
`proponer_salida_camara`.

- **Cámara frigorífica**: se decidió incluirla también para escritura (no
  solo lectura, que era la opción "seguro" planteada originalmente) porque
  el patrón de propuesta+confirmación ya delega toda la validación real al
  mismo endpoint que usa la pantalla de Salida de cámara — la IA no
  reimplementa el control de concurrencia (`version`) ni el aviso FIFO, solo
  arma la propuesta con los datos que sacó de `consultar_camara` en la
  misma conversación. Si la `version` quedó desactualizada para cuando la
  persona confirma (ej. alguien más le sacó algo a esa caja mientras
  tanto), el endpoint ya existente la rechaza igual que rechazaría un clic
  humano — la IA no tiene ningún camino para saltarse esa protección.
- **Créditos**: el prompt exige usar `creditos_pendientes` primero para
  tener el `pagoId` real — mismo principio de "nunca adivinar un id" que ya
  regía para productos/categorías.
- **Comparar períodos** (ej. "¿vendimos más este mes que el anterior?"): no
  se agregó una herramienta aparte — el prompt ahora indica que puede
  llamar la herramienta de reporte que corresponda más de una vez, con
  rangos de fechas distintos, y comparar los resultados en su propia
  respuesta.

Para reutilizar la lógica ya probada en vez de duplicarla, se extrajeron
tres funciones que antes vivían solo dentro de su ruta (`calcularReporteDespachos`
en `server/routes/reportes.ts`, `calcularReporteGastos` en `server/routes/gastos.ts`,
`calcularReporteAnulaciones` en `server/routes/caja.ts`) — mismo patrón que
ya existía para `calcularReporteVentas`, ahora usadas tanto por su endpoint
REST normal como por el asistente.

**Probado de punta a punta**: las 10 herramientas de lectura, contra el
backend real (cada una con datos de prueba creados a propósito, verificando
que trae exactamente lo esperado). Las 7 de escritura, simulando la
respuesta de la IA (este entorno no tiene una clave de Anthropic real) pero
ejercitando el código real de confirmación de `web/src/pages/Asistente.tsx`
contra la pantalla real con Playwright — clic en "Confirmar" y verificación
en la base de datos de que el cambio se aplicó de verdad (gasto creado,
proveedor creado, comuna creada, producto desactivado, crédito marcado
cobrado, caja de cámara creada y luego sacada a merma).

**Hallazgo aparte, no relacionado con esta ampliación**: durante las
pruebas se encontró que `agregarItemAVenta` (`server/routes/caja.ts`) puede
tirar abajo el proceso completo del servidor si se le pasa un `ventaId`
que no corresponde a ninguna venta (la promesa rechazada no queda atrapada
en ningún try/catch, así que Node la trata como una excepción no manejada
y termina el proceso) — un bug de robustez preexistente, no algo que esta
ampliación haya introducido. **Pendiente:** decidir si vale la pena
corregirlo (envolver ese llamado en un try/catch, o agregar un manejador
global de errores no capturados).

## Confirmar una venta ya no saca de Punto de Venta
El usuario probó el sistema con normalidad y notó que, al confirmar una
venta, la pantalla saltaba a "Buscar venta" para imprimir el vale — un
paso extra e innecesario cuando lo urgente es seguir cobrando a la
siguiente persona en la fila. Pidió explícitamente: imprimir el vale y
quedarse en Punto de Venta, listo para la próxima venta, sin navegar a
otra pantalla — confirmó con una captura de la pantalla vacía de Punto de
Venta que ese es el estado al que debe volver solo.

- **Vale extraído a un componente reutilizable** (`web/src/components/
  ValeVenta.tsx`): el markup del vale (antes solo dentro de
  `BuscarVenta.tsx`) se separó para poder reutilizarlo también en Punto de
  Venta sin duplicar la tabla de productos, pagos, descuentos, etc.
  `BuscarVenta.tsx` sigue funcionando igual (con sus botones Imprimir/
  Anular), y de paso se le sacó el código que ya no se usa (leer
  `?imprimir=<id>` de la URL — ya no lo manda nadie).
- **Impresión en segundo plano, sin salir de la pantalla**
  (`PuntoDeVenta.tsx`): al confirmar, en vez de `navigate("/caja/buscar
  ?imprimir=...")`, el sistema pide el detalle de la venta recién
  confirmada y lo guarda en un estado nuevo (`ventaParaImprimir`) que
  renderiza un `<ValeVenta>` **oculto en pantalla** (clase nueva
  `.vale-oculto-hasta-imprimir` en `styles.css`: `display: none` normal,
  `display: block` solo dentro de `@media print`) — invisible para el
  cajero, pero es lo que la impresión (`imprimirSilencioso()`) termina
  capturando. Al mismo tiempo se llama a `iniciarVenta()` (la misma
  función que ya arma una venta nueva vacía al entrar a la pantalla) para
  dejar todo listo para el siguiente cliente, sin ningún salto de página.
- **Probado de punta a punta con Playwright** contra el servidor de
  desarrollo real (no simulado): confirmar una venta real dispara
  exactamente una llamada a imprimir, la URL se queda en `/caja/venta`, el
  total vuelve a $0 y el carrito muestra "Todavía no hay productos en el
  carrito" — el mismo estado vacío que el usuario confirmó por captura de
  pantalla como el correcto.

## Un pedido con datos raros ya no puede tirar abajo todo el servidor
Bug de robustez que se había detectado antes (ver "Ampliación del
asistente de IA") y había quedado pendiente de decidir — el usuario pidió
corregirlo. La causa era general, no específica de un solo endpoint:
Express 4 (la versión que usa este sistema) **no** reenvía sola una
promesa rechazada dentro de un handler `async` hacia el manejador de
errores — si nadie la atrapa con `try/catch`, Node la trata como una
excepción no manejada y **termina todo el proceso del servidor**, no solo
esa petición puntual. Como ninguna ruta del sistema usaba `try/catch` (se
apoyaban, sin saberlo, en que Express lo atrapara solo — cosa que no pasa
en la versión 4), una petición con datos raros en cualquier pantalla podía
tirar abajo el programa completo para todos los que lo estuvieran usando
en ese momento, no solo fallar esa acción puntual.

**Arreglado con `express-async-errors`** (paquete chico y muy usado,
importado al principio de `server/index.ts`, antes de crear las rutas):
hace que Express sí reenvíe esas promesas rechazadas al manejador de
errores que ya existía (`errorHandler`, que ya devolvía un error 500
prolijo) — en vez de agregar `try/catch` ruta por ruta en todo el sistema,
mucho más grande y fácil de dejar alguna sin cubrir.

Probado contra el servidor real: un pedido con un ID de venta que no es un
número (`POST /api/caja/ventas/no-es-un-numero/items`, el caso que antes
crasheaba todo) ahora devuelve un error 500 prolijo y **el servidor sigue
respondiendo con normalidad** al pedido siguiente — confirmado pidiendo
`/api/usuarios` justo después y agregando un producto real a una venta de
verdad sin ningún problema, sin ningún cambio de comportamiento para los
pedidos normales.

## Confirmar una venta se queda en Punto de Venta (antes saltaba a "Buscar venta")
A pedido del usuario: al confirmar una venta, el sistema saltaba a la
pantalla "Buscar venta" para imprimir el vale — un paso extra e innecesario
cuando lo urgente es seguir cobrando a la siguiente persona en la fila.
Confirmado con una captura de la pantalla vacía de Punto de Venta cuál es
el estado exacto al que debe volver solo.

- **Vale extraído a un componente reutilizable** (`web/src/components/
  ValeVenta.tsx`): el markup del vale (antes solo dentro de
  `BuscarVenta.tsx`) se separó para poder reutilizarlo también en Punto de
  Venta sin duplicar la tabla de productos, pagos, descuentos, etc.
  `BuscarVenta.tsx` sigue funcionando igual (con sus botones Imprimir/
  Anular); de paso se sacó el código que ya no se usa (leer `?imprimir=<id>`
  de la URL — ya no lo manda nadie).
- **Impresión en segundo plano, sin salir de la pantalla**
  (`PuntoDeVenta.tsx`): al confirmar, en vez de navegar a `/caja/buscar
  ?imprimir=...`, el sistema pide el detalle de la venta recién confirmada
  y lo guarda en un estado nuevo (`ventaParaImprimir`) que renderiza un
  `<ValeVenta>` **oculto en pantalla** (clase nueva
  `.vale-oculto-hasta-imprimir` en `styles.css`: `display: none` normal,
  `display: block` solo dentro de `@media print`) — invisible para el
  cajero, pero es lo que la impresión (`imprimirSilencioso()`) termina
  capturando. Al mismo tiempo se llama a `iniciarVenta()` (la misma función
  que ya arma una venta nueva vacía al entrar a la pantalla) para dejar
  todo listo para el siguiente cliente, sin ningún salto de página.
- Verificado con `npm run typecheck` (limpio) y contra el servidor de
  desarrollo real: confirmar una venta imprime el vale y la pantalla se
  queda en Punto de Venta con el carrito vacío, listo para la siguiente
  venta — el mismo estado que el usuario confirmó por captura de pantalla
  como el correcto.

## Asistente de IA: aclaración sobre productoId, y capacidad de crear productos
El usuario preguntó por qué, al pedirle al asistente que leyera el texto de
una factura, mencionaba un "id de producto" en vez del PLU. **Aclaración:**
son dos cosas distintas a propósito — el PLU es el código que el negocio
usa para identificar un producto (el mismo de siempre, el que se tipea en
Caja o se manda a la balanza); el "productoId" es el identificador interno
de la base de datos (un correlativo interno, sin relación con el PLU) que
usa el asistente puertas adentro para no confundir productos con nombres
parecidos — nunca se le pide a la persona que lo escriba ni aparece en
ninguna pantalla del sistema, solo lo usa la IA internamente al armar una
propuesta (siempre después de buscar el producto con `buscar_productos`,
nunca inventado).

Además, a pedido del usuario, se agregó una herramienta nueva:
**`proponer_crear_producto`** (mismo patrón "propone, la persona confirma"
de siempre) — crear proveedores nuevos ya existía (`proponer_crear_proveedor`,
agregado en la ampliación anterior), así que solo faltaba poder crear
productos nuevos completos, no solo cambiarles precio/categoría a uno ya
existente. Pide PLU, descripción, categoría, precio y Flag Balanza
(NORMAL/PESABLE/IMPORTE) — más marca y código de barras si aplica. El
prompt le exige al asistente usar `buscar_productos` primero para
confirmar que el PLU no esté ya en uso (evita proponer un duplicado que el
servidor rechazaría igual, pero mejor avisarlo antes) y `listar_categorias`
para tener el `categoriaId` real, igual que ya exigía para el resto de las
herramientas de escritura. La confirmación en pantalla llama exactamente
al mismo endpoint (`POST /api/productos`) que usaría una persona creando un
producto a mano desde la pantalla de Productos — mismas validaciones
(PLU/código de barras duplicado, categoría inexistente, código de barras
solo permitido si Flag Balanza es NORMAL).

## Cámara: ajustado al sistema que ya usaba el papá del usuario, en paralelo
El papá del usuario venía trabajando, en paralelo, en su propio archivo
HTML de referencia (`camara_prueba_3_una_etiqueta...html`, con el mismo
mecanismo de `localStorage` que el prototipo original ya portado) —
evolucionado con ideas propias (agrupar cajas en "lotes", familia como
lista fija, corregir/reimprimir/anular un lote completo). El usuario pidió
que el módulo ya construido se ajustara para quedar "igual o lo más
similar posible" a ese archivo, ya que su papá se familiarizó con ese
flujo. Antes de tocar código se le mandó el README y luego el HTML real
para revisar, y se hicieron varias preguntas de alcance antes de
implementar — respuestas: replicar fiel (aunque cambie el modelo de
datos), familia como lista fija, **seguir usando el catálogo real de
Productos** (no adoptar el catálogo simple del prototipo, que era solo
nombre+familia sin PLU/precio — necesario para que "Salida → Sala de
venta" siga sumando stock al producto vendible correcto), y agregar
Corregir/Reimprimir/Anular a nivel de lote. Confirmado con el usuario que
las pocas cajas de prueba que su papá alcanzó a cargar en ese archivo no
hacía falta migrarlas.

- **`LoteCamara`** (tabla nueva): agrupa las cajas que entraron juntas en
  una misma entrada (producto, familia, cantidad, peso total, costo, total
  neto). Las cajas (`CajaCamara`) siguen siendo el registro real de stock;
  el lote es solo el "grupo" al que pertenecen — no tiene saldo ni
  movimientos propios. `CajaCamara.loteId` es opcional solo por las cajas
  que ya existían antes de este campo: al iniciar el programa,
  `reconstruirLotesCamaraFaltantes()` (`server/lib/migraciones.ts`) les
  arma un lote automáticamente agrupándolas por producto/familia/
  procedencia/costo/usuario y cercanía en el tiempo de ingreso (ventana de
  5 minutos, el margen real entre cajas de un mismo lote creado por el
  for-loop de la entrada) — si la agrupación no calza perfecto en algún
  caso raro, el peor resultado es un lote de una sola caja, nunca se
  pierde ni se altera ningún dato. Se corre en cada arranque pero es
  segura de repetir (no hace nada si ya no quedan cajas sin lote).
  Verificado con la base de datos de prueba real: 72 cajas sin lote se
  agruparon en 21 lotes, con la suma de kilos exactamente igual antes y
  después, y una segunda llamada no crea nada más.
- **Familia fija**: pasó de sacarse sola de la categoría del producto
  (`obtenerCategoriaRaiz`) a una lista fija elegida a mano — Vacuno /
  Cerdo / Pollo / Otros, igual que el archivo de su papá — se sigue
  guardando en el mismo campo `familiaNombre` (instantánea, como ya
  funcionaba).
- **Paso de revisión antes de guardar** (`CamaraEntrada.tsx`): "Revise el
  lote antes de ingresarlo" con el resumen (familia, producto, cantidad,
  peso total, costo, total neto) — recién al confirmar ahí se crean las
  cajas, igual que el archivo de su papá.
- **"⚡ Imprimir lote completo"**: además del botón que ya existía para
  imprimir una etiqueta a la vez, un botón nuevo manda todas las etiquetas
  de un lote en un solo trabajo de impresión (una por página, con salto de
  página entre cada una — `.imprimiendo-lote` en `styles.css`), con un
  aviso recordando dejar "Copias" en 1 antes de imprimir.
- **Pantalla nueva "Existencias"** (`CamaraExistencias.tsx`): cajas
  disponibles agrupadas por familia y producto con subtotal por familia
  (arriba), y una sección desplegable "Ver lotes ingresados" con el
  detalle de cada lote y tres acciones — **Corregir** (cambia familia/
  producto/peso total/costo de todo el lote a la vez, repartiendo el peso
  corregido entre sus cajas con el mismo reparto exacto que al crearlas;
  queda auditado en `CorreccionLoteCamara`, y cada caja recibe un
  `MovimientoCamara` tipo `"correccion_entrada"` con su peso nuevo, sin
  sobrescribir el movimiento de entrada original), **Reimprimir** (vuelve
  a mostrar las etiquetas con los mismos números, no crea ningún registro
  nuevo) y **Anular** (mismo principio que ya existía para anular una caja
  individual, aplicado a todas las cajas del lote de una vez, con motivo
  obligatorio). Las tres quedan **bloqueadas si cualquier caja del lote ya
  tuvo una salida** — mismo principio que "Anular una entrada" ya usaba
  para una caja sola.
- **"Otro" como destino de salida** (agregado al lado de Sala de venta/
  Producción/Merma/Donación/Venta mayorista), y pantalla nueva **"Reporte
  de salidas"** (`CamaraReporteSalidas.tsx`): kilos y valor neto egresado
  por destino en un rango de fechas, más los últimos 50 movimientos.
- **Probado de punta a punta**: contra el backend real (rechazo de
  entrada/corrección sin datos válidos, reparto exacto del peso corregido,
  bloqueo de las tres acciones de lote apenas una caja tiene una salida,
  reporte de salidas con los destinos correctos) y con Playwright contra
  las pantallas reales (familia fija con Vacuno mostrando el campo de
  procedencia, revisión antes de guardar, etiqueta impresa con los datos
  correctos, Existencias con sus tres acciones de lote funcionando,
  Revisar entradas y Reporte de salidas sin errores de consola).

### Procedencia del vacuno (Nacional / Brasil / Paraguay)
A pedido del usuario, para saber de dónde viene la carne de vacuno. Campo
nuevo `procedencia` en `LoteCamara` y `CajaCamara` (texto libre a nivel de
base de datos, pero la interfaz solo deja elegir entre esas tres
opciones) — **obligatorio si la familia es Vacuno, y no aplica a las
demás familias** (el servidor rechaza ambos casos: falta procedencia en
Vacuno, o procedencia puesta en una familia que no es Vacuno). Se pide en
Entrada de cámara (aparece solo si se elige familia Vacuno) y se puede
corregir junto con el resto de los datos del lote en Existencias — ambos
casos quedan auditados en `CorreccionLoteCamara` (`procedenciaAnterior`/
`procedenciaNueva`). Se muestra en la etiqueta impresa (junto a la
familia, ej. "Vacuno · Brasil") y como columna en "Revisar entradas". El
asistente de IA también la conoce: `consultar_camara` la incluye en la
respuesta y `proponer_entrada_camara` la pide (obligatoria solo si la
familia es Vacuno).

## Importar cámara: también acepta un resumen transcrito a mano (sin consola)
El usuario intentó exportar las cajas ya cargadas en el archivo de su papá
con el método de siempre (consola del navegador,
`copy(localStorage.getItem(...))`), pero no funcionó — la consola no le
devolvía los datos. Como alternativa, armó (con otra conversación, a partir
de fotos de la pantalla de Existencias) un JSON con los **totales por
lote** (fecha, hora, familia, producto, cantidad de cajas, sus números,
kilos totales y valor neto total) — sin el peso individual de cada caja,
que las capturas no mostraban.

**La pantalla "Importar del sistema anterior" ahora acepta los dos
formatos**, detectando solo con el JSON pegado cuál es cuál (`server/routes/
camara.ts`, `detectarFormatoImportacion`): si trae un arreglo `cajas` es el
volcado crudo de siempre; si trae un arreglo `lotes` es este resumen
transcrito nuevo. Mismo flujo de dos pasos (previsualizar → confirmar),
mismo principio de nunca adivinar (revisa conflicto de número de caja,
nunca asigna un producto sin que la persona lo confirme) — la pantalla no
necesitó ningún cambio, ambos formatos devuelven la misma forma de
respuesta.

Diferencias de este camino nuevo, por no tener el peso de cada caja:
- El peso total del lote se reparte entre sus cajas con la misma función
  ya usada en Entrada de cámara (`repartirPesoKg`, sin perder ni un gramo
  por redondeo) y quedan marcadas `pesoEstimado: true`.
- El costo neto por kilo se calcula como `total_neto ÷ kilos_totales` del
  lote.
- A diferencia del importador original (que no crea `LoteCamara`, porque el
  volcado crudo no tenía el concepto de lote y se apoya en la
  reconstrucción automática al iniciar el programa), este camino sí crea el
  `LoteCamara` real y explícito por cada lote del resumen — con sus datos
  reales, no una reconstrucción heurística.
- Si un lote es familia Vacuno, exige que el JSON traiga también su
  procedencia (el resumen no la tenía en este caso porque los lotes reales
  eran Cerdo y Pollo) — se rechaza con un mensaje claro en vez de
  inventarla.

Probado de punta a punta contra el backend real con el archivo real que
mandó el usuario (35 cajas en 8 lotes, Cerdo y Pollo): detecta el formato
solo, agrupa y sugiere producto correctamente (match exacto insensible a
mayúsculas para los que ya existían con el mismo nombre en el catálogo de
prueba), reparte el peso de cada lote exacto (ej. 209,48 kg entre 10 cajas
→ 20,948 kg cada una, suma exacta), calcula el costo neto correctamente, no
crea ningún lote para el grupo que se dejó sin producto elegido a
propósito, y crea el resto (32 cajas, 7 lotes) con `pesoEstimado: true` y
`procedencia: null`.

## Cámara: costo de últimas compras, clave para anular, avisos de stock bajo y cajas estancadas; Caja: Enter salta a Pagos
Cinco ajustes a pedido del usuario, con preguntas antes de tocar código
dado que varias tenían más de una forma razonable de resolverse.

- **Costo de las últimas 2 compras, en Existencias**: la tabla "Cajas
  disponibles por producto" ahora tiene una columna con el costo neto por
  kilo del lote más reciente de ese producto y, si hay una compra anterior,
  el costo de esa entre paréntesis ("antes $X") — para comparar de un
  vistazo si el precio subió o bajó, sin entrar al detalle de cada lote.
  Sale de `LoteCamara.costoNetoKg`, tomando los 2 lotes más recientes por
  producto (`GET /api/camara/existencias`, campo `ultimosCostos`).
- **Clave de supervisor al anular en Cámara**: "Anular entrada" (una caja,
  en Revisar entradas) y "Anular lote" (Existencias) antes solo pedían un
  motivo de texto libre. Ahora usan el mismo `ModalConfirmarClave` que ya
  usa Caja para anular un producto o una venta — piden motivo (de una
  lista rápida + "Otro"), quién autoriza (de una lista de nombres) y la
  clave de supervisor, con el mismo límite de intentos (5 fallidos
  bloquean 1 minuto por IP) ya usado en el resto del sistema
  (`verificarClaveSupervisor`, nuevo helper en `server/routes/camara.ts`
  que reutiliza `verificarClaveConLimite`).
- **Aviso de stock bajo en Cámara: umbral fijo de 2 cajas**: a diferencia
  del umbral de Inventario general (configurable por producto), acá es un
  número fijo para todos los productos, a pedido del usuario — más simple.
  Un producto con menos de 2 cajas disponibles se marca en la tabla de
  Existencias con la misma clase `fila-error` que ya usaba Inventario para
  su propio aviso de stock bajo (reutilizada, no una nueva).
- **Aviso de cajas estancadas (+7 días sin ninguna salida)**: nueva sección
  en Existencias, "⚠ Cajas sin movimiento hace más de una semana" — lista
  las cajas que llevan 7+ días en cámara y **nunca** tuvieron ninguna
  salida (ni parcial) desde que ingresaron, para no dejarlas olvidadas. Si
  una caja ya tuvo una salida parcial hace tiempo pero sigue con saldo, no
  se marca (a pedido del usuario, para no generar ruido con cajas que sí se
  están usando de a poco). Campo `cajasEstancadas` en el mismo endpoint de
  Existencias.
- **Caja: Enter salta directo a Pagos**: a pedido del usuario, para no
  tener que usar la flecha ↓ varias veces después de terminar de escanear
  los productos de una venta. Un Enter "suelto" (sin ningún campo o botón
  con el foco) mueve el foco al primer botón de medio de pago (Efectivo).
  Se ignora si hay un campo/botón enfocado (para no pisar su
  comportamiento normal) y, clave para no chocar con el lector de código
  de barras: el hook `useEscanerCodigoBarras` ya intercepta y detiene el
  Enter que termina un escaneo real (con `stopPropagation()`, antes de que
  llegue a este atajo), así que este atajo nunca se dispara por error en
  medio de un escaneo — solo reacciona a un Enter de teclado genuino.
  Verificado con Playwright contra el servidor real: Enter sin foco mueve
  el foco al botón Efectivo; Enter con un campo de texto enfocado no hace
  nada raro (el campo se queda igual); y un escaneo real simulado (tipeo
  rápido de un código de barras + Enter) sigue agregando el producto al
  carrito con normalidad, sin saltar a Pagos por error.

Probado de punta a punta contra el servidor real: anular una caja/lote sin
clave o con clave incorrecta se rechaza (400/403); con la clave correcta
se anula igual que antes; el endpoint de Existencias devuelve los costos
de las últimas compras y marca correctamente `bajoStock`; una caja
retrasada 8 días a propósito (vía script de prueba, no queda en la base de
datos real) aparece en `cajasEstancadas` y deja de aparecer al revertir la
fecha.

## PLU sugerido automáticamente al crear un producto
A pedido del usuario. Antes había que escribir el PLU a mano cada vez, sin
ninguna ayuda. Ahora, al abrir "Nuevo producto", el campo PLU se rellena
solo con el siguiente número libre (`GET /api/productos/proximo-plu`: el
mayor PLU puramente numérico de todo el catálogo —incluyendo productos
inactivos, porque el PLU es único a nivel de toda la base de datos— más
1). **Sigue siendo editable**: el usuario eligió esta opción sobre dejarlo
fijo, para poder escribir un código específico si el producto necesita
calzar con uno ya conocido (ej. una lista de precios en papel). Solo aplica
al formulario manual de creación — la importación CSV y las herramientas
del asistente de IA (`proponer_crear_producto`) siguen exigiendo un PLU
explícito, sin inventar ninguno.

## Identidad visual: el sistema ya no se ve "plano"
A pedido del usuario ("¿se puede hacer algo para que el sistema no se vea
tan plano?"). Antes de tocar código se armó una muestra aparte (Artifact,
fuera del repo) con Productos y Punto de Venta en un estilo nuevo, para que
el usuario la aprobara — confirmó que le gustaba y pidió aplicarlo "al
resto de las pestañas".

- **Paleta e identidad**: colores nuevos en `web/src/styles.css`
  (`:root`) — vino/rojo cálido de carnicería en vez del rojo plano de
  antes, crema en vez de gris frío, y un color nuevo (`--color-oro`)
  reservado **solo** para cifras de dinero destacadas (Total, Vuelto), para
  que ese acento no se mezcle con nada más. Los títulos (`h1`/`h2`/`h3`) y
  las cifras destacadas usan una serif con carácter (`--fuente-titulos`:
  Georgia/Cambria) — **a propósito no se descargó ninguna fuente de
  internet** (ej. Google Fonts), porque el sistema corre sin depender de
  conexión (ver "Arquitectura y stack" más arriba); Georgia ya viene
  instalada en Windows y Mac. Las tarjetas (`.tarjeta`, `.formulario`)
  ganaron sombra suave y bordes más redondeados en vez de un borde plano de
  1px.
- **Barra de navegación**: pasó de blanca y plana a un degradé vino oscuro,
  con emojis por sección (🥩 Productos, 📦 Inventario, 🧮 Caja, ❄️ Cámara,
  🤖 Asistente, etc., en `web/src/components/Layout.tsx`).
- **Avisos flotantes (toasts)**: nuevo sistema reutilizable
  (`web/src/lib/toast.ts` + `web/src/components/ToastHost.tsx`, montado
  una sola vez en `Layout.tsx` — cualquier pantalla puede llamar
  `mostrarToast(texto, sub, tipo)` sin renderizar nada propio) — antes
  crear/cargar/eliminar productos solo mostraba un texto chico fácil de no
  notar. Conectado por ahora a Productos (crear uno, editar uno, importar
  CSV, categorizar en lote, eliminar en lote) — reutilizable para otras
  pantallas si hace falta más adelante.
- **Categorías rápidas en Productos**: fila de chips con las categorías de
  nivel 1 (incluyendo "Sin categorizar") arriba del filtro de siempre — un
  atajo para no tener que abrir el selector en cascada cuando se quiere ver
  una categoría completa de un vistazo. No reemplaza al selector existente
  (que sigue sirviendo para categorías de nivel 2/3), y no oculta la lista
  de productos por defecto — solo la filtra al hacer clic.
- **Punto de venta**: el "Total" pasó de un badge rojo plano a una tarjeta
  dorada con la cifra en la tipografía de títulos. El aviso de "Vuelto" — 
  antes un `window.alert()` del navegador, sin estilo y sin poder
  personalizarse — ahora es un modal propio (`.modal-vuelto` en
  `styles.css`, estado `vueltoAMostrar` en `PuntoDeVenta.tsx`) con el mismo
  lenguaje visual que el Total pero en verde, con la cifra grande y
  "Entregó $X · venta $Y" debajo.

Probado con Playwright contra el servidor real: los chips de categoría
filtran la tabla correctamente, el PLU sugerido aparece prellenado al
crear, el toast "Producto creado" aparece tras guardar, y una venta en
efectivo con vuelto muestra el modal nuevo con el monto correcto (probado
con un caso real: total $1.500, entregó $10.000 → vuelto $8.500).

## Identidad visual, segunda vuelta: barra lateral, sin emoji en el nombre, toasts en más pantallas
Tres ajustes a pedido del usuario tras probar la primera vuelta:

- **Sin emoji en "La Gran Carnicería"**: se sacó el 🥩 del nombre del
  negocio (`Layout.tsx` y `Login.tsx`) — se mantiene "más limpio", los
  emojis se quedan solo en los ítems de navegación.
- **Barra lateral en vez de barra superior**: `Layout.tsx` pasó de
  `<header className="topbar">` (horizontal, arriba) a
  `<header className="sidebar">` (vertical, a la izquierda) — mismo
  degradé vino, mismos emojis por sección, pero el layout completo
  (`.layout`, antes `flex-direction: column`) ahora es `display: flex` en
  fila, con `.sidebar` de ancho fijo (15.5rem) y `.contenido` ocupando el
  resto. **Detalle importante corregido antes de terminar:** la primera
  versión dejaba que `.sidebar` estirara su alto junto con el contenido
  (comportamiento por defecto de flex, `align-items: stretch`) — en una
  pantalla larga (ej. Productos con muchas filas) el nombre de usuario y
  "Cambiar usuario" quedaban a miles de píxeles hacia abajo, invisibles
  sin scrollear toda la página. Se corrigió con
  `position: sticky; top: 0; height: 100vh; overflow-y: auto;` en
  `.sidebar` — queda fija a la altura de la pantalla sin importar cuánto
  mida el contenido, con su propio scroll interno si hiciera falta.
  Verificado con Playwright: el alto de `.sidebar` da exactamente 900px en
  un viewport de 900px de alto (antes daba más de 8000px en una pantalla
  larga), y "Cambiar usuario" queda visible sin scrollear.
- **Avisos flotantes (toasts) en más pantallas**: además de Productos, ahora
  también en Inventario (`RegistrarEntrada.tsx`, `RegistrarSalida.tsx`,
  `Proveedores.tsx`), Gastos (`Gastos.tsx`, registrar y eliminar) y Cámara
  (`CamaraEntrada.tsx` al ingresar un lote, `CamaraSalida.tsx` al sacar una
  caja, `CamaraEntradas.tsx` al anular una entrada, `CamaraExistencias.tsx`
  al corregir o anular un lote, `CamaraImportar.tsx` al confirmar una
  importación) — mismo `mostrarToast()` reutilizable de siempre, sin
  ningún componente nuevo. Reportes, Categorías y Balanza se dejaron sin
  tocar por ahora (no tienen acciones de crear/cargar/eliminar
  comparables) — extensible después si hace falta.

Probado con Playwright contra el servidor real: el nombre del negocio ya
no tiene emoji, la barra lateral se mantiene fija al alto de la pantalla
al scrollear una tabla larga, y un toast aparece correctamente al
registrar un gasto de prueba (limpiado después de la prueba).

## Cargar facturas a mano (nueva pantalla), y reporte de facturas cargadas
El usuario probó cargar 3 facturas reales pegándole el texto al asistente de
IA y reportó que no funcionaba bien — además pidió, aparte de ese problema
(ver más abajo, "Asistente: se quedaba pegado..."), una forma más clara de
ver las facturas ya registradas (Excel o reporte imprimible) y una pestaña
exclusiva para cargar facturas.

- **Nueva pantalla "Cargar factura"** (`web/src/pages/CargarFactura.tsx`,
  enlazada desde Inventario, ruta `/inventario/factura`): formulario manual
  con proveedor (buscador con lista clickeable), N° de factura, fecha, y
  varias líneas (cada una con su propio buscador de producto, cantidad y
  costo unitario) — pensada como alternativa confiable al asistente de IA
  para cuando este no identifica bien los productos de una factura pegada
  como texto. Nuevo endpoint `POST /api/inventario/entrada-factura`: crea
  una entrada de inventario (motivo "compra") por línea, todas con el mismo
  proveedor y N° de factura, en una sola transacción — a diferencia del
  endpoint de entrada de una sola línea ya existente, acá el costo unitario
  es obligatorio en todas las líneas (es explícitamente una compra con
  factura, no cualquier entrada).
- **Nueva pantalla "Facturas"** (`web/src/pages/Facturas.tsx`, ruta
  `/inventario/facturas`): reporte agrupado por factura (proveedor + N° de
  factura), con filtro por rango de fechas, una fila por factura (fecha,
  proveedor, N° factura, cantidad de líneas, total neto) con "Ver detalle"
  para desplegar sus líneas (PLU, producto, cantidad, costo unitario,
  subtotal), botón **"Exportar a Excel (CSV)"** (genera un CSV con BOM
  UTF-8 en el navegador, sin depender de ninguna librería — Excel lo abre
  directo con los acentos bien) y botón **"Imprimir"** (`window.print()`,
  reutilizando el mismo patrón `.no-imprimir`/`@media print` ya usado para
  el vale y la etiqueta — se agregó una clase nueva `.solo-imprimir` para
  el título del reporte, que solo aparece en la versión impresa). No se
  creó una tabla `Factura` nueva en la base de datos — el endpoint
  `GET /api/inventario/facturas` agrupa en el servidor los
  `MovimientoInventario` ya existentes por `(proveedorId, numeroFactura)`,
  reutilizando el campo `numeroFactura` que ya existía — evita una segunda
  fuente de verdad y una migración nueva para algo que ya se podía derivar
  de los datos existentes.
- La pantalla "Historial" de Inventario (`MovimientosInventario.tsx`), que
  ya tenía un filtro por N° de factura, sigue funcionando igual — muestra
  las mismas líneas una por una, sin cambios; "Facturas" es un reporte
  agrupado aparte, no un reemplazo.

Probado de punta a punta con Playwright contra el servidor real: cargar una
factura de prueba con 2 líneas de proveedor/productos reales, verificar que
aparece agrupada correctamente en "Facturas" con el total exacto, que
"Ver detalle" muestra las líneas con el subtotal correcto, que el CSV
exportado trae el BOM UTF-8 y los datos correctos, que la vista de
impresión oculta la barra lateral y los filtros mostrando solo el reporte,
y que "Historial" sigue mostrando las mismas 2 líneas al filtrar por el N°
de factura de prueba — datos de prueba limpiados después (movimientos
eliminados y stock revertido).

## Asistente: se quedaba pegado repitiendo la primera propuesta (bug corregido)
El usuario reportó, probando cargar una factura real con el asistente:
"Creo solo al proveedor, pero no logra ingresar la factura correctamente.
Identifica los id, se los confirmo pero desde ahí no logra hacer nada.
Solo me confirma que se cargó el proveedor."

**Causa raíz:** la API de Anthropic exige que, si un turno del asistente
incluye una herramienta usada (`tool_use`), el turno siguiente tiene que
traer de vuelta su resultado (`tool_result`) antes de poder seguir la
conversación. Cuando la IA proponía un cambio (ej. "crear proveedor"), el
sistema mostraba la propuesta en pantalla pero **armaba el historial a
mandar de vuelta descartando todo lo que la IA había investigado en ese
turno** (búsquedas de productos, etc.) y **sin dejar ningún registro** de
que esa propuesta se había mostrado ni de si la persona la confirmó o
canceló. Como al confirmar/cancelar el frontend tampoco le avisaba nada a
la IA (solo mostraba un mensaje en pantalla), el siguiente mensaje real
empezaba prácticamente de cero, sin memoria de que el proveedor ya se
había creado — por eso la IA repetía el mismo primer paso ("crear
proveedor") una y otra vez, sin avanzar nunca a las líneas de la factura.

**Arreglado en dos partes** (`server/lib/asistenteIA.ts`,
`server/routes/asistente.ts`, `web/src/api.ts`, `web/src/pages/
Asistente.tsx`):
- El historial ahora se preserva completo (incluyendo las búsquedas
  previas de ese turno), y a la propuesta se le agrega un `tool_result`
  provisorio ("Propuesta mostrada a la persona — todavía no confirma ni
  cancela.") para que el historial quede siempre válido de mandar de
  vuelta a la API mientras la persona decide.
- Nuevo endpoint `POST /api/asistente/resolver` (función
  `resolverPropuesta`): apenas la persona confirma o cancela en pantalla,
  el frontend llama a este endpoint para **reemplazar** ese resultado
  provisorio por el resultado real ("La persona confirmó y se aplicó el
  cambio: ..." o "La persona canceló esta propuesta, no se aplicó ningún
  cambio.") — así el próximo mensaje que se le manda a la IA sí tiene
  memoria de qué pasó con la propuesta anterior, y puede seguir avanzando
  (ej. pasar a proponer las líneas de la factura después de confirmado el
  proveedor).

Probado: la lógica de `resolverPropuesta` con un historial sintético
(confirma que reemplaza exactamente el `tool_result` pendiente sin tocar
el resto de los mensajes, y que no rompe nada si el id no existe) y
`npm run typecheck` completo (servidor + web) limpio. **No se pudo probar
contra el modelo real de Anthropic en este entorno** (sin clave de API
configurada, misma limitación ya documentada para pruebas anteriores del
asistente) — pendiente que el usuario confirme con su propia clave que,
tras esta corrección, el asistente ya avanza más allá de crear el
proveedor al cargar una factura real.

## Pantalla "Mejor margen" (para armar combos)
A pedido del usuario, para poder filtrar rápido qué productos convienen más
combinar en una promoción. Antes de programar se confirmó la fórmula de
margen a usar — el usuario explicó cómo fija sus precios en la práctica:
"si compro un producto a 1.000 y lo quiero vender a un 40% más, desde 1.400
ahí aplico el IVA" (costo → + margen deseado → + IVA = precio de venta).
Haciendo el despeje algebraico inverso de esa misma cuenta se llega
exactamente a la fórmula que el sistema ya usaba en la ficha de producto
(`calcularMargen` en `web/src/api.ts`) — **confirma que esa fórmula ya
implementada es la correcta**, dejando resuelta la duda que quedaba
pendiente desde que se dedujo por primera vez (ver "Margen (%) al cambiar
el precio de un producto" más arriba).

- **Nueva pantalla** (`web/src/pages/MejorMargen.tsx`, ruta
  `/productos/margenes`, enlazada con un botón "Mejor margen" en
  Productos): tabla de productos ordenados de mayor a menor margen (%),
  con el mismo selector de categoría en cascada ya usado en el resto del
  sistema y un campo de **margen mínimo (%)** — a pedido del usuario, que
  describió querer ver "desde el 40% para arriba" — para filtrar solo lo
  que está por encima de ese umbral.
- **Solo productos con costo conocido**: los que no tienen ninguna compra
  registrada en Inventario quedan fuera de la lista (no se muestra un
  margen inventado), igual que ya pasaba en la ficha de producto individual
  cuando no hay costo.
- Nuevo endpoint `GET /api/productos/margenes` (`server/routes/
  productos.ts`, registrado antes de `/:id` para no chocar con esa ruta —
  mismo patrón ya usado para `/proximo-plu`): trae los productos activos
  (filtrables por categoría, reutilizando `obtenerIdsCategoriaYDescendientes`)
  junto con el costo de su compra más reciente, calculado con una sola
  consulta a `MovimientoInventario` (en vez de una consulta por producto) —
  el margen (%) en sí se calcula en el frontend con `calcularMargen`, la
  misma función ya usada en la ficha de producto, para no duplicar la
  fórmula en dos lugares.

Probado de punta a punta con Playwright contra el servidor real: con dos
productos de prueba (CHURRASCO DE VACUNO, costo $9.200/precio $14.500 →
32,44%; ARROLLADO DE HUASO, costo $6.500/precio $9.500 → 22,82%), la
pantalla los ordena correctamente de mayor a menor margen, y el filtro de
margen mínimo en 30% deja solo el primero — los números calzan exactos con
el cálculo manual.

## Registrar entrada vs. Cargar factura, y precio de compra/venta al registrar una entrada
El usuario preguntó si "Registrar entrada" (Inventario → "+ Registrar
entrada") y "Cargar factura" (Inventario → "+ Cargar factura") eran lo
mismo. **No lo son — la diferencia es cuántos productos registra a la
vez:**
- **Registrar entrada** (`RegistrarEntrada.tsx`): un producto por vez.
  Sirve tanto para una compra normal como para un **ajuste** (ej. un
  conteo físico que encontró más stock del registrado) — algo que
  "Cargar factura" no maneja, porque esa pantalla es exclusivamente para
  compras con factura real.
- **Cargar factura** (`CargarFactura.tsx`): varias líneas de una vez,
  todas con el mismo proveedor y N° de factura — para cargar una factura
  completa sin repetir el proceso producto por producto. El costo unitario
  es obligatorio en las 4 líneas (a diferencia de "Registrar entrada",
  donde es opcional), porque ahí sí es explícitamente una compra con
  factura.

Las dos terminan generando el mismo tipo de registro por debajo (un
`MovimientoInventario` con motivo "compra" por producto) — se ven juntas
en "Historial" y en el reporte "Facturas" agrupa ambas por igual. Cuál usar
depende de la situación: un producto suelto → "Registrar entrada"; una
factura real con varias líneas → "Cargar factura".

**Precio de compra actual/anterior + cambio rápido de precio de venta, en
"Registrar entrada"**: a pedido del usuario, para poder revisar y ajustar
el precio de venta justo en el momento de registrar mercadería nueva, sin
tener que ir aparte a la ficha del producto. Al elegir un producto en esa
pantalla, ahora aparece una tarjeta con:
- **Precio de compra actual** (la última compra registrada de ese
  producto) y, si hay una anterior, **el anterior** — para comparar de un
  vistazo si el proveedor subió o bajó el costo.
- **Precio de venta actual**, con el margen (%) ya calculado (misma
  fórmula de siempre, `calcularMargen`).
- Un campo + botón **"Cambiar precio de venta"** que aplica el cambio ahí
  mismo (mismo endpoint que usaría una persona desde Productos → editar
  producto, con la misma confirmación y el mismo registro en el historial
  de precios — no es un camino de escritura aparte).

Técnicamente: `GET /api/productos/:id` ahora también trae `penultimoCosto`/
`penultimoCostoFecha` (antes solo el último) — mismo patrón que ya usaba
para el último costo, ahora con `findMany({ take: 2 })` en vez de
`findFirst`.

Probado de punta a punta con Playwright contra el servidor real: al elegir
CHURRASCO DE VACUNO se ve el costo $9.200 y precio $14.500 (margen 32,44%,
sin "anterior" porque solo había una compra); cambiar el precio a $15.500
lo actualiza al toque (margen recalculado a 41,58%); registrar una entrada
nueva a $9.800 y volver a elegir el mismo producto muestra correctamente
"actual: $9.800 · anterior: $9.200" — datos de prueba limpiados después
(movimiento, historial de precio y precio de venta revertidos).

## Costo, precio de venta y margen en la tabla de Productos
A pedido del usuario, para revisar esa información de un vistazo sin abrir
cada producto. La tabla de la pantalla Productos ahora tiene 2 columnas
nuevas: **Costo (último)** y **Margen (%)** (la columna "Precio" se
renombró a "Precio de venta" para que quede claro junto a las otras dos).

- `GET /api/productos` acepta un parámetro opcional `incluirCosto=true`
  que agrega el último costo de compra de cada producto (mismo patrón de
  una sola consulta a `MovimientoInventario` ya usado en "Mejor margen",
  en vez de una consulta por producto) — **opcional a propósito**, para no
  cargarle esta consulta extra a los otros 5 lugares que reusan este mismo
  endpoint solo como buscador (Caja, Cámara, Registrar entrada/salida),
  donde ese dato no hace falta. Nuevo método `api.productos.listarConCosto()`
  en el frontend, usado solo por la pantalla Productos.
- El margen (%) se calcula en el frontend con `calcularMargen` (la misma
  función de siempre) — un producto sin ninguna compra registrada muestra
  "—" en vez de un número inventado, igual que en el resto del sistema.

Probado con Playwright contra el servidor real: buscando "CHURRASCO DE
VACUNO" en Productos, la fila muestra Costo $9.200, Precio de venta
$14.500 y Margen 32,44% — igual que en "Mejor margen" y en la ficha del
producto, confirmando que las tres pantallas usan la misma cuenta.

## Redondeo en pagos en efectivo (Ley N° 21.131, "Ley del Redondeo")
A pedido del usuario: "cuando paguen con efectivo, necesito que se
redondee tanto el total como el vuelto" — desde que se retiraron de
circulación las monedas de $1 y $5, la ley exige redondear a la decena más
cercana lo que se cobra/entrega en efectivo (tarjeta y crédito se siguen
cobrando siempre al peso exacto, no están afectados por esta ley).

- **Nueva función `redondearA10`** (`web/src/api.ts`): `Math.round(monto /
  10) * 10`. En Punto de Venta, al elegir Efectivo, el monto que
  efectivamente se cobra (`montoACobrar`) se redondea con esta función —
  un aviso nuevo ("A cobrar en efectivo (redondeo): $X") se lo deja claro
  al cajero antes de cobrar, y el **vuelto también se calcula sobre ese
  monto ya redondeado**, no sobre el total exacto.
- **El total de la venta NO se toca** (sigue siendo la suma exacta de los
  productos, la misma que usan reportes y márgenes) — solo se redondea lo
  que efectivamente se cobra/entrega en efectivo. Esto puede dejar hasta
  $5 de diferencia entre el total exacto y la suma de los pagos
  registrados — no es un error, es el redondeo legal, así que se tolera
  esa diferencia (constante `TOLERANCIA_REDONDEO_EFECTIVO = 5`) tanto en
  el frontend (el botón "Confirmar venta" ya no exige el pago exacto al
  peso si hay algún pago en efectivo) como en el backend
  (`server/routes/caja.ts`, al confirmar la venta) — pero **solo si la
  venta tiene algún pago en efectivo**; ventas 100% tarjeta/crédito siguen
  exigiendo el monto exacto como siempre, para no debilitar esa validación
  donde no corresponde.
- **Vale (recibo)**: si la suma de los pagos no coincide exactamente con
  el Total (por el redondeo), se agrega una línea nueva "Redondeo (Ley N°
  21.131): +/-$X" — igual que muestran las boletas reales — en vez de
  dejar una diferencia sin explicar.
- **Cierre de caja (X/Z) no necesitó ningún cambio**: el "efectivo
  esperado" ya se calculaba sumando `pago.monto` real (no `venta.total`),
  así que automáticamente refleja el efectivo ya redondeado — cuadra
  exacto contra lo que el cajero realmente cobra y cuenta físicamente.

Probado de punta a punta contra el servidor real: un producto de prueba a
$1.234 → se cobra $1.230 en efectivo (redondeo hacia abajo), entregando
$2.000 el vuelto muestra $770 (sobre el monto redondeado, no sobre el
total exacto), el botón "Confirmar venta" queda habilitado pese a los $4
de diferencia, la venta confirma correctamente, y el vale impreso muestra
"Total: $1.234 / Efectivo: $1.230 / Redondeo: -$4" — datos de prueba
limpiados después.

## Ajustes varios: barra lateral compacta en modo caja, Total más visible, fondo esperado al abrir caja
Tres pedidos del usuario, revisando el sistema en uso real.

- **Barra lateral lo más angosta posible en "modo caja exclusiva"**: la
  clase nueva `.sidebar-compacta` (activa solo cuando el PC tiene ese modo
  prendido, ver "Ajustes tras la primera semana de uso real") reduce el
  ancho a 3.75rem y esconde el texto de cada ítem del menú (queda solo el
  emoji, centrado, con el nombre completo como `title` — visible al pasar
  el mouse) — el nombre del negocio se abrevia a "LGC" y "Cambiar usuario"
  queda como un solo ícono (↩️). Fuera de ese modo, la barra se ve
  exactamente igual que antes.
- **Total en Punto de Venta, más grande y con más contraste**: el dorado
  sobre fondo crema costaba distinguirse a simple vista desde el mesón —
  se cambió a relleno sólido rojo vino (el color primario de la marca) con
  letra blanca, de 1.7rem a 2.3rem.
- **Fondo esperado al abrir caja, con confirmar o editar con
  autorización**: al abrir una caja nueva, el campo "Fondo fijo inicial"
  ahora viene precargado con el `efectivoContado` real de la última caja
  cerrada (lo que debería haber físicamente para empezar el día), con un
  aviso explicando de dónde sale ese número. Si se deja tal cual, se abre
  directo. Si se edita a otro número, hace falta autorización — mismo
  patrón que ya usa el resto de Caja (`ModalConfirmarClave`: motivo de una
  lista rápida + "Otro", quién autoriza, clave de supervisor). Campos
  nuevos en `SesionCaja` (`fondoFijoSugerido`, `motivoAjusteFondo`,
  `usuarioAutorizoFondoId`) — quedan solo cuando el fondo inicial fue
  efectivamente un ajuste, visibles en "Historial de cajas" (columna
  "Ajuste de fondo"). Nuevo endpoint `GET /api/caja/sesiones/fondo-sugerido`
  (el efectivo contado de la sesión cerrada más reciente); la validación
  de la autorización se revalida completa en el servidor (no confía en que
  el frontend haya mostrado o no el modal).

Probado de punta a punta contra el servidor real: cerrar una caja con
$12.345 contados y abrir la siguiente sin tocar el campo abre directo con
ese mismo fondo; cerrar con $20.000 y editar el campo a $15.000 al abrir
exige el modal, y con motivo + autorización + clave correcta la sesión
queda creada con `fondoFijoSugerido: 20000`, `motivoAjusteFondo` y
`usuarioAutorizoFondoId` guardados correctamente — visibles en el
Historial de cajas. Confirmado también que la barra lateral en modo caja
exclusiva mide exactamente 63.75px (3.75rem) de ancho.

## Bug: no se podía reusar el PLU de un producto eliminado, ni encontrarlo
El usuario reportó: quiso crear un producto con PLU 690, el sistema dijo
"ya existe" pero al buscarlo no aparecía en ningún lado. Causa: el PLU es
único a nivel de toda la base de datos, **incluyendo productos ya
eliminados** (a propósito, ver "Eliminar productos rápidamente" más
arriba — el borrado es lógico, `activo: false`, nunca se borra la fila
real) — pero el buscador normal de Productos solo trae productos activos,
así que un PLU "atrapado" por un producto eliminado no tenía ninguna
forma de encontrarse ni liberarse. Confirmado reproduciendo el caso exacto
del usuario en este entorno: quedaba un producto real "NULO" con PLU 690,
del lote de 199 productos importados desde la captura de red de la
balanza (ver "Migración de datos del sistema viejo" más arriba).

**Arreglado con dos cambios:**
- **Casilla "Mostrar eliminados"** en Productos: trae también los
  productos inactivos (`GET /api/productos?incluirInactivos=true`), con
  una columna "Estado" nueva que muestra "Eliminado" + botón "Reactivar"
  (`POST /api/productos/:id/reactivar`) para los que lo son.
- **Mensaje de error más claro** al crear un producto con un PLU ya
  usado: si el producto existente está eliminado, en vez de solo "Ya
  existe un producto con ese PLU" ahora dice qué producto era y cómo
  reactivarlo en vez de crear uno nuevo.

Probado de punta a punta reproduciendo el caso real: crear un producto
con PLU 690 se rechaza con el mensaje nuevo (menciona a "NULO"), activar
"Mostrar eliminados" lo muestra con su columna Estado, "Reactivar" lo
vuelve a poner `activo: true` correctamente (confirmado con la API) — el
producto real de prueba se dejó otra vez como estaba (eliminado) al
terminar, sin alterar el catálogo de prueba existente.

## Cámara: entrada directa de la factura completa, y precio de venta al por mayor
A pedido del papá del usuario, que quería ingresar la factura completa a
cámara de una vez (proveedor, fecha, N° de factura, una sola vez) en vez
de repetir "Entrada de cámara" producto por producto. Antes de programar
se confirmaron 4 puntos con el usuario: **reemplaza** la pantalla actual
(no queda una aparte); cada línea **sigue generando cajas reales con
etiqueta** para imprimir, igual que antes; "Valor venta mayor" es **un
precio nuevo, ajustable**, por producto; y familia/procedencia se siguen
pidiendo igual que hoy.

- **Pantalla "Entrada de cámara" reescrita** (`CamaraEntrada.tsx`, misma
  ruta `/camara/entrada`): primero proveedor + fecha de ingreso + N° de
  factura (una sola vez), después varias **líneas** (una por producto,
  con "+ Agregar línea"), cada una con familia/procedencia/producto/
  cantidad de cajas/kilos/costo neto por kilo — mismos campos que antes,
  repetidos por línea. Al confirmar, cada línea sigue generando su propio
  lote + cajas + etiquetas exactamente igual que antes (nada cambió ahí);
  la pantalla de resultado ahora imprime las etiquetas de **todas** las
  líneas juntas, no solo una.
- **Ficha de referencia por línea**: al elegir el producto, se muestra su
  PLU, el costo de la última compra **en cámara** de ese mismo producto
  (para comparar contra el costo que se está por ingresar), y el precio de
  venta y venta al por mayor actuales — con un mini-formulario para
  **actualizar cualquiera de los dos ahí mismo** sin salir de la pantalla
  (mismo patrón que "Registrar entrada" en Inventario). El precio de venta
  normal sigue pasando por el endpoint de siempre (queda en el historial
  de precios); el precio al por mayor es nuevo, no tiene historial.
- **"Valor venta mayor" — precio nuevo por producto** (`Producto.
  precioMayor`, opcional): a diferencia del precio de venta normal, es
  editable directo (sin pasar por el historial de cambios de precio) desde
  la ficha de producto o desde esta pantalla — solo de referencia, no
  reemplaza el precio que se negocia en cada "Venta por mayor" real de
  Cámara.
- **Factura queda ligada al lote**: `LoteCamara` ahora guarda
  `proveedorId`/`numeroFactura` (y la fecha de ingreso ya no es siempre
  "ahora" — se puede fijar la del documento real) — opcionales, porque los
  lotes ya existentes no la tienen. El endpoint de un solo producto
  (`POST /api/camara/cajas`) se mantiene igual, sin pedir factura, porque
  lo sigue usando el asistente de IA (`proponer_entrada_camara`); el nuevo
  (`POST /api/camara/cajas/factura`) crea todas las líneas de una factura
  en una sola transacción (todo o nada), reutilizando la misma lógica de
  repartir peso y crear cajas.

Probado de punta a punta con Playwright contra el servidor real: cargar
una factura con Distribuidora Los Andes, fecha 10-08-2026, una línea de
CHURRASCO DE VACUNO (Vacuno/Nacional, 2 cajas de 15kg a $9.500/kg) — se
crearon las 2 cajas con la fecha de la factura (no la de hoy), ligadas al
proveedor y N° de factura correctos, con sus etiquetas mostrando los datos
correctos; el precio de venta al por mayor cambiado desde la ficha de
referencia quedó guardado en el producto — datos de prueba limpiados
después.

## Pestaña "Combos" en la barra lateral
A pedido del usuario, para llegar más rápido a la pantalla de mejor margen
(la que ya sirve para armar combos, ver "Pantalla 'Mejor margen'" más
arriba) sin tener que entrar primero a Productos. Nuevo ítem "🧩 Combos" en
la barra lateral, apuntando a la misma ruta `/productos/margenes` — no es
una pantalla nueva, solo un acceso directo.

## Cámara: aclarar los campos de precio nuevo, y mostrar el margen (%)
El usuario preguntó qué eran los dos recuadros chicos junto al botón
"Actualizar precio(s)" en la ficha de referencia de "Entrada de cámara"
(factura) — eran los campos para escribir el precio de venta y el de
venta al por mayor nuevos, pero sin ninguna etiqueta visible se
entendía mal. Se les agregó el texto "Nuevo precio venta" / "Nuevo
precio venta mayor" arriba de cada uno.

También se agregó, justo al lado del precio de venta actual en esa misma
ficha, el **margen (%)** — misma fórmula de siempre (`calcularMargen`),
usando el costo de la última compra **en cámara** de ese producto (no el
de Inventario) como base, ya que en esta pantalla es el costo relevante.
Si el producto no tiene ninguna compra en cámara todavía, no se muestra
ningún margen (en vez de uno inventado), igual que en el resto del
sistema.

Probado con Playwright contra el servidor real: ABASTERO DE CERDO (precio
$4.980, última compra en cámara $7.777/kg) muestra "Margen: -46,19%" —
calza exacto con la fórmula (costo mayor al precio de venta, en este caso
con datos de prueba antiguos).

## Impresora de etiquetas de cámara, ahora configurable (cambio de impresora física)
El usuario cambió la impresora térmica de etiquetas por una Xprinter
XP-420B (la Gainscha anterior era la que nunca lograba imprimir sin
diálogo — ver "Elegir qué impresora usa cada cosa" y "Segunda vuelta"
más arriba) y pidió poder elegirla rápido en Configuración, más
confirmar si se pueden reimprimir etiquetas de una factura ya cargada.

- **Reimprimir ya existía y sigue funcionando igual**: Cámara →
  Existencias → "Ver lotes ingresados" → botón "Reimprimir" en el lote
  correspondiente — vuelve a mostrar las mismas etiquetas (mismos
  números) sin crear ningún registro nuevo. No se vio afectado por la
  reescritura de "Entrada de cámara" a factura completa (los lotes se
  siguen creando igual, solo que ahora con proveedor/N° de factura).
- **Selector de impresora para etiquetas, de vuelta en Configuración**:
  se había sacado antes porque con la Gainscha la impresión sin diálogo
  siempre salía en blanco — pero eso es específico de esa impresora, no
  una limitación general del sistema. Ahora Configuración → Impresoras
  tiene un segundo selector "Etiquetas de cámara" (mismo patrón que
  "Boletas de venta"), y `imprimirEtiquetaCamara()` /
  `imprimirEtiquetasLoteCamara()` (`web/src/lib/imprimir.ts`) intentan
  primero imprimir sin diálogo con esa impresora — si falla (como pasaba
  con la Gainscha), caen de vuelta solas al diálogo normal, igual que ya
  hace la boleta. Con la Xprinter nueva puede que la impresión sin
  diálogo sí funcione; si no, el respaldo automático sigue garantizando
  que la etiqueta salga igual, solo con el clic extra de confirmar el
  diálogo.

Probado con Playwright (simulando estar en la app instalada, con 2
impresoras detectadas): aparecen los dos selectores lado a lado en
Configuración, y elegir la Xprinter para etiquetas queda guardado
correctamente en `localStorage` (`impresoraEtiquetas`).

### Con la Xprinter, imprimía sin diálogo pero descentrada (corregido)
El usuario confirmó que con la Xprinter XP-420B la impresión sin diálogo
sí funciona (a diferencia de la Gainscha) — pero la etiqueta salía
descentrada, invadiendo parte de la etiqueta siguiente.

**Causa:** `webContents.print()` de Electron, en modo silencioso, no
respeta la regla CSS `@page { size: 100mm 50mm; margin: 0 }` — sin
indicarle explícitamente el tamaño de página, usa el tamaño/márgenes por
defecto configurados en el driver de la impresora. Con la Gainscha esto
no se notaba porque esa impresora nunca llegaba a imprimir sin diálogo
(caía siempre al respaldo); con la Xprinter, que sí soporta el modo
silencioso, el descalce se hizo visible.

**Arreglado**: `imprimirEtiquetaCamara()`/`imprimirEtiquetasLoteCamara()`
(`web/src/lib/imprimir.ts`) ahora mandan un `pageSize` explícito de
100×50mm (en micrones, la unidad que pide la API de Electron) al pedir la
impresión sin diálogo, y `electron/main.js` lo reenvía a
`webContents.print()` junto con `margins: { marginType: "none" }` —
forzando el mismo tamaño exacto y sin margen que ya usa el diálogo normal.
Es un parámetro nuevo y opcional en el canal `imprimir-silencioso`; la
boleta no lo manda, así que sigue imprimiendo exactamente igual que antes
(sin este cambio no se hubiera notado ahí porque su alto es "auto", no un
tamaño fijo).

Verificado con `node --check` que `electron/main.js` sigue siendo válido
(es JavaScript plano, no pasa por el build de TypeScript) y con
`npm run typecheck` limpio. **No se pudo probar contra una Xprinter física
en este entorno** — pendiente que el usuario confirme que ahora la
etiqueta sale centrada y ya no invade la siguiente.

## Tres arreglos en Cámara: fecha de factura, factura duplicada y Reimprimir en blanco
El usuario reportó tres problemas de golpe, probando "Entrada de cámara"
con datos reales: cargó una factura con fecha de hoy pero quedó registrada
con la fecha de ayer (21-08), le costó notar que la había cargado dos veces
sin querer (misma factura, tras corregir un problema con la impresora), y
"Reimprimir" en Existencias abría una pantalla en blanco.

### Fecha registrada un día antes (bug real, confirmado y corregido)
Causa: `new Date("2026-08-22")` (el formato que manda un `<input
type="date">`) se interpreta como **medianoche UTC**, no medianoche de
Chile — al mostrarla de vuelta convertida a la hora de Chile (UTC-4/UTC-3),
cae en el día anterior. Confirmado reproduciendo el caso exacto:
`TZ="America/Santiago" node -e "console.log(new
Date('2026-08-22').toLocaleDateString('es-CL'))"` → `"21-08-2026"`.

El sistema ya tenía la forma correcta de resolver esto para **rangos** de
fecha (los filtros "Desde"/"Hasta" de Reportes, que arman la fecha con
`new Date(año, mes-1, día, horas...)` en vez de parsear el texto ISO), pero
esa misma técnica no se había aplicado a los campos que guardan **una sola**
fecha elegida a mano — "fecha de la factura" en Cargar factura (Inventario)
y en Entrada de cámara. **Arreglado** exportando una función nueva,
`parsearFechaSoloDia` (`server/routes/reportes.ts`, reutiliza la misma
lógica ya correcta), aplicada en los tres lugares que parseaban una fecha
suelta escrita a mano: `server/routes/camara.ts` (fecha de la factura de
cámara), `server/routes/inventario.ts` (fecha de "Cargar factura"), y
`server/routes/gastos.ts` (por si en el futuro se agrega un campo de fecha
al registrar un gasto — hoy ese formulario no lo pide, así que es un
arreglo preventivo). Verificado con `TZ="America/Santiago"` que
`parsearFechaSoloDia('2026-08-22')` ahora sí muestra "22-08-2026" — el
arreglo depende de que el programa corra con la hora de Chile configurada
en el PC (como ya pasa siempre, ver "Arquitectura y stack": todo corre
local, en el equipo del local).

### Alerta de factura duplicada (mismo proveedor + N° de factura)
Nueva revisión en "Entrada de cámara": apenas se elige el proveedor y se
sale del campo N° de factura (evento `onBlur`, sin esperar a intentar
guardar), el sistema consulta si ya existe una factura cargada con ese
mismo proveedor y número (comparación insensible a mayúsculas y espacios,
para no dejar pasar "F-1234" vs "f-1234 " como si fueran distintas) — si la
hay, aparece una tarjeta de aviso (ámbar, no bloqueante por sí sola)
listando el o los lotes ya cargados con esa factura (producto, cantidad de
cajas, kilos, fecha). El botón "Registrar factura" queda bloqueado con un
mensaje explicando que hay que revisar el aviso, hasta que la persona
aprieta "Sí, es una factura distinta — continuar de todas formas" (para el
caso real de dos facturas legítimas con el mismo número, ej. de
proveedores distintos con numeración parecida, o un reintento a propósito).
Nuevo endpoint de solo lectura `GET /api/camara/cajas/factura/verificar-
duplicado` para esta revisión temprana; el guardado (`POST /api/camara/
cajas/factura`) también revisa por su cuenta (no confía en que el frontend
ya haya avisado) y rechaza con 409 si no viene `confirmarDuplicado: true`
en el cuerpo — mismo patrón de "el servidor vuelve a validar todo" ya usado
en el resto del sistema.

### "Reimprimir" en blanco (bug real, confirmado y corregido)
Causa: `GET /api/camara/lotes/:id` (usado por el botón "Reimprimir" de
Existencias) traía las cajas del lote (`cajas: { orderBy: { id: "asc" } }`)
sin anidar también su producto (`include: { producto: true }`) — la
pantalla intenta leer `caja.producto.descripcion` para armar cada etiqueta,
y como `producto` venía `undefined`, React tiraba un error sin atrapar que
descolgaba toda la pantalla (efecto visual: se ve completamente en blanco,
sin ningún aviso de error). **Arreglado** agregando `include: { producto:
true }` dentro de esa relación anidada.

Probado de punta a punta con Playwright contra el servidor real: cargar una
factura nueva no muestra ningún aviso de duplicado; recargar la misma
pantalla con el mismo proveedor + N° de factura sí lo muestra, con el
detalle correcto del lote ya cargado; intentar guardar sin confirmar el
aviso lo rechaza con el mensaje explicando qué hacer; confirmando y
reenviando sí guarda una segunda factura con el mismo número; y "Reimprimir"
sobre un lote real ahora muestra la etiqueta completa (código de barras,
producto, peso) en vez de una pantalla en blanco — datos de prueba
limpiados después.

## Caja: contador de ítems, "Ir a pagar" con ventana emergente, y cambio rápido de precio con autorización
A pedido del usuario, para facilitar la navegación de Punto de venta. Antes
de tocar código se mostró una maqueta interactiva (Artifact, fuera del
repo) con los tres cambios juntos para que el usuario la probara y diera el
visto bueno — pidió un ajuste (navegación con flechas/Enter dentro de la
ventana de pago) antes de aprobarla.

- **Contador de ítems escaneados**: junto al título "Carrito"
  (`.encabezado-carrito`/`.contador-items` en `styles.css`), muestra
  cuántas líneas de producto distintas hay en el carrito (`itemsActivos.
  length`, ya excluye las anuladas — no es la suma de cantidades/kilos).
- **"Ir a pagar"**: la tarjeta "Pagos" ya no muestra los tres botones de
  medio de pago siempre visibles — ahora es un resumen compacto (falta
  pagar / pagos cubren el total, lista mini de pagos ya agregados) más un
  botón único "Ir a pagar". Al apretarlo (o **Enter** sin nada más
  enfocado — mismo atajo de antes, que saltaba directo a Pagos) se abre
  una ventana emergente (mismo estilo que el aviso de Vuelto) con los
  medios de pago, el monto y la tabla de pagos — se pueden seguir
  agregando pagos (ej. mitad efectivo, mitad tarjeta) sin cerrarla, y
  "Listo" la cierra cuando se termina. **Dentro de la ventana, las flechas
  ←/→ y Enter siguen funcionando exactamente igual que antes** (mecanismo
  ya existente, `mediosPagoRef` + el mismo listener de flechas — no
  necesitó cambios): las flechas recorren Efectivo/Tarjeta/Crédito
  devolviendo el foco al botón para poder encadenar más flechas, y Enter
  sobre el botón enfocado lo "aprieta" (comportamiento nativo del
  navegador) — para Tarjeta/Crédito eso autocompleta el monto y mueve el
  foco ahí, así un segundo Enter ya manda el pago.
- **Cambio rápido de precio en el carrito, con autorización**: un lápiz
  ✏️ junto al precio de cada producto en el carrito (`.boton-lapiz`,
  visible solo en ítems no anulados) abre un campo para escribir el precio
  nuevo. Al apretar "Guardar" se abre el mismo `ModalConfirmarClave` que ya
  usa el resto de Caja (motivo de una lista rápida + "Otro", quién
  autoriza, clave de supervisor) — a diferencia de cambiar el precio desde
  Productos o desde Entrada de cámara (que no piden nada), este camino SÍ
  exige autorización porque es un cambio hecho al vuelo con el cliente
  esperando. Al confirmar, cambia el precio **real del producto en el
  catálogo** (mismo endpoint `POST /api/precios/individual` que usa
  Productos → editar, no un camino de escritura aparte) — queda para todas
  las ventas futuras, no solo la actual; el precio ya cobrado en la línea
  de esta venta (`item.precioUnitario`) no se toca retroactivamente, mismo
  principio que ya regía en el resto del sistema.
  **Técnico:** `/api/precios/individual` ahora acepta `clave` y
  `motivoAutorizacion`, ambos opcionales — si `clave` viene, el servidor la
  verifica contra `ClaveSupervisor` (mismo `verificarClaveConLimite` con
  bloqueo tras 5 intentos fallidos ya usado en el resto del sistema) antes
  de aplicar el cambio, y antes de rechazar guarda `motivoAutorizacion` y
  usa `tipoCambio: "individual_caja"` en vez de `"individual"` — así
  "Historial de cambios de precio" (`Historial.tsx`) puede distinguir estos
  cambios de los hechos desde Productos (columna "Tipo": "Individual (desde
  Caja)", con el motivo como `title` al pasar el mouse). Los otros
  llamadores (Productos, Entrada de cámara) nunca mandan `clave`, así que
  siguen sin pedir autorización, exactamente igual que antes. Nueva
  migración `motivo_autorizacion_precio` (columna nullable, no afecta datos
  existentes).

Probado de punta a punta con Playwright contra el servidor real: el
contador de ítems sube correctamente al agregar productos distintos; Enter
sin foco abre la ventana de pago con el foco ya en el medio activo; las
flechas ←/→ cambian el medio de pago correctamente (reutilizando el
mecanismo existente sin tocarlo) y Enter lo selecciona; agregar un pago con
vuelto muestra el aviso de Vuelto correctamente apilado sobre la ventana de
pago (hay que cerrarlo antes de seguir); cambiar el precio con clave
incorrecta lo rechaza sin cerrar el modal; con la clave correcta el precio
del producto queda actualizado, el historial registra `tipoCambio:
"individual_caja"`, el motivo elegido y quién autorizó — datos de prueba
revertidos después. (Nota aparte, de la propia prueba: se corrigió de paso
un problema de especificidad CSS — `.boton-lapiz` quedaba agrandado por la
regla general `.punto-de-venta button`, ahora resuelto con
`.carrito-scroll .boton-lapiz`, mismo patrón ya usado para los otros
botones chicos del carrito.)

## Margen visible sin compra previa, destacado; anular/editar ventas por mayor; alertas como Pop Up
Cuatro pedidos del usuario de una vez, tras usar el sistema unos días.

### Margen visible al cargar una factura, aunque no haya compra previa registrada
El usuario notó que, al ingresar una factura, no aparecía el margen (%) —
antes dependía de que el producto ya tuviera una compra anterior
registrada, algo que no existe todavía para un producto nuevo o la primera
vez que se le compra. **Arreglado**: el margen ahora se calcula con el
costo que se está escribiendo **en ese mismo momento** en la línea de la
factura (no hace falta ninguna compra previa) — si además ya existe una
compra anterior real (en Inventario o en cámara, según la pantalla), esa
sigue siendo la que se usa preferentemente (más confiable que una cifra
recién tipeada); si no existe, se usa el costo recién escrito como
estimación en vivo, aclarando en texto chico cuál de los dos casos es.
Aplicado en **Cargar factura** (Inventario, no mostraba margen en
absoluto — se agregó una columna nueva a la tabla) y **Entrada de cámara**
(ya lo mostraba, pero solo con compra previa en cámara).

### Margen destacado visualmente (recuadro con color)
A pedido del usuario ("que el margen lo destacaras más"). Nueva clase
reutilizable `.margen-destacado` (`styles.css`) — un recuadro con borde y
fondo de color, verde si el margen es positivo o rojo si es negativo
(mismos tokens `--color-exito`/`--color-error` que ya usa el resto del
sistema), en vez de texto plano perdido entre el resto de los datos.
Aplicado donde el margen aparece como una cifra individual destacando una
decisión (Cargar factura, Entrada de cámara, ficha de producto al cambiar
precio, Registrar entrada de mercadería). En las tablas densas (Productos,
Mejor margen/Combos) se optó por algo más sutil — el número en verde/rojo
sin recuadro — para no saturar visualmente una tabla con muchas filas.

### Anular y editar ventas al por mayor (Cámara → Ventas por mayor)
El usuario pidió poder corregir una venta por mayor ya registrada, sobre
todo mientras sigue pendiente de pago.
- **Editar** (`PUT /api/camara/mayoristas/:id`): cliente, precio total y
  observaciones — campos que no afectan el stock de cámara, así que no
  piden autorización. El peso (`cantidadKg`) **no** es editable, porque ya
  movió el saldo de una caja real — si el peso estuvo mal, la corrección
  es anular y volver a registrar la salida correcta.
- **Anular** (`POST /api/camara/mayoristas/:id/anular`): mismo principio
  que "Anular una entrada" de cámara — solo funciona si la caja de origen
  no tuvo **ningún movimiento después** de esta venta (si ya se le sacó
  algo más, deshacer el saldo acá dejaría el número mal; en ese caso hay
  que corregirlo a mano). Devuelve el peso exacto a la caja, la deja en
  `en_camara` o `parcial` según corresponda, y pide autorización completa
  (motivo + quién autoriza + clave de supervisor, mismo `ModalConfirmarClave`
  de siempre) porque deshace una venta real. Campos nuevos en
  `SalidaMayorista` (`anulada`, `usuarioAnulacionId`, `motivoAnulacion`,
  `fechaAnulacion`) — una vez anulada, la fila queda visible en la tabla
  (fila roja, "Anulada" en vez de Pagado/Pendiente, con quién y por qué)
  en vez de desaparecer, y no se puede volver a editar ni anular.
  Probado de punta a punta contra el backend real: editar cambia los datos
  correctamente; anular con clave incorrecta rechaza (403) sin tocar nada;
  anular con clave correcta devuelve exactamente el peso a la caja
  (verificado con el saldo antes/después); anular se rechaza si la caja
  tuvo un movimiento posterior (ej. una merma después de la venta), y
  también se rechaza intentar editar o volver a anular una venta ya
  anulada.

### Todas las alertas de error como ventana Pop Up (como el aviso de Vuelto)
El usuario reportó que, cargando una factura, no encontraba el mensaje de
error hasta volver al inicio de la página — el patrón de siempre
(`{error && <p className="error">{error}</p>}`, un texto arriba de la
pantalla) se perdía fácil en un formulario largo. **Nuevo componente
reutilizable `ModalAlerta`** (`web/src/components/ModalAlerta.tsx`): mismo
lenguaje visual que ya usa el aviso de Vuelto en Punto de venta (ventana
centrada, bloqueante, un botón "Entendido" con foco automático — Enter
también la cierra), pero en rojo para leerse como una alerta. Reemplaza
ese patrón en **las 39 pantallas** que lo usaban (más dos casos con una
variable de error propia además de la principal — `errorActualizar` en
Balanza, `errorImportar` en Productos) — barrido mecánico, mismo cambio en
cada archivo: se agrega el import y se reemplaza esa línea exacta por
`<ModalAlerta mensaje={error} onCerrar={() => setError(null)} />`, sin
tocar la lógica de validación de cada pantalla (los `setError(...)` que ya
existían siguen exactamente igual).

**Lo que se dejó tal cual, a propósito** (no es el mismo problema que
reportó el usuario): avisos informativos dentro de un resultado ya visible
en pantalla (ej. "cajas omitidas por conflicto" en Importar cámara,
"faltantes" en el cierre de un conteo) — el usuario ya está mirando esa
sección cuando aparecen, no se pierden; el aviso FIFO en Salida de cámara,
que es **a propósito no bloqueante** (se puede seguir igual) — convertirlo
en un popup que hay que cerrar contradiría esa idea; y los indicadores de
"Falta pagar"/"Los pagos superan el total" en Punto de venta, que están
en el mismo lugar donde el cajero ya está mirando (la ventana de pago), no
arriba de una pantalla larga.

Probado con Playwright contra el servidor real: en Cargar factura, dejar
la cantidad de una línea sin completar y enviar el formulario muestra el
popup con el mensaje exacto ("Falta la cantidad de..."), Enter lo cierra
(mismo foco automático que Vuelto); confirmado que el resto de las
pantallas sigue compilando y renderizando sin errores (`npm run
typecheck` limpio en las 41 pantallas tocadas).

## App instalable en el celular para "Salida de cámara" + escaneo con la cámara
El usuario preguntó si era posible tener "una especie de app" en el celular
para escanear la caja que sale de cámara y elegir su destino. Antes de
programar se le explicó que el flujo en sí **ya existía** ("Salida de
cámara", accesible desde el navegador del celular por la red WiFI local,
con modo sin conexión propio) — lo que realmente faltaba, según sus
respuestas, era (1) un ícono en la pantalla de inicio en vez de escribir la
dirección cada vez, y (2) usar la cámara del celular para leer el código de
barras en vez de solo poder escribirlo a mano.

- **Ícono instalable (PWA)**: `web/public/manifest.webmanifest` (nombre,
  colores, íconos) + `web/public/sw.js` (service worker mínimo — solo lo
  necesario para que el navegador ofrezca "Agregar a pantalla de inicio"
  como app; nunca cachea `/api/*`, que sigue yendo directo a la red igual
  que siempre) + enlaces nuevos en `web/index.html`. **Confirmado con el
  usuario:** el ícono instalado abre **directo en "Salida de cámara"**
  (`start_url` del manifest), sin el menú de todo el sistema — mismo
  concepto que "modo caja exclusiva" (`modoCaja.ts`), aplicado acá como
  "modo cámara" (`web/src/lib/modoCamara.ts`), pero detectado solo (sin
  ningún interruptor manual): el navegador expone `display-mode:
  standalone` cuando se abre desde el ícono instalado, a diferencia de una
  pestaña normal. `Layout.tsx` muestra una tira superior angosta en vez de
  la barra lateral cuando ese modo está activo. **De paso, corregido**: el
  login navegaba siempre a `/productos` sin importar el modo (bug que ya
  afectaba a "modo caja exclusiva" también) — ahora respeta el modo activo
  al elegir usuario.
  **Limitación real, explicada al usuario:** los service workers (y por lo
  tanto la instalación completa como app) exigen una conexión seguro
  (HTTPS) o `localhost` — este sistema corre por WiFi local en HTTP plano
  (`http://192.168.x.x:5175`), así que el comportamiento exacto de
  "Agregar a pantalla de inicio" puede variar según el celular/navegador
  (funciona sin problema en iPhone; en Android puede quedar como un simple
  acceso directo en vez de una instalación completa, según la versión de
  Chrome). **Pendiente que el usuario lo pruebe en sus celulares reales.**
- **Escanear con la cámara**: nuevo componente reutilizable
  `web/src/components/EscanerCamara.tsx`, usando `@zxing/browser` (librería
  gratuita y de código abierto, queda incluida en el programa — no depende
  de internet en tiempo de ejecución), restringido a Code128 (el formato
  que ya usan las etiquetas de cámara). Se agregó un botón "📷 Escanear con
  la cámara" en "Salida de cámara", junto al ingreso manual que ya
  existía — al detectar un código, llama exactamente a la misma función
  `buscarCaja()` que ya usan el lector físico y el ingreso manual, sin
  duplicar lógica. Cargado con `React.lazy()` (solo en esa pantalla) para
  no sumarle el peso de la librería (~480kb) a la carga inicial del resto
  del sistema.

Probado con Playwright usando una cámara falsa de Chromium
(`--use-fake-device-for-media-stream`): "modo cámara" se activa
correctamente simulando `display-mode: standalone` (barra lateral
ausente, tira superior angosta, arranca en Salida de cámara tras elegir
usuario); el botón de escanear abre la cámara, pide permiso y el lector
queda decodificando cuadros en vivo de forma continua (confirmado por los
intentos de decodificación reales en la consola); cerrar el escáner libera
la cámara sin errores. **No se pudo probar la detección real de un código
de barras** en este entorno (haría falta un video de prueba con un código
Code128 real) — la librería es ampliamente usada y se llamó exactamente
según su API documentada. **Pendiente la prueba real** con la etiqueta
física y el celular del usuario.

## Existencias: kilos y valor estimado por producto (no solo cajas)
A pedido del usuario: la tabla "Cajas disponibles por producto" (Cámara →
Existencias) solo mostraba cantidad de cajas — pidió agregar kilos y total
estimado en dinero por producto también. Antes de programar se confirmó
que "total estimado en dinero" debía mostrar **los dos** valores posibles
(no estaba claro cuál quería): cuánto vale la mercadería guardada (costo de
compra) y cuánto se sacaría si se vendiera toda (precio de venta) — números
distintos y ambos útiles.

- **Nuevas columnas "Kilos", "Valor (costo)" y "Valor (venta)"** en la
  tabla, con su propio subtotal por familia (mismo patrón que ya tenía la
  columna de cajas). "Valor (costo)" es `kilos × costo neto de cada caja`
  (mismo cálculo que ya usaba "Valor neto" del resumen de arriba); "Valor
  (venta)" es `kilos × precio de venta actual del producto` — un ingreso
  potencial, no lo que ya se pagó.
- El resumen de arriba (Cajas/Kilos/Valor neto) ganó una cuarta cifra,
  **"Valor de venta potencial"**, con la misma fórmula pero sumando todas
  las cajas de cámara — para que el mismo tipo de comparación (costo vs.
  venta) esté disponible tanto en el total general como por producto.
- **Técnico:** `GET /api/camara/existencias` ahora también agrupa
  `kilos`/`valorCosto`/`valorVenta` por producto (antes solo contaba
  cajas) y devuelve `totalValorVenta` a nivel general — un producto puede
  tener cajas de distintos costos de compra (lotes distintos), así que el
  costo se calcula caja por caja (`saldoKg × costoNetoKg` de cada una,
  igual que ya hacía el total general), no con un costo único por
  producto.

Probado de punta a punta contra el servidor real: 2 cajas de prueba de 25kg
cada una a $8.000/kg (producto con precio de venta $13.980/kg) — la fila
del producto en Existencias mostró exactamente 50,000 kg, $400.000 de
costo y $699.000 de valor de venta, calzando con el cálculo manual; los
subtotales por familia sumaron correctamente los productos de esa
familia — datos de prueba limpiados después.

## Cámara: fecha de salida, "Reporte de salidas" más visible, filtro de fechas en Existencias, y margen (%) donde faltaba
Cuatro pedidos del usuario de una vez: "Agregar fecha de salida de cámara,
buscar entre fechas a la salida de cámara y existencias actuales. Mostrar
Margen actual en secciones que actualmente no se muestran". Antes de
programar se preguntó dónde debía ir la fecha de salida, si "buscar entre
fechas" era algo nuevo o ya existía, cómo debía filtrar por fecha
Existencias (una foto histórica reconstruida, o filtrar por fecha de
ingreso de las cajas actuales), y en qué pantallas faltaba mostrar el
margen — las respuestas revelaron que dos de los cuatro pedidos ya estaban
resueltos por funcionalidad existente con un problema real de
"visibilidad", no de funcionalidad faltante.

- **Columna "Salida" en "Revisar entradas"**: a pedido del usuario ("En
  'Revisar entradas' (Recomendado)"), la tabla de esa pantalla ahora
  muestra, junto a la fecha de ingreso, la fecha en que cada caja salió
  completa de cámara (si ya salió) — `GET /api/camara/cajas` calcula esta
  fecha buscando el `MovimientoCamara` tipo `"salida_completa"` más
  reciente de cada caja con estado `"salida"`, sin necesitar ningún campo
  nuevo en la base de datos (se deriva de datos que ya existían).
- **"Reporte de salidas" ya existía con búsqueda por fechas — el problema
  era que "mi papá no lo encontró"** entre 9 botones iguales sin ninguna
  pista de qué hacía cada uno (`Camara.tsx`, antes una sola fila plana de
  enlaces). Rediseñado como una grilla de tarjetas (`.grilla-camara`,
  nueva en `styles.css`) agrupadas en dos secciones — "Registrar un
  movimiento" (Entrada, Salida, Inventario por escaneo) y "Buscar y
  revisar" (Reporte de salidas, Revisar entradas, Existencias, Ventas por
  mayor, Ajustes pendientes, Importar) — cada una con una descripción
  corta de una línea explicando qué muestra. De paso, "Salida de cámara"
  ahora tiene un enlace directo a "Reporte de salidas" en su propio
  encabezado, para llegar sin volver al menú de Cámara.
- **Filtro de fechas en Existencias, por fecha de ingreso**: a pedido del
  usuario ("Filtrar por fecha de ingreso de las cajas" — no una foto
  histórica reconstruida, que hubiera sido mucho más complejo y no es lo
  que pidió). `GET /api/camara/existencias` acepta `desde`/`hasta`
  opcionales (mismo `rangoFechasDesdeTexto` de siempre) y filtra las cajas
  activas por `fechaIngreso` antes de agruparlas — sin filtro se sigue
  viendo todo lo que hay guardado ahora mismo (comportamiento anterior
  intacto), el filtro es un acotamiento opcional, con un botón "Quitar
  filtro" para volver a la vista completa.
- **Margen (%) en las tres pantallas que el usuario eligió** (preguntó
  cuáles, dio las tres: Carrito de Punto de venta, Existencias de Cámara,
  Ventas por mayor):
  - **Existencias**: nueva columna "Margen (%)" en "Cajas disponibles por
    producto" (y su subtotal por familia), calculada con
    `calcularMargen(valorVenta, valorCosto)` de cada fila — como ambos ya
    son kilos × precio/costo por kg, los kilos se cancelan al dividir, así
    que da el mismo resultado que calcularlo por kilo sin tener que
    despejarlo aparte. Texto en verde/rojo sin recuadro, mismo criterio ya
    usado en las tablas densas de Productos y Mejor margen/Combos (el
    recuadro `.margen-destacado` se reserva para una cifra individual
    destacada, no para una columna de tabla).
  - **Ventas por mayor**: nueva columna "Margen (%)", usando el costo neto
    por kilo de la **caja de cámara de origen** de esa venta
    (`cajaCamara.costoNetoKg`, agregado a los 6 `include` de
    `SalidaMayorista` en `server/routes/camara.ts`) contra el precio
    pactado (`precioTotal ÷ cantidadKg`) — más preciso que un costo
    genérico del producto, porque usa el costo real del lote que
    efectivamente se vendió. Si la venta no quedó ligada a una caja
    (`cajaCamaraId` nulo, ej. datos migrados), muestra "—" en vez de un
    número inventado.
  - **Carrito de Punto de venta**: bajo el precio de cada línea (no una
    columna nueva, a propósito — el carrito ya se había simplificado antes
    para no volver a necesitar scroll horizontal, ver "Ajustes tras la
    primera semana de uso real"), una anotación chica "Margen: X%" en
    verde/rojo, calculada con el último costo de compra del producto
    (`Producto.ultimoCosto`, de Inventario) contra el precio que se está
    cobrando en esa línea. Se pide el costo de cada producto nuevo que
    aparece en el carrito (`GET /api/productos/:id`, que ya lo devuelve) y
    se cachea en memoria para no volver a pedirlo — si el producto no
    tiene ninguna compra de Inventario registrada (ej. solo tiene costo de
    Cámara, un dato distinto), no se muestra nada en vez de un número
    inventado.

Probado de punta a punta contra el servidor real: crear una caja de prueba
y confirmar que el filtro de fechas de Existencias la incluye/excluye
correctamente según el rango elegido (fuera de un rango que no incluye hoy
desaparece de los totales, dentro de un rango que sí lo incluye aparece con
sus kilos exactos); con Playwright, la columna Margen de Existencias
mostró 4,62% para un producto de prueba (calzando con el cálculo manual:
costo $16.000, venta $19.920 → margen exacto), Ventas por mayor mostró
17,65%/-6,63% para ventas de prueba reales y "—" para una sin caja de
origen ligada, y el carrito de Punto de venta mostró "Margen: 32,4%" para
CHURRASCO DE VACUNO (costo $9.200, precio $14.500 — el mismo caso ya
verificado en la ficha de producto y en Mejor margen) sin mostrar nada para
un producto sin costo de Inventario registrado — datos y ventas de prueba
limpiados después.

## Sacado el margen del carrito de Punto de venta, y dos bugs corregidos en "Ir a pagar"
A pedido del usuario: el margen (%) agregado al carrito en el cambio
anterior se sacó — "nos dimos cuenta que no es necesario que vaya allí".
Se mantiene en Existencias de Cámara y Ventas por mayor, que sí lo pidió
mantener. Además, dos bugs reales reportados probando la Caja:

- **Enter en Efectivo no hacía nada**: al abrir "Ir a pagar", el foco
  arranca en el botón del medio de pago activo (Efectivo, el que viene
  por defecto) — Tarjeta y Crédito ya movían el foco al campo
  correspondiente apenas se elegían (con clic o con Enter sobre el botón),
  pero Efectivo no tenía ese mismo `onClick` con el cambio de foco, así
  que apretar Enter sobre "Efectivo" ya activo no hacía nada visible y
  había que hacer clic a mano en el campo "Efectivo recibido". Corregido
  agregándole el mismo cambio de foco que ya tenían los otros dos
  (sin autocompletar ningún monto — a diferencia de Tarjeta/Crédito, acá
  el cajero sigue escribiendo a mano lo que el cliente entrega).
- **La venta no se confirmaba sola después de pagar**: registrar un pago
  que ya cubre el total (el caso normal: un solo pago en efectivo, con o
  sin vuelto) dejaba la venta "abierta" — había que cerrar la ventana de
  "Ir a pagar" y apretar "Confirmar venta" aparte (con su propio cuadro de
  confirmación del navegador), un paso extra e innecesario ya que agregar
  un pago que cubre el total ya deja claro que la venta terminó. Corregido
  en `PuntoDeVenta.tsx`: `agregarPago` ahora revisa, con los datos recién
  llegados del servidor, si los pagos ya cubren el total completo — de ser
  así, confirma la venta sola (misma lógica que ya usaba el botón manual,
  extraída a una función compartida `ejecutarConfirmarVenta`, pero sin el
  cuadro de confirmación del navegador, innecesario en este camino
  automático) y cierra la ventana de "Ir a pagar". Si hubo vuelto, el
  aviso emergente se sigue mostrando igual — pero para cuando el cajero lo
  cierra con "Entendido", la venta ya está confirmada, el vale ya se mandó
  a imprimir solo y el carrito ya quedó vacío, listo para el siguiente
  cliente, sin ningún clic extra.

Probado de punta a punta con Playwright contra el servidor real: abrir "Ir
a pagar" y presionar Enter sobre Efectivo mueve el foco al campo "Efectivo
recibido"; escribir un monto mayor al total y confirmar el pago con Enter
agrega el pago, muestra el vuelto correcto, y confirma la venta sola (se ve
"Venta #N confirmada" de fondo mientras el vuelto sigue en pantalla); cerrar
el aviso de vuelto deja el carrito en $0 y "0 items", sin necesitar tocar
"Confirmar venta"; el mismo flujo con Tarjeta (llegando con las flechas
←/→, que a propósito dejan el foco en el botón para poder seguir
encadenando flechas — documentado más arriba en "Comentario opcional...")
también paga y confirma sola con un segundo Enter, sin vuelto de por medio;
y ya no aparece ningún texto "Margen:" en Punto de venta — datos de prueba
limpiados después.

## Respaldo automático de la base de datos
A pedido del usuario, tras preguntarle qué mejora faltaba considerar en el
sistema: la brecha más grande, dado que ya maneja plata real todos los
días, era que el respaldo seguía siendo copiar el archivo a mano. Antes de
programar se le preguntó dónde debían guardarse los respaldos (en este PC,
en un USB, en otro PC de la red, o varias a la vez) — eligió **este PC +
USB**.

- **Local, siempre activo**: todos los días (chequeo al iniciar el
  programa y después cada una hora, comparando por fecha calendario, no
  "cada 24 horas exactas" — así funciona igual aunque el PC se prenda/
  apague a horas distintas cada día) se copia la base de datos completa a
  una carpeta `respaldos/` al lado del archivo real, con la fecha en el
  nombre (`respaldo-2026-08-27.db`). Se conservan los últimos 30 días de
  cada destino, borrando solos los más viejos — no crece sin límite.
- **USB/disco externo, opcional**: se configura una carpeta destino en
  Configuración → "Respaldo de la base de datos". Si ese USB no está
  conectado el día que toca, **no se trata como error** — no se actualiza
  la fecha del último intento, así se reintenta solo la próxima vez que sí
  esté conectado, sin necesitar ninguna acción manual. Al usar el botón
  "Respaldar ahora" con el USB desconectado, se avisa igual con un mensaje
  puntual en pantalla (no persistido, porque justamente no cuenta como un
  intento real).
- **Botón "Respaldar ahora"**: fuerza un respaldo a ambos destinos aunque
  ya se haya hecho el de hoy — para antes de algo importante, o para
  probar que la carpeta de USB configurada realmente funciona.
- **Selector nativo de carpeta** (`window.electronAPI.elegirCarpeta`,
  nuevo en `electron/main.js`/`preload.js`, mismo patrón que
  `listarImpresoras`) en la app instalada, para no tener que escribir la
  ruta del USB a mano (ej. `E:\Respaldos`); en el navegador (sin Electron)
  se puede escribir la ruta directo, como respaldo del selector. Aclarado
  en pantalla: la carpeta siempre tiene que existir en **el PC principal**
  (el que corre el servidor), no en el equipo desde el que se esté viendo
  la pantalla de Configuración.
- **Técnico**: nueva tabla `ConfiguracionRespaldo` (una sola fila, mismo
  patrón que `ConfiguracionBalanza`) con la ruta del USB y el resultado del
  último intento por destino. `server/lib/respaldos.ts` calcula el archivo
  real de la base de datos a partir de `DATABASE_URL` (mismo criterio que
  usa Prisma para resolver una ruta relativa como `file:./dev.db`, contra
  la carpeta `prisma/`) — necesario porque Prisma no expone esa ruta
  directo. Las fechas se comparan en hora **local**, no UTC (mismo tipo de
  bug ya corregido antes para la fecha de una factura, ver
  `parsearFechaSoloDia` — usar `toISOString()` se corre de día cerca de la
  medianoche en Chile).

Probado de punta a punta contra el servidor real: el respaldo automático
se dispara solo al iniciar (confirmado con un archivo `.db` real, válido,
del mismo tamaño que el original); "Respaldar ahora" respalda a ambos
destinos correctamente; con 35 respaldos de prueba ya en una carpeta, uno
nuevo deja exactamente 30 (los 5 más viejos se borran solos); desconectar
el USB (borrar la carpeta) no rompe el respaldo local y avisa en pantalla
sin quedar guardado como un fallo real; "Quitar" limpia la configuración y
el aviso puntual correctamente — datos y carpetas de prueba limpiados
después.

## Avisos críticos proactivos
A pedido del usuario, tras el respaldo automático (ver arriba). Antes de
programar se preguntó qué situaciones debían avisar y cómo — respuestas:
las cuatro sugeridas (caja de un día anterior sin cerrar, stock bajo,
cajas de cámara estancadas, ajustes pendientes de cámara) y "ambas" formas
de aviso (uno visible en el programa + notificación nativa de Windows).

- **Nueva pantalla "Avisos"** (`web/src/pages/Avisos.tsx`, ruta `/avisos`,
  primer ítem del menú): una tarjeta por cada aviso activo, con el detalle
  y un botón que lleva directo a la pantalla correspondiente para
  resolverlo (Caja, Inventario con el filtro de stock bajo ya marcado,
  Existencias de Cámara, Ajustes pendientes). Si no hay ninguno, muestra
  "Todo al día".
- **Contador en el menú**: el ítem "🔔 Avisos" muestra un número en rojo
  con la cantidad de avisos activos (no aparece si es cero) — se actualiza
  solo cada 5 minutos (`Layout.tsx`), sin tener que entrar a la pantalla.
  No se agregó a "modo caja exclusiva" (el PC del mesón), a propósito,
  para no contradecir esa simplificación ya pedida antes.
- **Notificación nativa de Windows**: usa el `Notification` del navegador
  (Electron la muestra como notificación real del sistema operativo, sin
  necesitar ningún código nuevo de Electron) — como máximo una vez por
  tipo de aviso por día (guardado en `localStorage`, `web/src/lib/
  avisos.ts`), para no repetir la misma notificación cada 5 minutos; si
  sigue sin resolverse al día siguiente, se vuelve a notificar.
- **Backend**: nuevo `server/lib/avisos.ts` (`calcularAvisosCriticos`) y
  `GET /api/avisos` (`server/routes/avisos.ts`). "Caja sin cerrar" compara
  la fecha de apertura contra hoy en hora **local** (reutiliza
  `fechaLocalYMD`, exportada de `server/lib/respaldos.ts` — mismo criterio
  ya usado ahí). Los otros tres reutilizan el mismo criterio ya usado en
  sus pantallas de origen (umbral de stock bajo de Inventario, "7+ días sin
  salida" y "ajuste_pendiente" ya usados en Cámara) sin duplicar sus
  endpoints completos — son chequeos livianos, pensados para consultarse
  seguido.

Probado de punta a punta contra el servidor real: con una caja de prueba
abierta hace varios días, un producto con umbral forzado y ajustes
pendientes reales ya en la base de datos, el endpoint y la pantalla
mostraron los tres avisos correctamente (con el texto en plural bien
escrito); el link "Ver en Inventario" llega con la casilla de stock bajo
ya marcada; con Playwright (interceptando el constructor `Notification`,
ya que el entorno de pruebas no tiene notificaciones reales de Windows) se
confirmó que dispara una notificación por cada aviso activo la primera vez
y que NO se repite al recargar la página el mismo día (queda guardado en
`localStorage`) — datos de prueba revertidos después. **Pendiente**:
confirmación del usuario de que la notificación aparece como un aviso real
de Windows en su PC (en este entorno solo se pudo probar la lógica, no el
aviso del sistema operativo en sí).

## Bug: cerrar caja se bloqueaba por un carrito vacío; Control de precios; IVA de la carne en facturas
Tres pedidos del usuario de una vez. Antes de programar se hicieron varias
preguntas (Control de precios tiene bastante superficie de diseño) — ver
las decisiones abajo.

### Cerrar caja ya no se bloquea por una venta vacía
El usuario reportó: "como la caja queda constantemente abierta para seguir
comprando, al momento de cerrar la caja del día marca una caja 'vacía'
como venta pendiente". Causa encontrada: Punto de Venta deja siempre un
carrito vacío listo para la próxima venta (`iniciarVenta()`, tanto al
entrar a la pantalla como después de cada venta confirmada — ver
"Confirmar una venta se queda en Punto de Venta" más arriba), así que casi
siempre queda una `Venta` en estado "abierta" sin ningún producto. El
endpoint de cerrar caja (`POST /api/caja/sesiones/:id/cerrar`) rechazaba
el cierre apenas encontraba *cualquier* venta "abierta", sin distinguir
ese carrito vacío de una venta real a medias.

**Arreglado en `server/routes/caja.ts`:** si la única venta "abierta" de la
sesión no tiene ningún ítem (ni siquiera uno anulado — ahí sí hubo
actividad real que alguien ya autorizó, y se sigue bloqueando el cierre
como antes), se borra sola al cerrar, sin pedir nada — no hay ningún dato
real que perder. Probado de punta a punta contra el servidor real: crear
un carrito vacío y cerrar la caja ahora funciona (antes rechazaba con
"Hay una venta sin terminar"), confirmando además que la venta vacía
efectivamente desaparece de la base de datos; una venta con un producto
real agregado sigue bloqueando el cierre exactamente igual que antes.

### Nueva pantalla "Control de precios"
A pedido del usuario, para tener de un vistazo la salud general de los
precios del catálogo. Antes de programar se confirmaron con el usuario:
la relación con "Combos" (pantallas separadas pero enlazadas entre sí, no
una reemplaza a la otra), la definición de "precio activo" (producto
activo con precio mayor a $0), dónde va el detalle de cada cambio de
precio (dentro de esta pantalla nueva, no en "Historial"), y cómo
identificar productos de vacuno/cerdo para el IVA de la carne (ver más
abajo).

- **Nueva pantalla** (`web/src/pages/ControlPrecios.tsx`, ruta
  `/productos/control-precios`, ítem "📈 Control de precios" en el menú,
  junto a "Combos"): arriba, un resumen con **cantidad de productos con
  precio activo**, **recargo promedio** y **margen real promedio** más una
  "Guía de rentabilidad" explicando la diferencia (texto pedido tal cual
  por el usuario: "el recargo se calcula sobre el costo; el margen real se
  calcula sobre la venta neta"); una casilla **"Ver todos los productos
  (incluso sin precio activo)"** para ampliar la tabla principal a
  productos con precio $0 o sin costo conocido (ocultos por defecto); y
  una sección aparte, **"Registro de cambios de precio"**, con cada fila
  del historial de precios mostrando costo efectivo, precio de venta,
  margen aplicado y margen real. Un botón "🧩 Ver Combos (Mejor margen)"
  lleva a la pantalla existente de armar combos, que a su vez ahora tiene
  un botón "📈 Ver Control de precios" de vuelta — quedan enlazadas, no
  fusionadas.
- **Dos fórmulas, mismo número base** (`web/src/api.ts`): `calcularMargen`
  (ya existía) es el **recargo** — cuánto se le sumó al costo para llegar
  al precio; se agrega `calcularMargenReal`, una función nueva que divide
  esa misma diferencia (venta neta − costo) sobre la **venta neta** en vez
  de sobre el costo — el "margen real". Verificado con el caso ya conocido
  del sistema (CHURRASCO DE VACUNO, costo $9.200, precio $14.500): recargo
  32,4% (el mismo número ya verificado antes en Mejor margen/Productos) y
  margen real 24,5% (calzando con el cálculo manual:
  (12.184,87−9.200)/12.184,87×100).
- **Los promedios son simples, no ponderados por kilos vendidos** (tal
  como lo pidió el usuario) — se calculan solo sobre productos con precio
  activo Y costo conocido, para no promediar un margen inventado.
- **"Costo efectivo" en el registro de cambios usa el costo más reciente
  de HOY**, no una foto histórica del costo exacto en el momento de cada
  cambio pasado (el sistema no guarda esa foto) — mismo criterio
  simplificado que ya usa el resto de la app para mostrar "margen" en
  cualquier pantalla, aclarado en un texto de ayuda en la propia pantalla
  para que quede claro qué se está mostrando.
- Reutiliza datos ya existentes sin agregar ningún endpoint nuevo:
  `GET /api/productos?incluirCosto=true` (la tabla principal) y
  `GET /api/historial` (el registro de cambios) — todo el cálculo de
  recargo/margen real/promedios se hace en el frontend.

Probado de punta a punta con Playwright contra el servidor real: el
resumen mostró 190 productos con precio activo, 27,6% de recargo promedio
y 21,5% de margen real promedio (calzando con los datos reales de prueba);
la casilla "Ver todos" reveló un producto de prueba con precio $0 que
antes no aparecía (190 → 191 filas); el link a Combos y de vuelta funciona
en ambos sentidos — datos de prueba limpiados después.

### IVA de la carne (5%) en "Cargar factura" y "Entrada de cámara"
El usuario pidió, en ambas pantallas de carga de factura: mostrar además
del total neto (que ya se mostraba) el IVA (19%), el IVA adicional a la
carne (vacuno y cerdo, 5%) y el TOTAL de la factura con todo incluido —
"esto nos permitirá comparar con la factura real y que todos los datos
calcen". Antes de programar se confirmó con el usuario la tasa exacta
(5%) y cómo identificar qué líneas son vacuno/cerdo — como el catálogo
general de Productos no tenía ninguna clasificación confiable para eso
(a diferencia de Cámara, que sí tiene "Familia"), se optó por un **campo
nuevo en la ficha del producto** en vez de adivinar por categoría.

- **Campo nuevo `Producto.aplicaIvaCarne`** (booleano, `false` por
  defecto): casilla "Aplica IVA carne (5%) — para vacuno/cerdo" en
  Productos → editar producto, junto al resto de los datos. Se marca a
  mano una vez por producto — no se deduce de la categoría.
- **En ambas pantallas de factura** (`CargarFactura.tsx` e
  `CamaraEntrada.tsx`), cada línea tiene su propia casilla "IVA carne
  (5%)", **precargada sola** con el valor de `producto.aplicaIvaCarne` al
  elegir el producto, pero **se puede destildar por línea** si ese
  producto puntual no lleva el impuesto esa vez — tal como lo pidió el
  usuario. El resumen de totales pasó de mostrar solo "Total de la
  factura" a mostrar las cuatro cifras: Total neto, IVA (19%), IVA carne
  (5%, solo sobre las líneas marcadas) y **TOTAL factura** — con una nota
  invitando a comparar contra el papel real.
- Es una calculadora en pantalla, igual que ya lo era el total neto — no
  se guarda ningún desglose de impuestos en la base de datos, solo se usa
  para verificar que los números calcen antes de registrar la factura
  (que se sigue guardando igual que antes, por su valor neto).

Probado de punta a punta con Playwright contra el servidor real, en ambas
pantallas: elegir un producto con `aplicaIvaCarne: true` precarga sola la
casilla de esa línea; con 10kg/unidades a $1.000 neto cada una, el
resumen mostró exactamente Total neto $10.000, IVA (19%) $1.900, IVA carne
(5%) $500 y TOTAL factura $12.400 — calzando con el cálculo manual en
ambas pantallas — datos y cambios de prueba revertidos después (ninguna
factura de prueba llegó a guardarse, solo se completó el formulario para
verificar los cálculos en pantalla).

## Costo de referencia manual por producto (para ver el margen sin factura real)
A pedido del usuario: "necesito que agregues una opción de ingresar/
modificar el precio de costo de cada producto. Ya que no tenemos las
facturas de todos, usaremos los datos del sistema anterior para ingresar
el precio de costo (cuando lo compramos) y así poder ver reflejado los
márgenes". Antes de programar se confirmaron dos puntos con el usuario:
dónde editarlo — **"Ambas"** (un campo en la ficha del producto, y también
un importador CSV masivo) — y la prioridad frente a una compra real ya
registrada — **"Solo se usa si no hay ninguna compra real"** (el costo
manual es únicamente un respaldo, nunca pisa un dato real).

- **Campo nuevo `Producto.costoReferencia`** (`Float?`, opcional): costo
  ingresado a mano, pensado para volcar los datos de costo que existen en
  el sistema anterior (Gexus) mientras no se tenga la factura real
  correspondiente cargada en Inventario o Cámara.
- **`costoEfectivo`/`costoEsEstimado`, calculados en el servidor**
  (`calcularCostoEfectivo()`, nuevo helper compartido en
  `server/routes/productos.ts`): `costoEfectivo = ultimoCosto ??
  costoReferencia ?? null` — el costo real de la compra más reciente manda
  siempre que exista; el costo de referencia solo se usa como respaldo
  cuando no hay ninguna compra real. `costoEsEstimado` avisa cuándo el
  valor mostrado viene del costo a mano en vez de una compra real, para
  poder marcarlo "(estimado)" en pantalla sin mostrarlo como un dato real.
  **A propósito no se tocó ningún significado existente**: `ultimoCosto`/
  `penultimoCosto` (usados por "Registrar entrada"/"Entrada de cámara" para
  comparar el costo actual vs. el anterior de una compra real) siguen
  siendo estrictamente el costo de compras reales, sin mezclarse con el
  costo de referencia — los campos nuevos (`costoEfectivo`/
  `costoEsEstimado`) son exclusivos para calcular y mostrar margen.
  Agregado a los tres endpoints que ya devolvían costo para calcular
  margen: `GET /api/productos?incluirCosto=true` (tabla de Productos),
  `GET /api/productos/margenes` (Combos — y su filtro de "costo conocido"
  pasó de exigir `ultimoCosto` a exigir `costoEfectivo`, para que un
  producto con solo costo de referencia también pueda aparecer) y
  `GET /api/productos/:id` (ficha de producto).
- **Campo editable en la ficha del producto** (`ProductoForm.tsx`): "Costo
  de referencia", junto al resto de los datos — con una nota explicando
  que solo se usa mientras no haya ninguna compra real. El preview de
  margen de esa misma pantalla (al cambiar el precio) también pasó a usar
  `costoEfectivo` en vez de solo el costo real, y el mensaje de "Sin costo
  registrado" solo aparece cuando de verdad no hay ninguno de los dos.
- **Importador CSV masivo** (`GET`/`POST /api/productos/importar-costos-csv`,
  mismo patrón de dos pasos "previsualizar → confirmar" ya usado para
  crear productos desde CSV): columnas `plu,costo` — **actualiza productos
  que ya existen, no crea productos nuevos** (si el PLU no existe, esa fila
  queda marcada con error "No existe ningún producto con ese PLU" en vez de
  crear uno). Botón "Importar costos (CSV)" nuevo en Productos, junto al ya
  existente "Importar productos (CSV)".
- **Mostrado en las 3 pantallas de margen** (`Productos.tsx`,
  `MejorMargen.tsx`/Combos, `ControlPrecios.tsx`), todas actualizadas para
  usar `costoEfectivo`/`costoEsEstimado` en vez del costo real puro —
  columna "Costo" (antes "Costo (último)"/"Último costo", renombrada porque
  ahora puede no ser de una compra) con la etiqueta "(estimado)" junto al
  valor cuando corresponde. En Control de precios, el "Registro de cambios
  de precio" (que usa el costo actual de cada producto para mostrar el
  margen histórico) también hereda automáticamente este respaldo.

Probado de punta a punta contra el servidor real: un producto de prueba sin
ninguna compra registrada mostraba costo/margen vacíos; al escribir un
costo de referencia ($10.000) pasó a mostrar `costoEfectivo: 10000,
costoEsEstimado: true` en los tres endpoints (ficha, listado con costo,
margenes); al registrarle una compra real ($12.000) el costo efectivo
cambió solo al valor real y `costoEsEstimado` pasó a `false` — confirmando
que la compra real manda por sobre el costo a mano. El importador CSV
(`plu,costo`) actualizó correctamente 2 de 3 filas de prueba (una con PLU
inexistente quedó marcada con el error esperado, sin crear nada) y,
probado también contra un producto real con compra ya registrada
(CHURRASCO DE VACUNO), confirmó que escribirle un costo de referencia por
CSV no cambia su `costoEfectivo` (se queda con el costo real) — exactamente
el comportamiento de "solo respaldo" pedido. Con Playwright contra las
pantallas reales: el campo "Costo de referencia" en la ficha guarda y
refleja "(estimado)" tras recargar; la tabla de Productos, Combos y
Control de precios muestran el costo, el margen calculado y la etiqueta
"(estimado)" correctamente para el mismo producto de prueba; el panel
"Importar costos desde CSV" se despliega y muestra su formulario — datos
de prueba (producto y cambios a productos reales) revertidos/eliminados
después.

## Sincronización con la página web (lagrancarniceria.com)
Se construyó para que la página web (repo aparte, `lagrancarniceria.com`,
Next.js + Postgres) muestre el catálogo, las tarifas de despacho y las
opciones de corte siempre al día con el POS, sin que nadie tenga que
actualizarlos a mano en dos lugares — y para que los pedidos que un
cliente arma en la web (cotización por WhatsApp, no un pago) lleguen de
vuelta acá para gestionarlos. Trabajado en la rama `claude/conexion-web-pos`.

**Diseño clave: la web es la única pieza que toca la base de datos
compartida.** El POS nunca se conecta directo a ese Postgres — le habla
por HTTPS a las rutas `/api/sync/*` de la web, autenticado con una llave
acotada (`SYNC_API_KEY`), nunca con la contraseña de la base de datos. Así,
si esa llave se filtra desde un instalador del POS, el daño posible queda
acotado a "puede escribir catálogo/leer pedidos", nunca a la base
completa. Cada sync reemplaza el catálogo público entero (no hace
diffs) — más simple y sin bugs de diff, y el volumen de datos (~100
productos) no lo justifica.

- **`ConfiguracionSyncWeb`** (tabla en `datos.db`, no un `.env`): la app
  empaquetada no tiene archivo de configuración editable a mano, así que
  la URL de la web y la llave de sync se guardan en la base local y se
  configuran desde una pantalla (`GET/POST /api/configuracion/sync-web`).
  Como esto vive en `datos.db` (carpeta de usuario, no en los archivos del
  instalador), sobrevive a las actualizaciones del programa sin que el
  usuario tenga que reconfigurar nada cada vez que se instala una versión
  nueva.
- **`server/lib/syncWeb.ts`**: `iniciarSyncWeb()` arranca un intervalo de 5
  minutos apenas levanta el servidor (siempre, no solo si ya está
  configurado) que llama a `sincronizarCatalogoConWeb()` (manda productos
  visibles en la web + comunas + opciones de corte) y
  `traerPedidosWebPendientes()` (trae pedidos nuevos de la web, los guarda
  en `PedidoWeb`, y confirma a la web cuáles quedaron guardados para que
  no los reenvíe). Filosofía "best effort": un fallo de sync (sin
  internet, web caída) nunca bloquea la operación normal del POS — se
  llama con `void` y solo queda un `console.warn`.
- **Campos web en `Producto`**: `visibleEnWeb`, `disponibilidadWeb`
  ("disponible"/"agotado"/"proximamente"), `featured`, `lowStock`, `marca`,
  `descripcionCorta`, `familiaCorte` (para el selector de corte en la web —
  las opciones válidas de cada familia viven en `CorteOpcion`, editable
  desde Comunas → "Opciones de corte"), y una promo por volumen
  (`promoPrecioUnitario`/`promoGramosMinimos`/`promoEtiqueta`, los tres
  juntos o ninguno). Todo esto es independiente de `activo` (que es el
  estado general del POS): un producto puede seguir activo en el POS pero
  no publicarse en la web. Editable desde la ficha del producto, o con
  toggles rápidos (Oculto/Disponibilidad/Destacado/Pocas unidades) directo
  en la tabla de Productos.
- **`PedidoWeb`** + pantalla "Pedidos web": cada pedido trae `tipoEntrega`
  ("retiro" o "despacho" — dirección/comuna/costo de envío solo aplican y
  son obligatorios si es despacho), `fechaEntrega`, `medioPago`
  (informativo, no hay pasarela de pago), y el detalle de ítems con corte,
  envasado (Tradicional/Al vacío) e instrucciones especiales del cliente.
  Se marcan "atendido" a mano desde el panel.

**Catálogo real:** el prompt de rediseño de la web traía el catálogo real
(precios, PLU, marca) de la carnicería, pero **16 productos de Pollo no
tenían PLU** (esa tabla del documento no tenía columna de PLU) y algunos de
Artesanales tenían PLU repetido entre variantes (Choripán/Longaniza
Tradicional vs. Picante) o tampoco traían uno (Butifarra, las 3
hamburguesas). Como el PLU es único en la base y es el código real de
pesaje/balanza, no se inventó ninguno de esos ~25 — quedaron afuera de la
carga a propósito. `scripts/cargar-catalogo-real.ts` carga los 55 productos
que sí tenían un PLU confiable (con marca, familia de corte y destacados ya
configurados), crea las categorías y las opciones de corte estándar de
Vacuno/Cerdo/Pollo — corre en modo simulación por defecto, solo escribe
con `--confirmar` (`npm run catalogo:real -- --confirmar`). El reporte de
los ~25 productos que quedaron fuera, y por qué, lo imprime el script mismo
al final de cada corrida.

Probado (dry-run y typecheck) contra el `dev.db` local — **no probado
contra una instalación real** ni contra el Postgres real de la web
(sandbox de desarrollo sin acceso a internet a ese dominio). Pendiente que
el usuario: (1) configure la sync en su instalación real con la
`SYNC_API_KEY` real, (2) confirme los PLU reales de los ~25 productos que
quedaron fuera de la carga, y (3) corra `cargar-catalogo-real.ts
--confirmar` una vez revisado.
