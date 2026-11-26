# Facturación electrónica con ARCA (Factura C)

Bardo emite las Factura C de Thiago y Juan con los web services de ARCA (WSAA + WSFEv1).
Todo se prueba primero en **homologación** (testing de ARCA, sin validez fiscal).

- Código: `functions/lib/` (ARCA, PDF, Drive), `functions/index.js` (botón de la app), `scripts/arca.mjs` (terminal, solo homologación).
- Facturas emitidas: nodo `facturas` (producción) o `facturas_homo` (pruebas), por id de ingreso. Es un nodo aparte de
  `datos` para que un guardado de la app nunca borre una factura ya emitida.
- Datos de cada emisor: nodo `facturacion` → `{ entorno: 'homo'|'prod', emisores: { thiago: {...}, juan: {...} } }`.
- PDF: Drive › `Facturas La Sinergia/2026-11/2026-11-24 · Factura C 00002-00000012 · Thiago · Casamiento Pérez.pdf`
  (las de prueba en `Facturas La Sinergia/PRUEBAS/…`).

Reglas que aplica: catering = servicios (período = día del evento), congeladas y lo demás = productos;
consumidor final salvo que el evento o el ingreso tenga `facturaA: { nombre, cuit, condIva: 'ri'|'monotributo'|'exento'|'cf', domicilio? }`;
los cobros en **efectivo** no entran (se facturan a mano en ARCA);
fecha = la del cobro si ARCA la acepta (hasta 5 días atrás productos, 10 servicios, nunca antes de la última factura), si no la más cercana.

---

## Paso a paso

### Parte A — Certificado de homologación (Thiago, ~20 min)

Necesitás clave fiscal nivel 3 y una computadora (en Mac, la app **Terminal**).

**A1. Generar la clave y el pedido de certificado.** En la Terminal (reemplazá `20XXXXXXXXX` por tu CUIT sin guiones):

```bash
mkdir -p ~/arca && cd ~/arca
openssl genrsa -out homo.key 2048
openssl req -new -key homo.key -subj "/C=AR/O=Thiago Rodriguez/CN=bardo-homo/serialNumber=CUIT 20XXXXXXXXX" -out homo.csr
cat homo.csr
```

`homo.key` es la clave privada: no se manda a nadie ni se pega en un chat.

**A2. Habilitar WSASS.** Entrá a arca.gob.ar con clave fiscal › **Administrador de Relaciones de Clave Fiscal** ›
**Adherir servicio** › ARCA › Servicios Interactivos › **WSASS - Autogestión Certificados Homologación** › Confirmar.
Salí y volvé a entrar para que aparezca en "Mis servicios".

**A3. Crear el certificado.** Entrá a **WSASS** › **Nuevo Certificado**:
- Nombre simbólico del DN: `bardohomo`
- Solicitud de certificado en formato PKCS#10: pegá todo lo que mostró `cat homo.csr` (incluidas las líneas `-----BEGIN…` y `-----END…`).
- **Crear DN y obtener certificado**. Copiá el certificado que aparece (desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`)
  y guardalo en `~/arca/homo.crt` (por ejemplo: `pbpaste > ~/arca/homo.crt` después de copiarlo).

**A4. Autorizar el servicio.** En WSASS › **Crear autorización a servicio**: elegí `bardohomo`, CUIT representada = tu CUIT,
servicio **wsfe - Facturación Electrónica** › Crear autorización de acceso.

**A5. Cargar el certificado en el environment de Claude.** En la Terminal:

```bash
base64 -i ~/arca/homo.crt | tr -d '\n' | pbcopy   # copia el certificado en una línea
```

Antes, revisá que el archivo sea el certificado: `head -1 ~/arca/homo.crt` tiene que mostrar `-----BEGIN CERTIFICATE-----`
(si muestra otra cosa, volvé a copiar el certificado desde WSASS y repetí `pbpaste > ~/arca/homo.crt`).
En claude.ai/code › environment **La Sinergia** › editar › variables de entorno: agregá `ARCA_HOMO_CRT` y pegá.
Repetí con la clave: `base64 -i ~/arca/homo.key | tr -d '\n' | pbcopy` → variable `ARCA_HOMO_KEY`.
(Son solo de prueba: con ellas no se puede facturar de verdad.)

**A6. Datos del emisor (no son secretos, salen impresos en cada factura).** Pasale a Claude, de Thiago y de Juan:
razón social como figura en ARCA, CUIT, domicilio comercial, fecha de inicio de actividades e Ingresos Brutos
(número, o si es el mismo CUIT / exento). Nombre de fantasía: La Sinergia.

### Parte B — Carpeta de Drive (~10 min)

Con la cuenta de Google donde quieran las facturas. Primero se arma la clave que comparten Firebase y el script,
en **Cloud Shell** (ver C2), dentro de `~/bardo`:

```bash
openssl rand -hex 24 | tr -d '\n' > drive_secreto.txt && cat drive_secreto.txt; echo
```

1. script.google.com › **Nuevo proyecto** › borrar lo que haya y pegar el contenido de `apps-script/drive.gs`
   (github.com/ttthez/bardo/blob/main/apps-script/drive.gs › botón de copiar). Ponerle de nombre "Bardo · Facturas a Drive" y guardar.
2. ⚙ **Configuración del proyecto** › abajo, **Propiedades de la secuencia de comandos** › **Agregar propiedad**:
   propiedad `SECRETO`, valor: la clave que mostró Cloud Shell. **Guardar propiedades de la secuencia de comandos**.
3. **Implementar** › **Nueva implementación** › ⚙ junto a "Seleccionar tipo" › **Aplicación web**.
   Ejecutar como: **Yo** · Quién tiene acceso: **Cualquier usuario** › **Implementar**.
   Autorizar con la cuenta (aparece "Google no verificó esta app": **Configuración avanzada** › **Ir a Bardo · Facturas a Drive** › **Permitir**; es tu propio script).
4. Copiar la **URL de la aplicación web** (termina en `/exec`) y cargar los dos secretos en Cloud Shell, reemplazando `URL` por la copiada:

```bash
echo -n "URL" | npx -y firebase-tools functions:secrets:set DRIVE_URL --data-file=- --project objetivo-julio
npx -y firebase-tools functions:secrets:set DRIVE_SECRETO --data-file=drive_secreto.txt --project objetivo-julio && rm drive_secreto.txt
npx -y firebase-tools deploy --only functions --project objetivo-julio
```

La función toma los secretos al publicarse: por eso el `deploy` del final. La carpeta `Facturas La Sinergia` se crea sola
con la primera factura (las de prueba, en `Facturas La Sinergia/PRUEBAS/AAAA-MM`).
Si alguna vez se cambia el código del script, hay que hacer **Implementar › Administrar implementaciones › editar › Versión nueva**
para que la URL use el código nuevo.

### Parte C — Activar el botón "Facturar" de la app (~25 min, una sola vez)

El botón está en Objetivo › **Falta facturar**. Llama a la función `facturarIngresos` (`functions/index.js`), que corre en
Firebase y es la única que tiene los certificados. Mientras `facturacion.entorno` sea `'homo'`, todo va a homologación.

**C1. Plan Blaze.** console.firebase.google.com › proyecto **objetivo-julio** › ⚙ › **Uso y facturación** ›
**Detalles y configuración** › **Modificar plan** › **Blaze** › vincular una tarjeta.
Cuando lo ofrezca, poné una **alerta de presupuesto de US$ 5**. Con el uso de ustedes queda en la capa gratuita o en centavos.

**C2. Abrir Cloud Shell.** Entrá a **console.cloud.google.com/?cloudshell=true&project=objetivo-julio** con la misma cuenta
de Google del proyecto. Abajo se abre una terminal en el navegador (no hace falta instalar nada). Pegá de a un bloque:

```bash
git clone -b facturacion-arca https://github.com/ttthez/bardo.git && cd bardo
npx -y firebase-tools@latest login --no-localhost
```
El `login` muestra un link: abrilo, elegí la cuenta, copiá el código que te da y pegalo en la terminal.

**C3. Cargar los secretos.** Cada comando pide un valor (no se ve mientras pegás, es normal) y Enter:

```bash
npx -y firebase-tools functions:secrets:set ARCA_HOMO_CRT --project objetivo-julio
npx -y firebase-tools functions:secrets:set ARCA_HOMO_KEY --project objetivo-julio
```
- `ARCA_HOMO_CRT`: en la Terminal de la Mac corré `base64 -i ~/arca/homo.crt | tr -d '\n' | pbcopy` y pegá.
- `ARCA_HOMO_KEY`: `base64 -i ~/arca/homo.key | tr -d '\n' | pbcopy` y pegá.

Los de producción y Drive todavía no existen: cargalos con la palabra `pendiente` (después se cambian con el mismo comando):

```bash
for s in ARCA_CRT ARCA_KEY DRIVE_URL DRIVE_SECRETO; do echo -n pendiente | npx -y firebase-tools functions:secrets:set $s --data-file=- --project objetivo-julio; done
```
Con `DRIVE_URL` en `pendiente` las facturas se emiten igual, sin subir el PDF a Drive (eso se suma con la Parte B).

**C4. Publicar la función.**

```bash
npx -y firebase-tools deploy --only functions --project objetivo-julio
```
Antes de publicar instala las dependencias de la función (`npm ci`, lo hace solo). La primera vez tarda unos minutos porque activa servicios de Google Cloud. Si pregunta cuántos días guardar las imágenes
de los contenedores, respondé `1`. Al final tiene que decir **Deploy complete!**. Si sale un error, copiáselo a Claude.

**C5. Probar.** En la app (con esta versión publicada): Objetivo › Falta facturar › **Facturar** en un cobro › revisar
la vista previa › **Emitir**. En modo prueba aparece "🧪 Factura de prueba 00001-0000000X" en el cobro, que sigue
pendiente porque no tiene validez fiscal.

**Después:** cada vez que cambie algo en `functions/`, se repite C2 (`git pull` en vez de `git clone`) y C4.
Un secreto se cambia repitiendo su línea de C3 y volviendo a publicar (C4).

### Parte D — Producción (cuando todo ande en homologación)

**D1. Certificado de producción (Thiago).**
```bash
cd ~/arca
openssl genrsa -out prod.key 2048
openssl req -new -key prod.key -subj "/C=AR/O=Thiago Rodriguez/CN=bardo/serialNumber=CUIT 20XXXXXXXXX" -out prod.csr
```
ARCA › **Administración de Certificados Digitales** (si no aparece, adherirlo desde el Administrador de Relaciones) ›
**Agregar alias** › alias `bardo`, subir `prod.csr` › Agregar alias › ver el alias y **descargar** el certificado (`.crt`).

**D2. Autorizar el certificado para facturar (Thiago).** **Administrador de Relaciones de Clave Fiscal** › **Nueva Relación** ›
Buscar › ARCA › WebServices › **Facturación Electrónica** › Representante: Buscar › **Computador fiscal** › alias `bardo` › Confirmar.

**D3. Punto de venta para web services (Thiago).** **Administración de Puntos de Venta y Domicilios** › tu CUIT ›
**A/B/M de Puntos de venta** › Agregar: número libre (ej. 2), nombre de fantasía La Sinergia,
sistema **"Factura Electrónica - Monotributo - Web Services"**, domicilio › Aceptar.
El punto de venta de "Comprobantes en línea" no sirve para web services.

**D4. Lo que hace Juan una sola vez con su clave fiscal (~10 min, puede ser con Thiago al lado).**
En el **Administrador de Relaciones de Clave Fiscal** de Juan:
1. **Nueva Relación** › ARCA › WebServices › **Facturación Electrónica** › Representante: CUIT de Thiago › computador fiscal `bardo` › Confirmar.
   Así el certificado de Thiago factura también para el CUIT de Juan.
2. **Nueva Relación** › ARCA › Servicios Interactivos › **Administración de Puntos de Venta y Domicilios** › Representante: CUIT de Thiago (persona) › Confirmar.

**D5. Punto de venta de Juan (Thiago).** Entrar con la clave de Thiago, elegir "representar a" Juan y repetir D3 para su CUIT.

**D6. Encender producción.** Las claves `prod.key` / `.crt` se cargan como secretos de Firebase (`ARCA_KEY`, `ARCA_CRT`, igual que en C3, y C4),
nunca en el repo ni en el environment de Claude. Claude pone `facturacion.entorno = 'prod'` **solo con confirmación explícita**.
