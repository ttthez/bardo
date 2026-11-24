// Arma la Factura C de un ingreso de Bardo (`datos`), sin llamar a ARCA.

// Condición frente al IVA del receptor (FEParamGetCondicionIvaReceptor).
export const COND_IVA = {
  cf: { id: 5, nombre: 'Consumidor Final' },
  ri: { id: 1, nombre: 'IVA Responsable Inscripto' },
  monotributo: { id: 6, nombre: 'Responsable Monotributo' },
  exento: { id: 4, nombre: 'IVA Sujeto Exento' }
};

export const CONCEPTOS = { 1: 'Productos', 2: 'Servicios', 3: 'Productos y Servicios' };

const MEDIOS = { efectivo: 'Contado', mp: 'Mercado Pago', transferencia: 'Transferencia bancaria', tarjeta: 'Tarjeta' };

const lista = (x) => (x == null ? [] : Array.isArray(x) ? x.filter(Boolean) : Object.values(x).filter(Boolean));

// 'YYYY-MM-DD' de hoy en Argentina.
export function hoyArgentina(ahora = new Date()) {
  return new Date(ahora.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
}

export function sumarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// Documento del receptor según lo que se cargó: CUIT (11 dígitos), DNI (7-8) o consumidor final sin identificar.
export function receptor(facturaA) {
  if (!facturaA || !String(facturaA.cuit || '').replace(/\D/g, '')) {
    return { docTipo: 99, docNro: '0', condIva: COND_IVA.cf.id, nombre: facturaA?.nombre || 'Consumidor Final', condNombre: COND_IVA.cf.nombre };
  }
  const nro = String(facturaA.cuit).replace(/\D/g, '');
  const cond = COND_IVA[facturaA.condIva] || COND_IVA.cf;
  if (nro.length === 11) return { docTipo: 80, docNro: nro, condIva: cond.id, nombre: facturaA.nombre || '', condNombre: cond.nombre, domicilio: facturaA.domicilio };
  if (nro.length === 7 || nro.length === 8) return { docTipo: 96, docNro: nro, condIva: cond.id, nombre: facturaA.nombre || '', condNombre: cond.nombre, domicilio: facturaA.domicilio };
  throw new Error(`El CUIT/DNI "${facturaA.cuit}" no tiene 11 ni 7-8 dígitos`);
}

// Fecha del comprobante: la del cobro si ARCA la acepta; si no, la más cercana posible.
// ARCA admite hasta 5 días atrás (productos) o 10 (servicios), y nunca antes del último comprobante del punto de venta.
export function fechaComprobante(fechaCobro, concepto, { hoy, ultimaFecha }) {
  let min = sumarDias(hoy, concepto === 1 ? -5 : -10);
  if (ultimaFecha && ultimaFecha > min) min = ultimaFecha;
  let f = fechaCobro || hoy;
  if (f < min) f = min;
  if (f > hoy) f = hoy;
  return f;
}

// ingreso: elemento de `datos`. ctx: { catering, ventas, emisor, hoy, ultimaFecha }.
export function armarComprobante(ingreso, ctx) {
  if (!ingreso) throw new Error('No existe ese ingreso');
  const total = Number(ingreso.monto);
  if (!(total > 0)) throw new Error(`El ingreso "${ingreso.desc}" no tiene un monto válido`);
  if (!ctx.emisor) throw new Error(`Falta configurar el emisor de la cuenta "${ingreso.cuenta}"`);

  const evento = ingreso.eventoId ? lista(ctx.catering).find((e) => e.id === ingreso.eventoId) : null;
  const venta = ingreso.ventaId ? lista(ctx.ventas).find((v) => v.id === ingreso.ventaId) : null;
  const concepto = ingreso.eventoId ? 2 : 1;
  const rec = receptor(ingreso.facturaA || evento?.facturaA);

  let items;
  if (ingreso.eventoId) {
    const quien = evento?.nombre || ingreso.desc.replace(/^(Seña|Saldo)\s*·\s*/i, '');
    const parte = ingreso.tipo === 'seña' ? 'Seña' : ingreso.tipo === 'saldo' ? 'Saldo' : 'Pago';
    const cuando = evento?.fecha ? ` del ${fechaCorta(evento.fecha)}` : '';
    const pax = evento?.personas ? ` (${evento.personas} personas)` : '';
    items = [{ desc: `${parte} servicio de catering${cuando}${pax} · ${quien}`, cant: 1, precio: total }];
  } else if (venta) {
    const pizzas = lista(venta.items).reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
    const envio = Number(venta.envio?.cobrado) || 0;
    items = [];
    if (pizzas > 0) items.push({ desc: 'Pizzas napoletanas congeladas', cant: pizzas, precio: (total - envio) / pizzas });
    else items.push({ desc: 'Pizzas napoletanas congeladas', cant: 1, precio: total - envio });
    if (envio > 0) items.push({ desc: 'Envío', cant: 1, precio: envio });
  } else {
    items = [{ desc: ingreso.desc || 'Venta', cant: 1, precio: total }];
  }

  const fecha = fechaComprobante(ingreso.fecha, concepto, ctx);
  const c = {
    ingresoId: ingreso.id,
    cuenta: ingreso.cuenta,
    cuit: ctx.emisor.cuit,
    cbteTipo: 11,
    ptoVta: Number(ctx.emisor.ptoVta),
    concepto,
    ...rec,
    fecha,
    fechaCobro: ingreso.fecha,
    total,
    items,
    condVenta: MEDIOS[ingreso.medio] || 'Contado'
  };
  if (concepto !== 1) {
    // período del servicio: el día del evento (si no está, el del cobro); el pago ya se hizo
    const dia = evento?.fecha || ingreso.fecha || fecha;
    c.servDesde = dia;
    c.servHasta = dia;
    c.vtoPago = fecha;
  }
  return c;
}

// Número para mostrar: 00003-00000012
export function numeroLegible(ptoVta, nro) {
  return `${String(ptoVta).padStart(5, '0')}-${String(nro).padStart(8, '0')}`;
}

// Nombre del PDF en Drive: "2026-11-24 · Factura C 00003-00000012 · Thiago · Casamiento Pérez.pdf"
export function nombreArchivo(c, emisorNombreCorto, detalle) {
  const limpio = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const partes = [c.fecha, `Factura C ${numeroLegible(c.ptoVta, c.nro)}`, emisorNombreCorto, detalle].map(limpio).filter(Boolean);
  return partes.join(' · ') + '.pdf';
}
