#!/usr/bin/env node
// Factura C en ARCA desde la terminal, contra HOMOLOGACIÓN (testing). Producción se emite desde la app.
//
// Uso:
//   node scripts/arca.mjs dummy                           ¿responde ARCA?
//   node scripts/arca.mjs pendientes [--desde YYYY-MM-DD] [--hasta YYYY-MM-DD] [--cuenta thiago|juan]
//   node scripts/arca.mjs facturar <id> [<id>...]         vista previa (no emite)
//   node scripts/arca.mjs facturar --semana               vista previa de lo pendiente de los últimos 7 días
//   node scripts/arca.mjs facturar ... --emitir           emite en homologación
//   node scripts/arca.mjs ultimo <cuenta>                 último número autorizado del punto de venta
//
// Entorno: BARDO_EMAIL, BARDO_PASSWORD, ARCA_HOMO_CRT y ARCA_HOMO_KEY (el PEM, o el PEM en base64).
// Los datos del emisor (CUIT, punto de venta, razón social…) salen del nodo `facturacion` de Bardo.
// Las facturas de prueba quedan en `facturas_homo` y los PDF en .facturas/ (ignorado por git).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { facturar, pendientes, emisorDe, nodoFacturas } from '../functions/lib/facturador.js';
import { hoyArgentina, sumarDias, numeroLegible, CONCEPTOS } from '../functions/lib/comprobante.js';
import { dummy, ultimoAutorizado } from '../functions/lib/wsfe.js';
import { ticket } from '../functions/lib/wsaa.js';

const DB = 'https://objetivo-julio-default-rtdb.firebaseio.com/';
const API_KEY = 'AIzaSyD2G8mlV3QGbTswwXuFQIC8Q5vq0LBtqug';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTORNO = 'homo';

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], {
    stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' }
  });
  process.exit(r.status ?? 1);
}

function salir(msg) {
  console.error(msg);
  process.exit(1);
}

function pem(nombre) {
  let v = process.env[nombre];
  if (!v) salir(`Falta ${nombre} en el entorno (certificado de homologación). Ver docs/facturacion-arca.md`);
  v = v.replace(/\\n/g, '\n').trim();
  if (!v.includes('-----BEGIN')) v = Buffer.from(v, 'base64').toString('utf8');
  return v;
}

async function login() {
  const { BARDO_EMAIL: email, BARDO_PASSWORD: password } = process.env;
  if (!email || !password) salir('Faltan BARDO_EMAIL y BARDO_PASSWORD en el entorno.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const d = await res.json();
  if (!res.ok) salir(`No se pudo iniciar sesión en Bardo: ${d.error?.message || res.status}`);
  return d.idToken;
}

function storeBardo(token) {
  const url = (ruta) => `${DB}${ruta}.json?auth=${encodeURIComponent(token)}`;
  const nodo = nodoFacturas(ENTORNO);
  const pedir = async (ruta, init = {}) => {
    const res = await fetch(url(ruta), init);
    if (!res.ok && res.status !== 412) salir(`Error en Bardo (${ruta}): ${res.status} ${await res.text()}`);
    return res;
  };
  const cacheArchivo = join(RAIZ, '.arca', `ticket-${ENTORNO}.json`);
  return {
    leer: async (n) => (await pedir(n)).json(),
    // escribe solo si no existe (ETag de Firebase): dos personas no pueden reservar el mismo ingreso
    async reclamar(id, datos) {
      const r = await pedir(`${nodo}/${id}`, { headers: { 'X-Firebase-ETag': 'true' } });
      if ((await r.json()) !== null) return false;
      const w = await pedir(`${nodo}/${id}`, { method: 'PUT', headers: { 'if-match': r.headers.get('etag') }, body: JSON.stringify(datos) });
      return w.status !== 412;
    },
    guardar: async (id, datos) => void (await pedir(`${nodo}/${id}`, { method: 'PUT', body: JSON.stringify(datos) })),
    borrar: async (id) => void (await pedir(`${nodo}/${id}`, { method: 'DELETE' })),
    cacheTicket: {
      leer: async () => (existsSync(cacheArchivo) ? JSON.parse(readFileSync(cacheArchivo, 'utf8')) : null),
      guardar: async (ta) => {
        mkdirSync(dirname(cacheArchivo), { recursive: true });
        writeFileSync(cacheArchivo, JSON.stringify(ta), { mode: 0o600 });
      }
    }
  };
}

const pesos = (n) => '$' + Number(n).toLocaleString('es-AR');
function opcion(args, nombre) {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'dummy') {
    console.log(await dummy({ entorno: ENTORNO }));
    return;
  }
  if (!['pendientes', 'facturar', 'ultimo'].includes(cmd)) salir('Comandos: dummy, pendientes, facturar, ultimo (ver el encabezado del script).');

  const store = storeBardo(await login());

  if (cmd === 'pendientes') {
    const [datos, facturas] = await Promise.all([store.leer('datos'), store.leer(nodoFacturas(ENTORNO))]);
    const l = pendientes(datos, facturas, { desde: opcion(args, '--desde'), hasta: opcion(args, '--hasta'), cuenta: opcion(args, '--cuenta') });
    for (const cuenta of ['thiago', 'juan']) {
      const de = l.filter((i) => i.cuenta === cuenta);
      console.log(`\n${cuenta.toUpperCase()}: ${de.length} cobros · ${pesos(de.reduce((s, i) => s + Number(i.monto), 0))}`);
      for (const i of de) console.log(`  ${i.id}  ${i.fecha}  ${pesos(i.monto).padStart(11)}  ${i.desc}`);
    }
    return;
  }

  const certPem = pem('ARCA_HOMO_CRT');
  const keyPem = pem('ARCA_HOMO_KEY');

  if (cmd === 'ultimo') {
    const emisor = emisorDe(await store.leer('facturacion'), args[0], ENTORNO);
    if (!emisor) salir(`No hay datos de facturación para "${args[0]}"`);
    const ta = await ticket({ entorno: ENTORNO, certPem, keyPem, cache: store.cacheTicket });
    const n = await ultimoAutorizado({ entorno: ENTORNO, credenciales: { ...ta, cuit: emisor.cuit }, ptoVta: emisor.ptoVta });
    console.log(`Último Factura C autorizado en PV ${emisor.ptoVta}: ${n}`);
    return;
  }

  // facturar
  let ids = args.filter((a) => /^\d+$/.test(a));
  if (args.includes('--semana')) {
    const [datos, facturas] = await Promise.all([store.leer('datos'), store.leer(nodoFacturas(ENTORNO))]);
    ids = pendientes(datos, facturas, { desde: sumarDias(hoyArgentina(), -7) }).map((i) => i.id);
  }
  if (!ids.length) salir('No hay ingresos para facturar.');
  const emitir = args.includes('--emitir');
  const res = await facturar(ids, { entorno: ENTORNO, certPem, keyPem, store, emitir });

  const dir = join(RAIZ, '.facturas', ENTORNO);
  for (const r of res) {
    if (!r.ok) {
      console.log(`✗ ${r.id}: ${r.error}`);
      continue;
    }
    const c = r.comprobante;
    const cab = `${c.cuenta} · ${c.fecha} · ${CONCEPTOS[c.concepto]} · ${c.nombre} · ${pesos(c.total)}`;
    if (r.vistaPrevia) {
      console.log(`• ${r.id}: ${cab}\n    ${c.items.map((i) => `${i.cant} × ${i.desc} (${pesos(i.precio)})`).join('\n    ')}`);
      continue;
    }
    let extra = '';
    if (r.pdf) {
      mkdirSync(dir, { recursive: true });
      const archivo = join(dir, `${c.fecha} ${c.cuenta} ${numeroLegible(c.ptoVta, c.nro)}.pdf`);
      writeFileSync(archivo, r.pdf);
      extra = `\n    PDF: ${archivo}`;
    }
    if (r.errorPdf) extra += `\n    (no se pudo generar o subir el PDF: ${r.errorPdf})`;
    console.log(`✓ ${r.id}: Factura C ${r.factura.numero} · CAE ${r.factura.cae} (vence ${r.factura.caeVto}) · ${cab}${extra}`);
  }
  if (!emitir) console.log('\nVista previa: no se emitió nada. Agregá --emitir para emitir en homologación.');
}

main().catch((e) => salir(e.message));
