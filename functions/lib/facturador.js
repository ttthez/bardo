// Factura una lista de ingresos de Bardo. Lo usan el script (scripts/arca.mjs) y la función de la app.
//
// opts:
//   entorno: 'homo' | 'prod'
//   certPem, keyPem: certificado y clave (uno solo firma para las dos cuentas si Juan delegó en el de Thiago)
//   store: { leer(nodo), reclamar(id, datos) -> bool, guardar(id, datos), borrar(id), cacheTicket: { leer, guardar } }
//   drive?: { subir(carpeta, nombre, buffer) -> { url, id } }
//   emitir: false = solo vista previa (no pide CAE)
//   ahora?: Date
import { armarComprobante, hoyArgentina, nombreArchivo, numeroLegible } from './comprobante.js';
import { generarPDF } from './pdf.js';
import { ticket } from './wsaa.js';
import { consultar, solicitarCAE, ultimoAutorizado } from './wsfe.js';

const lista = (x) => (x == null ? [] : Array.isArray(x) ? x.filter(Boolean) : Object.values(x).filter(Boolean));
const isoDe = (aaaammdd) => (aaaammdd ? `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}` : null);

export const nodoFacturas = (entorno) => (entorno === 'prod' ? 'facturas' : 'facturas_homo');

export function emisorDe(config, cuenta, entorno) {
  const e = config?.emisores?.[cuenta];
  if (!e) return null;
  return { ...e, ptoVta: entorno === 'prod' ? e.ptoVta : e.ptoVtaHomo || 1 };
}

// Ingresos sin factura de la cuenta. Los cobros en efectivo no entran: esos los factura Thiago a mano en ARCA.
export function pendientes(datos, facturas, { desde, hasta, cuenta } = {}) {
  const hechas = facturas || {};
  return lista(datos).filter(
    (i) =>
      i.cuenta &&
      i.medio !== 'efectivo' &&
      !hechas[i.id] &&
      !i.noFacturar &&
      Number(i.monto) > 0 &&
      (!cuenta || i.cuenta === cuenta) &&
      (!desde || i.fecha >= desde) &&
      (!hasta || i.fecha <= hasta)
  );
}

export async function facturar(ids, opts) {
  const { entorno, certPem, keyPem, store, drive, emitir = false, fetchImpl } = opts;
  if (entorno !== 'homo' && entorno !== 'prod') throw new Error('entorno debe ser homo o prod');
  const hoy = hoyArgentina(opts.ahora);
  const [datos, catering, pizzas, config, facturas] = await Promise.all([
    store.leer('datos'),
    store.leer('catering'),
    store.leer('pizzas'),
    store.leer('facturacion'),
    store.leer(nodoFacturas(entorno))
  ]);
  const ingresos = lista(datos);
  const ventas = lista(pizzas?.ventas);

  const resultados = [];
  const porCuenta = {};
  for (const id of ids) {
    const ing = ingresos.find((i) => String(i.id) === String(id));
    if (!ing) {
      resultados.push({ id, ok: false, error: 'No existe ese ingreso' });
      continue;
    }
    if (facturas?.[ing.id]) {
      resultados.push({ id: ing.id, ok: false, error: 'Ya está facturado', factura: facturas[ing.id] });
      continue;
    }
    if (!ing.cuenta) {
      resultados.push({ id: ing.id, ok: false, error: 'Falta elegir a qué cuenta (Thiago o Juan) corresponde' });
      continue;
    }
    (porCuenta[ing.cuenta] ||= []).push(ing);
  }

  const ta = await ticket({ entorno, certPem, keyPem, cache: store.cacheTicket, fetchImpl });

  for (const [cuenta, lote] of Object.entries(porCuenta)) {
    const emisor = emisorDe(config, cuenta, entorno);
    if (!emisor?.cuit) {
      for (const ing of lote) resultados.push({ id: ing.id, ok: false, error: `Falta configurar los datos de facturación de ${cuenta}` });
      continue;
    }
    const credenciales = { token: ta.token, sign: ta.sign, cuit: emisor.cuit };
    const base = { entorno, credenciales, ptoVta: emisor.ptoVta, fetchImpl };

    let ultimo = await ultimoAutorizado(base);
    let ultimaFecha = ultimo > 0 ? isoDe((await consultar({ ...base, nro: ultimo })).CbteFch) : null;

    lote.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.id - b.id);
    for (const ing of lote) {
      let c;
      try {
        c = armarComprobante(ing, { catering, ventas, emisor, hoy, ultimaFecha });
      } catch (e) {
        resultados.push({ id: ing.id, ok: false, error: e.message });
        continue;
      }
      if (!emitir) {
        resultados.push({ id: ing.id, ok: true, vistaPrevia: true, comprobante: c });
        continue;
      }
      const r = await emitirUno({ c, ing, base, ultimo, store, entorno, emisor });
      resultados.push(r);
      if (r.ok) {
        ultimo = r.factura.nro;
        ultimaFecha = r.factura.fecha;
        await guardarPDF({ r, emisor, cuenta, ing, store, drive, entorno, catering });
      } else if (r.ultimo != null) {
        ultimo = r.ultimo;
      }
    }
  }
  return resultados;
}

async function emitirUno({ c, ing, base, ultimo, store, entorno }) {
  for (let intento = 0; intento < 2; intento++) {
    c.nro = ultimo + 1;
    const reservado = await store.reclamar(ing.id, { estado: 'emitiendo', desde: Date.now(), nro: c.nro, ptoVta: c.ptoVta, cuit: c.cuit });
    if (!reservado) return { id: ing.id, ok: false, error: 'Otra persona lo está facturando en este momento' };
    let res;
    try {
      res = await solicitarCAE({ ...base, c });
    } catch (e) {
      // no sabemos si ARCA lo emitió: lo averiguamos antes de soltar la reserva
      const rec = await reconciliar({ c, base }).catch(() => null);
      if (rec?.emitido) return await exito({ c, ing, store, entorno, cae: rec.cae, caeVto: rec.caeVto, obs: ['Recuperado tras un corte de conexión'] });
      if (rec && !rec.emitido) {
        await store.borrar(ing.id);
        return { id: ing.id, ok: false, error: `No se pudo conectar con ARCA: ${e.message}`, ultimo: rec.ultimo };
      }
      return { id: ing.id, ok: false, error: `Corte de conexión con ARCA y no se pudo verificar si se emitió (${e.message}). Queda marcado "emitiendo" para revisarlo.` };
    }
    if (res.ok) return await exito({ c, ing, store, entorno, cae: res.cae, caeVto: res.caeVto, obs: res.obs });
    await store.borrar(ing.id);
    const msgs = [...res.errores, ...res.obs];
    // 10016: el número no es el siguiente (alguien emitió en el medio): reintentamos con el número actual
    if (intento === 0 && msgs.some((m) => m.startsWith('10016'))) {
      ultimo = await ultimoAutorizado(base);
      continue;
    }
    return { id: ing.id, ok: false, error: `ARCA lo rechazó: ${msgs.join(' · ') || res.resultado}`, comprobante: c };
  }
}

async function reconciliar({ c, base }) {
  const ultimo = await ultimoAutorizado(base);
  if (ultimo < c.nro) return { emitido: false, ultimo };
  const r = await consultar({ ...base, nro: c.nro });
  const coincide = Number(r.ImpTotal) === Math.round(c.total * 100) / 100 && String(r.DocNro) === String(c.docNro);
  if (!coincide) return { emitido: false, ultimo };
  return { emitido: true, cae: r.CodAutorizacion, caeVto: isoDe(r.FchVto) };
}

async function exito({ c, ing, store, entorno, cae, caeVto, obs }) {
  const factura = {
    estado: 'emitida',
    entorno,
    cuenta: c.cuenta,
    cuit: c.cuit,
    tipo: c.cbteTipo,
    ptoVta: c.ptoVta,
    nro: c.nro,
    numero: numeroLegible(c.ptoVta, c.nro),
    cae,
    caeVto,
    fecha: c.fecha,
    total: c.total,
    concepto: c.concepto,
    receptor: { docTipo: c.docTipo, docNro: c.docNro, nombre: c.nombre, condIva: c.condIva },
    items: c.items,
    emitida: Date.now(),
    ...(obs?.length ? { obs } : {})
  };
  await store.guardar(ing.id, factura);
  return { id: ing.id, ok: true, factura, comprobante: { ...c, cae, caeVto } };
}

async function guardarPDF({ r, emisor, cuenta, ing, store, drive, entorno, catering }) {
  try {
    const c = r.comprobante;
    const pdf = await generarPDF(c, emisor, { homologacion: entorno !== 'prod' });
    r.pdf = pdf;
    if (!drive) return;
    const evento = ing.eventoId ? lista(catering).find((e) => e.id === ing.eventoId) : null;
    const detalle = evento?.nombre || c.nombre !== 'Consumidor Final' && c.nombre || ing.desc;
    const nombreCorto = emisor.nombreCorto || cuenta[0].toUpperCase() + cuenta.slice(1);
    const carpeta = (entorno === 'prod' ? '' : 'PRUEBAS/') + c.fecha.slice(0, 7);
    const subido = await drive.subir(carpeta, nombreArchivo(c, nombreCorto, detalle), pdf);
    r.factura.pdf = subido.url;
    await store.guardar(ing.id, r.factura);
  } catch (e) {
    r.errorPdf = e.message;
  }
}
