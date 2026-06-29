import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SERVER_JSON_DIR } from './constants.js';

export function writeAuditLog(type: string, payload: Record<string, unknown>): void {
  const dir = path.join(os.homedir(), SERVER_JSON_DIR);
  const logFile = path.join(dir, 'audit.log');

  const logEntry = {
    timestamp: new Date().toISOString(),
    type,
    ...payload,
  };

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch (error) {
    console.error(`[Pixel Agents] Failed to write to audit log: ${error}`);
  }
}
