// Cloud Function `facturar`: la llama la app (botón Facturar). Requiere el plan Blaze de Firebase.
//
// Entrada: { ids: [idIngreso, ...], emitir: boolean }
//   emitir=false devuelve la vista previa; emitir=true pide los CAE.
// El entorno (homo/prod) sale de `facturacion.entorno` en la base: mientras no diga 'prod', todo va a homologación.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { facturar, nodoFacturas } from './lib/facturador.js';
import { driveAppsScript } from './lib/drive.js';

initializeApp();

const ARCA_CRT = defineSecret('ARCA_CRT');
const ARCA_KEY = defineSecret('ARCA_KEY');
const ARCA_HOMO_CRT = defineSecret('ARCA_HOMO_CRT');
const ARCA_HOMO_KEY = defineSecret('ARCA_HOMO_KEY');
const DRIVE_URL = defineSecret('DRIVE_URL');
const DRIVE_SECRETO = defineSecret('DRIVE_SECRETO');

const pem = (v) => {
  v = (v || '').replace(/\\n/g, '\n').trim();
  return v.includes('-----BEGIN') ? v : Buffer.from(v, 'base64').toString('utf8');
};

function storeAdmin(db, entorno) {
  const nodo = nodoFacturas(entorno);
  const ref = (id) => db.ref(`${nodo}/${id}`);
  const taRef = db.ref(`_arca/ticket_${entorno}`);
  return {
    leer: async (n) => (await db.ref(n).get()).val(),
    async reclamar(id, datos) {
      const r = await ref(id).transaction((actual) => (actual === null ? datos : undefined));
      return r.committed;
    },
    guardar: (id, datos) => ref(id).set(datos),
    borrar: (id) => ref(id).remove(),
    cacheTicket: { leer: async () => (await taRef.get()).val(), guardar: (ta) => taRef.set(ta) }
  };
}

export const facturarIngresos = onCall(
  {
    region: 'southamerica-east1',
    secrets: [ARCA_CRT, ARCA_KEY, ARCA_HOMO_CRT, ARCA_HOMO_KEY, DRIVE_URL, DRIVE_SECRETO],
    timeoutSeconds: 300,
    maxInstances: 1, // una sola a la vez: la numeración de ARCA es correlativa
    concurrency: 1
  },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Iniciá sesión en Bardo');
    const ids = Array.isArray(req.data?.ids) ? req.data.ids.slice(0, 50) : [];
    if (!ids.length) throw new HttpsError('invalid-argument', 'Elegí al menos un cobro');

    const db = getDatabase();
    const config = (await db.ref('facturacion').get()).val() || {};
    const entorno = config.entorno === 'prod' ? 'prod' : 'homo';
    const certPem = pem(entorno === 'prod' ? ARCA_CRT.value() : ARCA_HOMO_CRT.value());
    const keyPem = pem(entorno === 'prod' ? ARCA_KEY.value() : ARCA_HOMO_KEY.value());
    // si un secreto quedó mal cargado, decir cuál y con qué empieza (la primera línea no es secreta)
    const sufijo = entorno === 'prod' ? '' : '_HOMO';
    const cabecera = (v) => (v.match(/-----BEGIN [A-Z ]+-----/) || ['(no es un PEM)'])[0];
    if (!/-----BEGIN CERTIFICATE-----/.test(certPem)) {
      throw new HttpsError('failed-precondition', `El secreto ARCA${sufijo}_CRT no es el certificado: empieza con ${cabecera(certPem)}`);
    }
    if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(keyPem)) {
      throw new HttpsError('failed-precondition', `El secreto ARCA${sufijo}_KEY no es la clave privada: empieza con ${cabecera(keyPem)}`);
    }

    try {
      const res = await facturar(ids, {
        entorno,
        certPem,
        keyPem,
        store: storeAdmin(db, entorno),
        drive: driveAppsScript({ url: DRIVE_URL.value(), secreto: DRIVE_SECRETO.value() }),
        emitir: req.data?.emitir === true
      });
      // los PDF quedan en Drive; a la app no le mandamos los bytes
      return { entorno, resultados: res.map(({ pdf, ...r }) => r) };
    } catch (e) {
      throw new HttpsError('internal', e.message);
    }
  }
);
