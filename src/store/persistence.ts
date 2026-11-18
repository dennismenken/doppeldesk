import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errorMessage, StartupError } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";
import { isPlainObject } from "../lib/object.ts";
import { parseSnapshot } from "../tenant/snapshot.ts";
import type { TenantSnapshot } from "../tenant/tenant.ts";

const WRITE_DELAY_MS = 250;
const STATE_FILE_VERSION = 1;

/**
 * File persistence for DOPPELDESK_PERSIST=file: all tenants in <dataDir>/state.json.
 * Writes are debounced after changes and atomic (temp file + rename).
 */
export class FilePersistence {
  readonly path: string;
  readonly #tempPath: string;
  readonly #log: Logger;
  readonly #collect: () => Record<string, TenantSnapshot>;
  #timer: NodeJS.Timeout | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(options: { dataDir: string; log: Logger; collect: () => Record<string, TenantSnapshot> }) {
    this.path = join(options.dataDir, "state.json");
    this.#tempPath = `${this.path}.tmp`;
    this.#log = options.log;
    this.#collect = options.collect;
  }

  /**
   * Reads state.json; an absent file yields no tenants, an unreadable or corrupt one fails
   * startup. Persistence was asked for explicitly, so a data directory that cannot be
   * created or written fails startup as well instead of losing every later change.
   */
  async load(): Promise<Record<string, TenantSnapshot>> {
    await this.#assertWritable();
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isPlainObject(error) && error.code === "ENOENT") return {};
      throw new StartupError(`State file ${this.path} could not be read: ${errorMessage(error)}`);
    }
    const tenants = this.#parse(text);
    this.#log.info({ path: this.path, tenants: Object.keys(tenants).length }, "State loaded");
    return tenants;
  }

  /** Creates the data directory and probes the write path of #write() (temp file, then removed). */
  async #assertWritable(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.#tempPath, "", "utf8");
      await rm(this.#tempPath);
    } catch (error) {
      throw new StartupError(`Data directory ${dirname(this.path)} is not writable: ${errorMessage(error)}`);
    }
  }

  #parse(text: string): Record<string, TenantSnapshot> {
    const corrupt = (reason: string) => new StartupError(`State file ${this.path} is corrupt: ${reason}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw corrupt(errorMessage(error));
    }
    if (!isPlainObject(parsed) || parsed.version !== STATE_FILE_VERSION || !isPlainObject(parsed.tenants)) {
      throw corrupt(`not a DoppelDesk state file (version ${STATE_FILE_VERSION})`);
    }
    const tenants: Record<string, TenantSnapshot> = {};
    for (const [token, snapshot] of Object.entries(parsed.tenants)) {
      try {
        tenants[token] = parseSnapshot(snapshot, "1");
      } catch (error) {
        throw corrupt(`invalid tenant snapshot (${errorMessage(error)})`);
      }
    }
    return tenants;
  }

  /** Schedules a debounced write. */
  markDirty(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#write();
    }, WRITE_DELAY_MS);
  }

  /** Writes pending changes immediately (shutdown). */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      await this.#write();
    }
    await this.#writing;
  }

  #write(): Promise<void> {
    this.#writing = this.#writing.then(async () => {
      const content = JSON.stringify({ version: STATE_FILE_VERSION, tenants: this.#collect() });
      try {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.#tempPath, content, "utf8");
        await rename(this.#tempPath, this.path);
      } catch (error) {
        this.#log.error({ err: error, path: this.path }, "Could not write state file");
      }
    });
    return this.#writing;
  }
}
