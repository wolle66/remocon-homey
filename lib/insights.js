'use strict';

const { createHash } = require('node:crypto');

async function run(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    const status = error.statusCode ?? error.status;
    const detail = Number.isInteger(status) ? `HTTP ${status}` :
      typeof error.code === 'string' && /^[A-Z_]{1,35}$/.test(error.code) ? error.code : error.name;
    throw Object.assign(new Error(`${stage}: ${detail ?? 'Fehler'}`), { status });
  }
}

class Measurements {
  constructor(manager, gateway, name) {
    this.manager = manager;
    this.prefix = createHash('sha256').update(gateway).digest('hex').slice(0, 16);
    this.name = name;
    this.logs = new Map();
  }

  async record(capability, value, metadata) {
    let entry = this.logs.get(capability);
    if (!entry) {
      const suffix = createHash('sha256').update(capability).digest('hex').slice(0, 12);
      const id = `elco${this.prefix}${suffix}`;
      const existing = await run('Reihen abrufen', () => this.manager.getLogs());
      entry = Object.values(existing ?? {}).find(item => item?.id === id);
      if (!entry) {
        entry = await run('Reihe anlegen', () => this.manager.createLog(id, {
          ...metadata, title: `${this.name} – ${metadata.title}`,
        }));
      }
      this.logs.set(capability, entry);
    }
    await run('Messwert speichern', () => entry.createEntry(value));
  }
}

module.exports = Measurements;
