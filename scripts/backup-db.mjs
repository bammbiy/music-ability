// Copies the live SQLite database to a dated file, safe while the server runs.
// Usage: npm run backup [-- <directory>]   (default: data/backups)

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { backupDatabase, closeDatabase } from "../server/store.js";

const directory = resolve(process.argv[2] || join(process.cwd(), "data", "backups"));
mkdirSync(directory, { recursive: true });
const target = join(directory, `music-ability-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
backupDatabase(target);
closeDatabase();
console.log(`Backup written to ${target}`);
