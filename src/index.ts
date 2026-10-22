import { CONFIG } from './config';
import {
  obtenerPendientes,
  reportarEstado,
  reportarEstadoAgente,
  obtenerVistasPrevias,
  enviarVistaPrevia,
  fallarVistaPrevia,
  verificarConexion,
  type TrabajoPendiente,
} from './cliente-backend';
import { generarImagen, formatoDe } from './etiqueta-generator';
import { imprimir } from './imprimir';
import { bloqueaImpresion, leerEstadoImpresora, type EstadoImpresora } from './estado-impresora';

const INTERVALO_ESTADO_MS = 15000;

function aEtiqueta(trabajo: Omit<TrabajoPendiente, 'id'>) {
  return {
    producto: trabajo.producto,
    numeroLote: trabajo.numeroLote,
    fabricante: trabajo.fabricante,
    fechaFabricacion: trabajo.fechaFabricacion,
    fechaVencimiento: trabajo.fechaVencimiento,
    pesoBruto: trabajo.pesoBruto,
    unidadBruto: trabajo.unidadBruto,
    cantidadNeta: trabajo.cantidadNeta,
    unidadNeta: trabajo.unidadNeta,
    tara: trabajo.tara,
    proforma: trabajo.proforma,
    nfpaSalud: trabajo.nfpaSalud,
    nfpaInflamabilidad: trabajo.nfpaInflamabilidad,
    nfpaReactividad: trabajo.nfpaReactividad,
    qrUrl: trabajo.qrUrl,
    coaValidado: trabajo.coaValidado,
    proveedor: trabajo.proveedor,
    codigo: trabajo.codigo,
    fechaIngreso: trabajo.fechaIngreso,
  };
}

// --- Estado de la impresora: se avisa al backend cada pocos segundos ---

let ultimoBloqueo = '';

// true mientras se está generando/imprimiendo un trabajo. estado-impresora.ps1
// (System.Printing.LocalPrintServer) e imprimir-etiqueta.ps1
// (System.Drawing.Printing.PrintDocument) acceden los dos a la cola de
// impresión de Windows del mismo driver Epson: si el ciclo de estado
// independiente (cada 15s) dispara un powershell.exe de estado mientras el de
// impresión sigue activo (ej. al imprimir 2+ copias seguidas), la cola queda
// ocupada y el de estado se cuelga hasta el timeout de 15s → "Command failed".
// Este flag evita que ambos corran al mismo tiempo.
let ocupado = false;

async function avisarEstado(): Promise<EstadoImpresora> {
  const estado = await leerEstadoImpresora();
  await reportarEstadoAgente(estado).catch((e: any) =>
    console.error('[agente] no se pudo avisar el estado al backend:', e.message),
  );
  return estado;
}

async function ciclosDeEstado() {
  try {
    if (!ocupado) await avisarEstado();
  } finally {
    setTimeout(ciclosDeEstado, INTERVALO_ESTADO_MS);
  }
}

// --- Cola de impresión ---

async function procesarPendientes() {
  const pendientes = await obtenerPendientes();
  if (pendientes.length === 0) {
    ultimoBloqueo = '';
    return;
  }

  // Si la impresora no puede imprimir (sin papel, sin tinta, tapa abierta...) los
  // trabajos se dejan PENDIENTES: así no se marcan como error ni se pierden, y se
  // imprimen solos cuando se resuelva.
  const estado = await avisarEstado();
  const bloqueos = bloqueaImpresion(estado);
  if (bloqueos.length > 0) {
    const resumen = bloqueos.map((p) => p.mensaje).join(' | ');
    if (resumen !== ultimoBloqueo) {
      console.warn(`[agente] ${pendientes.length} etiqueta(s) en espera. ${resumen}`);
      ultimoBloqueo = resumen;
    }
    return;
  }
  ultimoBloqueo = '';

  ocupado = true;
  try {
    for (const trabajo of pendientes) {
      try {
        const imagen = await generarImagen(trabajo.plantillaArchivo, aEtiqueta(trabajo));
        await imprimir(imagen, formatoDe(trabajo.plantillaArchivo).paperSize);
        await reportarEstado(trabajo.id, 'IMPRESO');
        console.log(`[agente] trabajo ${trabajo.id} impreso OK`);
      } catch (error: any) {
        console.error(`[agente] fallo el trabajo ${trabajo.id}:`, error.message);
        await reportarEstado(trabajo.id, 'ERROR', error.message).catch(() => {});
      }
    }
  } finally {
    ocupado = false;
  }
}

// --- Vistas previas: se dibuja la etiqueta pero NO se imprime ---

async function procesarVistasPrevias() {
  const previas = await obtenerVistasPrevias();
  for (const previa of previas) {
    try {
      const imagen = await generarImagen(previa.plantillaArchivo, aEtiqueta(previa));
      await enviarVistaPrevia(previa.id, imagen);
    } catch (error: any) {
      console.error(`[agente] fallo la vista previa ${previa.id}:`, error.message);
      await fallarVistaPrevia(previa.id, error.message).catch(() => {});
    }
  }
}

// Con el backend caído o mal configurado el mismo error saldría cada 3s y taparía
// la consola: se muestra al cambiar, y de nuevo cada minuto mientras siga igual.
const ultimoError = new Map<string, { mensaje: string; en: number }>();

function registrarError(clave: string, texto: string, error: any) {
  const previo = ultimoError.get(clave);
  const ahora = Date.now();
  if (!previo || previo.mensaje !== error.message || ahora - previo.en > 60000) {
    console.error(`[agente] ${texto}:`, error.message);
    ultimoError.set(clave, { mensaje: error.message, en: ahora });
  }
}

function limpiarError(clave: string) {
  if (ultimoError.delete(clave)) console.log(`[agente] ${clave}: se restableció.`);
}

async function loop() {
  try {
    await procesarVistasPrevias();
    limpiarError('vistas previas');
  } catch (error: any) {
    registrarError('vistas previas', 'error atendiendo vistas previas', error);
  }
  try {
    await procesarPendientes();
    limpiarError('pendientes');
  } catch (error: any) {
    registrarError('pendientes', 'error consultando pendientes', error);
  } finally {
    setTimeout(loop, CONFIG.pollIntervalMs);
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// No se empieza a trabajar hasta comprobar que BACKEND_URL y AGENT_TOKEN sirven.
// Reintenta en vez de salir: con el backend dormido (Render) o sin internet basta
// con esperar, y una URL o token mal puestos quedan explicados en la consola.
async function arrancar() {
  let intentos = 0;
  let ultimo = '';
  for (;;) {
    try {
      await verificarConexion();
      break;
    } catch (error: any) {
      if (error.message !== ultimo || intentos % 6 === 0) {
        console.error(`[agente] no se puede empezar a imprimir: ${error.message}`);
        console.error('[agente] se reintenta cada 10s...');
        ultimo = error.message;
      }
      intentos++;
      await esperar(10000);
    }
  }
  console.log(`[agente] conectado a ${CONFIG.backendUrl}`);
  console.log(`[agente] iniciado, consultando cada ${CONFIG.pollIntervalMs}ms`);
  ciclosDeEstado();
  loop();
}

arrancar();
