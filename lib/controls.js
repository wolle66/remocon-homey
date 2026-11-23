'use strict';

const PROGRAMS = { manual: 2, scheduled: 3 };

function programItem(data, zone) {
  const items = (data?.data ?? data)?.items;
  return Array.isArray(items) ? items.find(item =>
    item?.id === 'ZoneMode' && Number(item.zone ?? item.zn) === zone) : undefined;
}

function decodeLockout(payload) {
  const rows = payload?.data ?? payload;
  if (!Array.isArray(rows)) throw new Error('Sperrstatus: unerwartetes Antwortformat.');
  const active = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('Sperrstatus: ungültiger Eintrag.');
    if ([true, 1, '1'].includes(row.res) || [false, 0, '0'].includes(row.blk)) continue;
    if (![false, 0, '0'].includes(row.res) || ![true, 1, '1'].includes(row.blk)) {
      throw new Error('Sperrstatus: Aktiv-/Erledigt-Kennzeichnung nicht erkannt.');
    }
    const code = String(row.code ?? '');
    if (!/^[a-z0-9 ._-]{1,30}$/i.test(code)) throw new Error('Sperrstatus: Fehlercode fehlt.');
    active.push(code);
  }
  const codes = [...new Set(active)].sort();
  return { blocked: codes.length > 0, codes: codes.join(', ') };
}

class Controls {
  constructor(client) {
    this.client = client;
  }

  async programData(id, zone) {
    const gateway = encodeURIComponent(id);
    const payload = await this.client.read(`/remote/plants/${gateway}/features`);
    const features = payload?.data ?? payload;
    if (!Array.isArray(features?.zones) || !features.zones.some(item => Number(item.num) === zone)) {
      throw new Error('Der gewählte Heizkreis wird von RemoconNet nicht angeboten.');
    }
    const path = `/remote/dataItems/${gateway}`;
    const data = await this.client.read(`${path}/get?umsys=si`, {
      useCache: false, items: [{ id: 'ZoneMode', zn: zone }], features, culture: 'de-DE',
    });
    const item = programItem(data, zone);
    const value = item?.value;
    if (value == null || !Number.isInteger(Number(value))) throw new Error('Heizkreis meldet keine gültige Steuerung.');
    return { path, features, item, value: Number(value) };
  }

  async getProgram(id, zone) {
    const { value } = await this.programData(id, zone);
    return Object.keys(PROGRAMS).find(mode => PROGRAMS[mode] === value) ?? 'other';
  }

  async setProgram(id, zone, mode) {
    if (!Object.hasOwn(PROGRAMS, mode)) throw new Error('Ungültige Steuerung.');
    const current = await this.programData(id, zone);
    const value = PROGRAMS[mode];
    if (current.value === value) return;
    if (!Array.isArray(current.item.options) || !current.item.options.some(option => Number(option) === value)) {
      throw new Error('Diese Steuerung wird für den Heizkreis nicht angeboten.');
    }
    try {
      await this.client.request(`${current.path}/set?umsys=si`, {
        items: [{ id: 'ZoneMode', zone, value, prevValue: current.value }], features: current.features,
      });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 3000));
      if (Date.now() < this.client.retryAt) break;
      try {
        if (await this.getProgram(id, zone) === mode) return;
      } catch (error) {
        if ([401, 403].includes(error.status)) throw error;
      }
    }
    throw new Error('Die Steuerung wurde noch nicht bestätigt.');
  }

  async getLockout(id) {
    return decodeLockout(await this.client.read(
      `/busErrors?gatewayId=${encodeURIComponent(id)}&blockingOnly=True&culture=de-DE`,
    ));
  }
}

module.exports = { Controls, decodeLockout };
