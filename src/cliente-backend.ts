import axios from 'axios';
import { CONFIG } from './config';
import type { EstadoImpresora } from './estado-impresora';

const api = axios.create({
  baseURL: CONFIG.backendUrl,
  headers: { 'x-agent-token': CONFIG.agentToken },
  timeout: 15000,
});

export interface TrabajoPendiente {
  id: number;
  plantillaArchivo: string;
  producto: string;
  numeroLote: string;
  fabricante: string;
  fechaFabricacion: string;
  fechaVencimiento: string;
  pesoBruto: string;
  unidadBruto: string;
  cantidadNeta: string | null;
  unidadNeta: string;
  tara: string | null;
  proforma: string;
  nfpaSalud: number | null;
  nfpaInflamabilidad: number | null;
  nfpaReactividad: number | null;
  qrUrl: string | null;
  coaValidado: boolean;
  proveedor: string | null;
  codigo: string | null;
  fechaIngreso: string | null;
}

// Una URL mal puesta (p. ej. la del frontend) suele responder 200 con HTML. Sin
// este chequeo el agente lo tomaba por una lista de trabajos y no imprimía nada,
// sin avisar. Las respuestas que deben ser listas se validan antes de usarlas.
function comoLista<T>(data: unknown, ruta: string): T[] {
  if (Array.isArray(data)) return data as T[];
  const html = typeof data === 'string' && /<!doctype|<html/i.test(data.slice(0, 200));
  throw new Error(
    html
      ? `${ruta} devolvió una página web en vez de datos: BACKEND_URL (${CONFIG.backendUrl}) no apunta al backend. Debe ser la URL del backend terminada en /api, no la del frontend.`
      : `${ruta} devolvió una respuesta inesperada (se esperaba una lista).`,
  );
}

export async function obtenerPendientes(): Promise<TrabajoPendiente[]> {
  const { data } = await api.get<unknown>('/etiquetas/trabajos/pendientes');
  return comoLista<TrabajoPendiente>(data, 'La cola de impresión');
}

// Comprueba al arrancar que la configuración sirve, y si no, dice qué falla.
export async function verificarConexion(): Promise<void> {
  let salud: any;
  try {
    ({ data: salud } = await api.get<unknown>('/salud'));
  } catch (e: any) {
    if (e.response) {
      throw new Error(
        `El backend respondió ${e.response.status} en ${CONFIG.backendUrl}/salud. Si es 503, su base de datos está caída; si es 404, BACKEND_URL no es la del backend.`,
      );
    }
    throw new Error(
      `No se pudo conectar con ${CONFIG.backendUrl} (${e.code ?? e.message}). Revisa BACKEND_URL y la conexión a internet.`,
    );
  }
  if (salud?.ok !== true) {
    const html = typeof salud === 'string' && /<!doctype|<html/i.test(salud.slice(0, 200));
    throw new Error(
      html
        ? `BACKEND_URL (${CONFIG.backendUrl}) devuelve una página web: apunta al frontend y no al backend. Debe ser la URL del backend terminada en /api.`
        : `${CONFIG.backendUrl}/salud no respondió como el backend esperado.`,
    );
  }

  try {
    await obtenerPendientes();
  } catch (e: any) {
    if (e.response?.status === 401 || e.response?.status === 403) {
      throw new Error('El backend rechazó el AGENT_TOKEN. Debe ser igual al AGENT_TOKEN configurado en el backend (Render).');
    }
    throw e;
  }
}

export async function reportarEstado(id: number, estado: 'IMPRESO' | 'ERROR', mensajeError?: string) {
  await api.patch(`/etiquetas/trabajos/${id}/estado`, { estado, mensajeError });
}

// Avisa al backend que el agente está vivo y cómo está la impresora.
export async function reportarEstadoAgente(impresora: EstadoImpresora) {
  await api.post('/etiquetas/agente/estado', { impresora });
}

export type DatosVistaPrevia = Omit<TrabajoPendiente, 'id'> & { id: string };

export async function obtenerVistasPrevias(): Promise<DatosVistaPrevia[]> {
  const { data } = await api.get<unknown>('/etiquetas/vista-previa/pendientes');
  return comoLista<DatosVistaPrevia>(data, 'La cola de vistas previas');
}

export async function enviarVistaPrevia(id: string, imagen: Buffer) {
  await api.post(`/etiquetas/vista-previa/${id}/imagen`, { imagenBase64: imagen.toString('base64') }, { timeout: 30000 });
}

export async function fallarVistaPrevia(id: string, error: string) {
  await api.post(`/etiquetas/vista-previa/${id}/imagen`, { error });
}
