#!/usr/bin/env node
// Acceso a los datos de Bardo (Firebase Realtime Database) desde la terminal,
// con el mismo login por email y contraseña que usa la app.
//
// Uso:
//   node scripts/bardo.mjs get <nodo>             imprime el JSON del nodo
//   node scripts/bardo.mjs put <nodo> <archivo>   reemplaza el nodo con el JSON del archivo
//
// Nodos: datos (ingresos), pizzas, pedidos, metas, catering, precios, gastos.
// Antes de cada `put` se guarda una copia del nodo en .bardo-backups/.
//
// Lee BARDO_EMAIL y BARDO_PASSWORD del entorno.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = 'https://objetivo-julio-default-rtdb.firebaseio.com/';
const API_KEY = 'AIzaSyD2G8mlV3QGbTswwXuFQIC8Q5vq0LBtqug';
const NODOS = ['datos', 'pizzas', 'pedidos', 'metas', 'catering', 'precios', 'gastos'];
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// el fetch de Node solo usa HTTPS_PROXY con esta variable; si hay proxy y falta, nos relanzamos con ella
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

async function login() {
  const email = process.env.BARDO_EMAIL;
  const password = process.env.BARDO_PASSWORD;
  if (!email || !password) salir('Faltan BARDO_EMAIL y BARDO_PASSWORD en el entorno.');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (!res.ok) salir(`No se pudo iniciar sesión: ${data.error?.message || res.status}`);
  return data.idToken;
}

async function leer(nodo, token) {
  const res = await fetch(`${DB}${nodo}.json?auth=${encodeURIComponent(token)}`);
  if (!res.ok) salir(`Error leyendo ${nodo}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function escribir(nodo, data, token) {
  const res = await fetch(`${DB}${nodo}.json?auth=${encodeURIComponent(token)}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!res.ok) salir(`Error escribiendo ${nodo}: ${res.status} ${await res.text()}`);
}

const [cmd, nodo, archivo] = process.argv.slice(2);
if (!['get', 'put'].includes(cmd) || !NODOS.includes(nodo) || (cmd === 'put' && !archivo)) {
  salir('Uso: node scripts/bardo.mjs get <nodo> | put <nodo> <archivo.json>\nNodos: ' + NODOS.join(', '));
}

const token = await login();

if (cmd === 'get') {
  console.log(JSON.stringify(await leer(nodo, token), null, 2));
} else {
  const nuevo = JSON.parse(readFileSync(archivo, 'utf8'));
  const dir = join(RAIZ, '.bardo-backups');
  mkdirSync(dir, { recursive: true });
  const copia = join(dir, `${nodo}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(copia, JSON.stringify(await leer(nodo, token), null, 2));
  await escribir(nodo, nuevo, token);
  console.log(`${nodo} actualizado. Copia anterior: ${copia}`);
}
