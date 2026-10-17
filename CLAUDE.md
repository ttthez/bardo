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

**`datos`**: ingresos (lo que suma al Objetivo del mes). Lista de
`{ id, fecha, desc, monto }`. Los cobros de catering llevan además `eventoId` y `tipo` (`'seña'` | `'saldo'`),
con `desc` tipo `"Seña · Casamiento Pérez"`. El evento calcula lo cobrado sumando los ingresos con su `eventoId`.

**`catering`**: lista de eventos
`{ id, nombre, fecha, hora, lugar, personas, pizzas, precio, notas, sabores: [{nombre, cantidad}], checklist: [{nombre, cantidad, hecho}], personal: [{id, nombre, monto}] }`.
`personas` es la cantidad de pax. `precio` es el total del evento.
Campos viejos que la app ya no muestra (`ingredientes`, `cerrado`, `cerradoEl`): dejarlos como están.

**`gastos`**: `{ fijos: [...], movs: [...], pagos: { 'YYYY-MM': [idFijo, ...] } }`
- `fijos`: `{ id, nombre, monto, dia, cat, desde: 'YYYY-MM', hasta?: 'YYYY-MM' }`. Se repiten cada mes de `desde` a `hasta`.
- `movs`: `{ id, fecha, cat, monto, desc }`. El pago de personal de un evento lleva además `personalId` y `eventoId`, con `desc` tipo `"Mozo Juan · Casamiento Pérez"` y la fecha del evento.
- Categorías (`cat`): `insumos`, `packaging`, `impuestos`, `auto`, `servicios`, `equipo`, `publicidad`, `personal`, `otros`.

**`pedidos`**: `{ id, cliente, fecha, hora, direccion, notas, items: [{nombre, cantidad}] }` (pendientes de entrega).

**`pizzas`**: `{ stock: [{nombre, cantidad}], ventas: [{id, fecha, cliente?, items: [{nombre, cantidad}]}] }`.

**`metas`**: `{ 'YYYY-MM': monto }`, objetivo de ingresos de cada mes.

**`precios`**: precios por kilo de ingredientes (ya no se usan en la app).
