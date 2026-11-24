/**
 * Guarda en Google Drive los PDF de las facturas que emite Bardo.
 *
 * Instalación (una vez, con la cuenta de Google donde querés las facturas):
 *  1. script.google.com › Nuevo proyecto › pegar este archivo. Nombre: "Bardo · Facturas a Drive".
 *  2. Configuración del proyecto (engranaje) › Propiedades de la secuencia de comandos › agregar
 *     SECRETO = una clave larga inventada (ej. 40 letras y números al azar). No la compartas.
 *  3. Implementar › Nueva implementación › tipo "Aplicación web":
 *       Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario.
 *     Autorizar con tu cuenta y copiar la URL que termina en /exec.
 *  4. Pasarle a Claude la URL (no es secreta) y cargar SECRETO como secreto del environment / Firebase.
 *
 * Estructura: Facturas La Sinergia / 2026-11 / "2026-11-24 · Factura C 00003-00000012 · Thiago · Casamiento Pérez.pdf"
 * Las de homologación van a Facturas La Sinergia / PRUEBAS / 2026-11.
 */
var RAIZ = 'Facturas La Sinergia';

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var secreto = PropertiesService.getScriptProperties().getProperty('SECRETO');
    if (!secreto || p.secreto !== secreto) return json({ ok: false, error: 'no autorizado' });
    if (!/^(PRUEBAS\/)?\d{4}-\d{2}$/.test(p.carpeta)) return json({ ok: false, error: 'carpeta inválida' });
    if (!/\.pdf$/.test(p.nombre || '')) return json({ ok: false, error: 'nombre inválido' });

    var carpeta = carpetaHija(DriveApp.getRootFolder(), RAIZ);
    p.carpeta.split('/').forEach(function (n) { carpeta = carpetaHija(carpeta, n); });

    // si ya existe (reintento), se reemplaza
    var viejos = carpeta.getFilesByName(p.nombre);
    while (viejos.hasNext()) viejos.next().setTrashed(true);

    var blob = Utilities.newBlob(Utilities.base64Decode(p.pdf), 'application/pdf', p.nombre);
    var archivo = carpeta.createFile(blob);
    return json({ ok: true, id: archivo.getId(), url: archivo.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function carpetaHija(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
