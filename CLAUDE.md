# Bardo

App de gestión de La Sinergia (pizzas y catering). Todo está en `index.html`, publicado con GitHub Pages.
Los datos viven en Firebase Realtime Database (`objetivo-julio`), protegidos con login por email.

## Leer y escribir datos

Usá `scripts/bardo.mjs` (necesita `BARDO_EMAIL` y `BARDO_PASSWORD` en el entorno):

```bash
node scripts/bardo.mjs get gastos > /tmp/gastos.json
# editar /tmp/gastos.json
node scripts/bardo.mjs put gastos /tmp/gastos.json
```

- Cada nodo se reemplaza entero: siempre `get` justo antes de `put`, y modificá solo lo pedido.
- `put` guarda una copia del nodo anterior en `.bardo-backups/` (no se sube al repo).
- Antes de borrar o cambiar algo que ya existe, confirmalo con el usuario. Después de escribir, contale qué quedó cargado.
- Montos en pesos, como números. Fechas `YYYY-MM-DD` en hora de Argentina. Ids: `Date.now()` (número), únicos.
- Firebase no guarda listas vacías: un nodo o campo puede venir `null` y hay que tratarlo como `[]`/`{}`.

## Modelo de datos

**`datos`**: ingresos (lo facturado; la meta del mes se mide sobre ingresos − gastos). Lista de
`{ id, fecha, desc, monto }`. Los cobros de catering llevan además `eventoId` y `tipo` (`'seña'` | `'saldo'`),
con `desc` tipo `"Seña · Casamiento Pérez"`. El evento calcula lo cobrado sumando los ingresos con su `eventoId`.

**`catering`**: lista de eventos
`{ id, nombre, fecha, hora, lugar, personas, pizzas, precio, notas, sabores: [{nombre, cantidad}], checklist: [{nombre, cantidad, hecho}], personal: [{id, nombre, monto}] }`.
`personas` es la cantidad de pax. `precio` es el total del evento.
Para estimar la ganancia del evento: `menu` (`op1` | `op2` | `papas`), `km` (ida y vuelta), `peajes` y
`pizzasSalieron` (las que salieron, se carga después del evento; si falta se estima por persona).
Cada sabor lleva `cantidad` (las que se llevan) y `salieron` (las que salieron, después del evento); al cargar `salieron`
la app actualiza `pizzasSalieron` con la suma.
`costosExtra` (opcional): `[{ id, desc, monto, cat }]`, costos puntuales del evento (hielo, alquiler, viáticos) que restan
de su ganancia; con "Anotar en gastos" se crea un `gastos.movs` con `costoExtraId` y `eventoId`, la fecha del evento y la `cat` elegida.
`origen` (opcional): cómo nos conoció el cliente, `meta` (anuncio de Meta), `instagram`, `recomendacion`, `cliente`
(ya era cliente), `evento` (probó en otro evento) u `otro`; sin el campo = sin dato. Catering muestra una torta por canal
(clientes, personas o facturación) y compara lo facturado por Meta con los gastos de `publicidad`.
Campos viejos que la app ya no muestra (`ingredientes`, `cerrado`, `cerradoEl`): dejarlos como están.

**`gastos`**: `{ fijos: [...], movs: [...], pagos: { 'YYYY-MM': [idFijo, ...] } }`
- `fijos`: `{ id, nombre, monto, dia, cat, desde: 'YYYY-MM', hasta?: 'YYYY-MM' }`. Se repiten cada mes de `desde` a `hasta`.
- `movs`: `{ id, fecha, cat, monto, desc }`. El pago de personal de un evento lleva además `personalId` y `eventoId`, con `desc` tipo `"Mozo Juan · Casamiento Pérez"` y la fecha del evento.
- Categorías (`cat`): `insumos`, `packaging`, `impuestos`, `auto`, `servicios`, `equipo`, `publicidad`, `personal`, `otros`.

**Medio de pago** (`medio`, opcional en ingresos de `datos` y en `gastos.movs`): `efectivo`, `mp` (Mercado Pago),
`transferencia` (otra cuenta) o `tarjeta`. Al cargar desde un extracto, poné el medio que corresponde.
Los ingresos que no son en efectivo llevan además `cuenta`: `thiago` o `juan`, la cuenta que recibió el cobro
(cada socio factura con su monotributo; la app muestra lo facturado por cuenta en el año).

**Dólares**: un ingreso o gasto en dólares lleva `moneda: 'USD'`, `usd` (lo que fue en dólares) y `tc` (pesos por US$);
`monto` sigue en pesos (`usd × tc`, redondeado) para que todos los totales sigan en pesos.

**`pedidos`**: `{ id, cliente, fecha, hora, direccion, notas, items: [{nombre, cantidad}] }` (pendientes de entrega).

**`pizzas`**: `{ stock: [{nombre, cantidad}], ventas: [{id, fecha, cliente?, items: [{nombre, cantidad}]}] }`.

**`metas`**: `{ 'YYYY-MM': monto }`, meta de ganancia (ingresos − gastos) de cada mes.

**`precios`**: precios por kilo de ingredientes (ya no se usan en la app).

**`caja`**: `{ monto, usd?, fecha: 'YYYY-MM-DD', ts }`, último conteo de efectivo (`monto` en pesos, `usd` en billetes de dólar).
La app suma y resta los movimientos con `medio: 'efectivo'` posteriores (fecha mayor, o misma fecha e `id` mayor que `ts`)
para mostrar el efectivo en caja; los que tienen `moneda: 'USD'` mueven la caja en dólares.

**`costos`**: valores aproximados para la ganancia de cada evento, editables desde Catering:
`{ costoPizza, pizzasPorPersona, merma (%), extras: { op1, op2, papas } ($ por persona), tanque ($ tanque lleno), kmTanque,
servilletasPorPizza, servPaquete, servPrecio, servOfertas: [{ id, donde, medida, cantidad, precio, fecha }] }`.
Lista de precios: `precios: { op1, op2, papas, logistica }` ($ por persona y logística CABA) y `minPersonas`; al crear un
evento con menú y personas, `precio` = max(personas, minPersonas) × precio del menú + logística.
También `gananciaMinima` (aviso "bajo mínimo" si un evento deja menos), `sueldoDueno` y `duenos` (para ver la ganancia
con el trabajo de los dueños pagado). `servOfertas` son precios de servilletas anotados para comparar; el que se usa queda en `servPaquete`/`servPrecio`.
`sabores: { 'nombre en minúscula': costo }` es el costo de cada sabor con packaging (de la planilla de costos), para la
ganancia de las congeladas en Ventas; los sabores que faltan usan `costoPizza`.
`congeladas: { escalones: [{ desde, precio }] }` es la lista de precios de congeladas: todos los sabores valen lo mismo y el
precio por pizza es el del escalón más alto que alcanza el total de pizzas de la compra (packs, mezclando sabores).
Insumos = pizzas × costoPizza × (1 + merma) + pax × extra del menú; nafta = km × tanque / kmTanque;
servilletas = pizzas × servilletasPorPizza × servPrecio / servPaquete.

**`plantilla`**: lo que se lleva a cada evento, editable desde Catering: `{ sabores: [nombre], pizzaDelMes, checklist: [{ nombre, cantidad, grupo }] }`.
Los eventos nuevos arrancan con esos sabores (más la pizza del mes) y esa checklist. Los ítems de la checklist de un evento
llevan `grupo`: `Cajas`, `Bases`, `Quesos`, `Toppings`, `Finishers` (mise en place), `Equipamiento`, `Comprar` u `Otros`.

**`titulares`** (no lo usa la app): `{ reglas: [texto], lista: [{ titular, es, tipo, cat?, nota? }] }`.
Cómo clasificar los movimientos de los extractos (Mercado Pago, tarjetas): `tipo` es `empresa`, `personal`,
`no es gasto` o `dudoso`, y `cat` la categoría de gasto. Leelo antes de procesar un extracto y sumá ahí
los titulares nuevos que el usuario aclare.

## Convenciones de la interfaz

- Cada campo lleva etiqueta visible (`<label class="campo"><span>Monto</span><input …></label>`) con un ejemplo en el
  placeholder; los que se pueden dejar vacíos dicen `· opcional`.
- Montos que se escriben a mano: `type="text" inputmode="decimal" class="inp-plata"` y se leen con `parsearMonto`
  (entiende "15.000" y "1.450,50"); debajo se muestra cómo se entendió.
- Errores: `errorEn(campo, 'qué falta y un ejemplo')` junto al campo, nunca `alert`.
- Después de guardar: `hecho('qué pasó', foto())` muestra el aviso con "Deshacer". Las acciones reversibles no piden
  confirmación; `confirm` queda para lo grave (borrar un evento, cerrar sesión con cambios sin subir).
- Medio, cuenta y moneda se eligen con botones (`chipear` sobre los `<select class="sel-medio|sel-cuenta|sel-moneda">`).
- Si un guardado falla, el nodo queda en `lasinergia_pendientes`: la sincronización no lo pisa y lo reintenta sola.

## Calendario de eventos

Los eventos de catering también se anotan en Google Calendar ("La Sinergia | Eventos"), con cliente, PAX, menú,
dirección, llegada, servicio, equipo y notas. **El calendario no lleva cobros**: ni total, ni seña, ni saldo, ni forma
de pago. Esos datos van solo en Bardo (`catering.precio`, notas del evento e ingresos en `datos`).

## Cargar gastos desde extractos

- Todo lo de Mercado Pago (cuenta y tarjeta) es de la empresa; la tarjeta Visa Santander es personal. Ante la duda, preguntar.
- Los dueños no cobran como personal de eventos. Sus gastos personales no se cargan en Bardo: se arma un texto aparte para descontarlos de su parte a fin de mes.
- Personal de eventos: $40.000 por persona salvo que se indique otro monto.
- No son gastos: pagos de resumen de tarjeta, transferencias entre cuentas propias o a socios para liquidez, reservas de dinero.
- Compras en cuotas: cada cuota en el mes del resumen en que aparece; las largas, como gasto fijo con `desde`/`hasta`.
- Compras en dólares: al tipo de cambio del resumen; percepciones e IVA de las compras de la empresa van en `impuestos`.
- Antes de cargar, revisar que no esté ya en `gastos` (pagos de personal de eventos, fijos como alquiler o cuotas).
