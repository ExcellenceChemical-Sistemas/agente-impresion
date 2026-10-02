import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CONFIG } from './config';

const execFileAsync = promisify(execFile);
const SCRIPT_IMPRESION = path.join(__dirname, '..', 'scripts', 'imprimir-etiqueta.ps1');

export async function imprimir(pngBuffer: Buffer, paperSize: string): Promise<void> {
  const rutaTemp = path.join(os.tmpdir(), `etiqueta-${Date.now()}.png`);
  await fs.writeFile(rutaTemp, pngBuffer);

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_IMPRESION,
      '-ImagePath', rutaTemp, '-PrinterName', CONFIG.printerName, '-PaperSizeName', paperSize,
    ]);

    // El script es verboso a propósito (DPI, tamaño de papel resuelto, reintentos de lectura...)
    // para poder diagnosticar un problema real — pero volcarlo entero en cada impresión exitosa
    // es ruido puro con volumen alto de etiquetas. Solo se guarda completo cuando algo falló;
    // index.ts ya loguea una línea por trabajo impreso OK.
    if (!stdout.includes('IMPRESION_OK')) {
      throw new Error(stdout.trim() || 'el script no confirmó la impresión');
    }
  } finally {
    await fs.unlink(rutaTemp).catch(() => {});
  }
}