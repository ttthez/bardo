import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { armarComprobante, fechaComprobante, receptor, nombreArchivo } from '../lib/comprobante.js';
import { armarTRA, firmarTRA } from '../lib/wsaa.js';
import { xmlDetalle } from '../lib/wsfe.js';
import { facturar, pendientes } from '../lib/facturador.js';
import { generarPDF, urlQR } from '../lib/pdf.js';

function certPrueba() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 864e5);
  cert.validity.notAfter = new Date(Date.now() + 864e5);
  const attrs = [{ name: 'commonName', value: 'bardo-test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}
const CRED = certPrueba();

test('el TRA firmado es un CMS válido que openssl verifica', () => {
  const tra = armarTRA('wsfe', new Date('2026-11-24T15:00:00Z'));
  assert.match(tra, /<generationTime>2026-11-24T11:50:00-03:00<\/generationTime>/);
  const dir = mkdtempSync(join(tmpdir(), 'tra-'));
  writeFileSync(join(dir, 'cms.der'), Buffer.from(firmarTRA(tra, CRED.certPem, CRED.keyPem), 'base64'));
  const salida = execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', join(dir, 'cms.der'), '-noverify'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  assert.equal(salida, tra);
});

test('receptor: consumidor final, CUIT y DNI', () => {
  assert.deepEqual([receptor(null).docTipo, receptor(null).condIva], [99, 5]);
  const r = receptor({ nombre: 'Acme SA', cuit: '30-71234567-1', condIva: 'ri' });
  assert.deepEqual([r.docTipo, r.docNro, r.condIva], [80, '30712345671', 1]);
  assert.equal(receptor({ cuit: '30.123.456' }).docTipo, 96);
  assert.throws(() => receptor({ cuit: '123' }));
});

test('fecha: respeta la ventana de ARCA y el último comprobante', () => {
  const hoy = '2026-11-24';
  assert.equal(fechaComprobante('2026-11-22', 1, { hoy }), '2026-11-22');
  assert.equal(fechaComprobante('2026-11-01', 1, { hoy }), '2026-11-19');
  assert.equal(fechaComprobante('2026-11-01', 2, { hoy }), '2026-11-14');
  assert.equal(fechaComprobante('2026-11-20', 1, { hoy, ultimaFecha: '2026-11-23' }), '2026-11-23');
  assert.equal(fechaComprobante('2026-12-01', 1, { hoy }), hoy);
});

const EVENTO = { id: 10, nombre: 'Casamiento Pérez', fecha: '2026-12-13', personas: 80 };
const VENTA = { id: 20, items: [{ nombre: 'Diavola', cantidad: 4 }, { nombre: 'Margarita', cantidad: 6 }], envio: { cobrado: 5000, via: 'uber' } };
const EMISOR = { cuit: '20111111112', ptoVta: 3, nombre: 'RODRIGUEZ THIAGO', domicilio: 'Calle 123, CABA', inicio: '2024-03-01' };

test('catering = servicios con el período del evento; congeladas = productos con envío aparte', () => {
  const ctx = { catering: [EVENTO], ventas: [VENTA], emisor: EMISOR, hoy: '2026-11-24' };
  const s = armarComprobante({ id: 1, fecha: '2026-11-21', desc: 'Seña · Casamiento Pérez', monto: 250000, eventoId: 10, tipo: 'seña', cuenta: 'thiago', medio: 'mp' }, ctx);
  assert.equal(s.concepto, 2);
  assert.equal(s.servDesde, '2026-12-13');
  assert.equal(s.vtoPago, '2026-11-21');
  assert.match(s.items[0].desc, /^Seña servicio de catering del 13\/12\/2026 \(80 personas\) · Casamiento Pérez$/);
  assert.match(xmlDetalle({ ...s, nro: 5 }), /<Concepto>2<\/Concepto>.*<FchServDesde>20261213<\/FchServDesde>.*<CondicionIVAReceptorId>5<\/CondicionIVAReceptorId>/);

  const p = armarComprobante({ id: 2, fecha: '2026-11-23', desc: 'Andrea x10', monto: 145000, ventaId: 20, cuenta: 'thiago', medio: 'mp' }, ctx);
  assert.equal(p.concepto, 1);
  assert.deepEqual(p.items.map((i) => [i.cant, i.precio]), [[10, 14000], [1, 5000]]);
  assert.doesNotMatch(xmlDetalle({ ...p, nro: 6 }), /FchServDesde/);
  assert.equal(
    nombreArchivo({ ...s, nro: 12 }, 'Thiago', 'Casamiento Pérez'),
    '2026-11-21 · Factura C 00003-00000012 · Thiago · Casamiento Pérez.pdf'
  );
});

test('pendientes: solo los que tienen cuenta y no están facturados', () => {
  const datos = [
    { id: 1, cuenta: 'thiago', monto: 10, fecha: '2026-11-20' },
    { id: 2, cuenta: 'juan', monto: 10, fecha: '2026-11-21' },
    { id: 3, monto: 10, fecha: '2026-11-21', medio: 'efectivo' },
    null,
    { id: 4, cuenta: 'thiago', monto: 10, fecha: '2026-11-22' },
    { id: 5, cuenta: 'juan', monto: 10, fecha: '2026-11-22', medio: 'efectivo' }
  ];
  assert.deepEqual(pendientes(datos, { 4: {} }).map((i) => i.id), [1, 2]);
  assert.deepEqual(pendientes(datos, {}, { cuenta: 'juan' }).map((i) => i.id), [2]);
});

// ARCA simulado: WSAA + WSFEv1 con numeración por punto de venta
function arcaFalso({ cortarEn } = {}) {
  const emitidos = {}; // `${cuit}-${pv}` -> [{nro, fch, total, doc}]
  let llamadasCAE = 0;
  const xml = (inner) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
  const tag = (b, t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];
  const fetchImpl = async (url, { body, headers }) => {
    const accion = headers.SOAPAction.replace(/"/g, '').split('/').pop();
    const resp = (t) => ({ status: 200, text: async () => xml(t) });
    if (url.includes('LoginCms')) {
      const ta = `<loginTicketResponse><header><expirationTime>${new Date(Date.now() + 12 * 3600e3).toISOString()}</expirationTime></header><credentials><token>TOK</token><sign>SIG</sign></credentials></loginTicketResponse>`;
      return resp(`<loginCmsResponse><loginCmsReturn>${ta.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loginCmsReturn></loginCmsResponse>`);
    }
    const k = `${tag(body, 'Cuit')}-${tag(body, 'PtoVta')}`;
    const l = (emitidos[k] ||= []);
    if (accion === 'FECompUltimoAutorizado') return resp(`<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><CbteNro>${l.length}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`);
    if (accion === 'FECompConsultar') {
      const c = l[Number(tag(body, 'CbteNro')) - 1];
      return resp(`<FECompConsultarResponse><FECompConsultarResult><ResultGet><CbteFch>${c.fch}</CbteFch><ImpTotal>${c.total}</ImpTotal><DocNro>${c.doc}</DocNro><CodAutorizacion>7${c.nro}</CodAutorizacion><FchVto>20261204</FchVto></ResultGet></FECompConsultarResult></FECompConsultarResponse>`);
    }
    if (accion === 'FECAESolicitar') {
      llamadasCAE++;
      const nro = Number(tag(body, 'CbteDesde'));
      if (nro !== l.length + 1) return resp(`<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>no es el proximo</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
      l.push({ nro, fch: tag(body, 'CbteFch'), total: tag(body, 'ImpTotal'), doc: tag(body, 'DocNro') });
      if (cortarEn === llamadasCAE) throw new Error('socket hang up');
      return resp(`<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>7${nro}000000000</CAE><CAEFchVto>20261204</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
    }
    throw new Error('acción desconocida ' + accion);
  };
  return { fetchImpl, emitidos };
}

function storeFalso(datos) {
  const db = { datos, catering: [EVENTO], pizzas: { ventas: [VENTA] }, facturacion: { emisores: { thiago: EMISOR, juan: { ...EMISOR, cuit: '20222222223' } } }, facturas_homo: {} };
  let ta = null;
  return {
    db,
    leer: async (n) => db[n],
    reclamar: async (id, d) => (db.facturas_homo[id] ? false : ((db.facturas_homo[id] = d), true)),
    guardar: async (id, d) => void (db.facturas_homo[id] = d),
    borrar: async (id) => void delete db.facturas_homo[id],
    cacheTicket: { leer: async () => ta, guardar: async (t) => void (ta = t) }
  };
}

const DATOS = [
  { id: 1, fecha: '2026-11-21', desc: 'Seña · Casamiento Pérez', monto: 250000, eventoId: 10, tipo: 'seña', cuenta: 'thiago', medio: 'mp' },
  { id: 2, fecha: '2026-11-23', desc: 'Andrea x10', monto: 145000, ventaId: 20, cuenta: 'thiago', medio: 'mp' },
  { id: 3, fecha: '2026-11-24', desc: 'Caro x6', monto: 86000, cuenta: 'juan', medio: 'mp' }
];

test('facturar: vista previa no emite; emitir numera por cuenta y no repite', async () => {
  const arca = arcaFalso();
  const store = storeFalso(structuredClone(DATOS));
  const o = { entorno: 'homo', ...CRED, store, fetchImpl: arca.fetchImpl, ahora: new Date('2026-11-24T15:00:00Z') };
  const vista = await facturar([1, 2, 3], o);
  assert.ok(vista.every((r) => r.ok && r.vistaPrevia));
  assert.deepEqual(store.db.facturas_homo, {});

  const res = await facturar([2, 1, 3], { ...o, emitir: true });
  assert.ok(res.every((r) => r.ok), JSON.stringify(res));
  const f = store.db.facturas_homo;
  assert.deepEqual([f[1].nro, f[2].nro, f[3].nro], [1, 2, 1]); // por fecha dentro de cada cuenta
  assert.equal(f[1].fecha, '2026-11-21');
  assert.equal(f[3].cuit, '20222222223');

  const otra = await facturar([1], { ...o, emitir: true });
  assert.equal(otra[0].ok, false);
  assert.match(otra[0].error, /Ya está facturado/);

  writeFileSync(join(process.env.PDF_DIR || tmpdir(), 'factura-prueba.pdf'), res[0].pdf);
});

test('facturar: si se corta la conexión después de emitir, recupera el CAE en vez de duplicar', async () => {
  const arca = arcaFalso({ cortarEn: 1 });
  const store = storeFalso(structuredClone(DATOS));
  const res = await facturar([1], { entorno: 'homo', ...CRED, store, fetchImpl: arca.fetchImpl, emitir: true, ahora: new Date('2026-11-24T15:00:00Z') });
  assert.equal(res[0].ok, true);
  assert.equal(store.db.facturas_homo[1].cae, '71');
  assert.equal(arca.emitidos['20111111112-1'].length, 1);
});

test('el QR lleva los datos que pide ARCA', () => {
  const u = urlQR({ fecha: '2026-11-24', cuit: '20111111112', ptoVta: 3, cbteTipo: 11, nro: 12, total: 86000, docTipo: 99, docNro: '0', cae: '76123456789012' });
  const j = JSON.parse(Buffer.from(u.split('p=')[1], 'base64').toString());
  assert.deepEqual([j.ver, j.cuit, j.tipoCmp, j.nroCmp, j.importe, j.tipoCodAut, j.codAut], [1, 20111111112, 11, 12, 86000, 'E', 76123456789012]);
});

test('el PDF se genera', async () => {
  const c = armarComprobante(DATOS[0], { catering: [EVENTO], emisor: EMISOR, hoy: '2026-11-24' });
  const pdf = await generarPDF({ ...c, nro: 12, cae: '76123456789012', caeVto: '2026-12-04' }, EMISOR, { homologacion: true });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
