import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repository root. Kept free of any database import so modules that only touch the
 * filesystem — storage, transcode — can be loaded without a live connection.
 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
