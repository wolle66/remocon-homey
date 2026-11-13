'use strict';

const PERIODS = { CurrentDay: 'today', CurrentMonth: 'current_month', PreviousMonth: 'previous_month' };
const GAS_SERIES = {
  heating: 'heating', heat: 'heating', ch: 'heating', gasch: 'heating',
  chgas: 'heating', gasheating: 'heating', heatinggas: 'heating',
  dhw: 'water', gasdhw: 'water', dhwgas: 'water', hotwater: 'water',
  domestichotwater: 'water', gashotwater: 'water', hotwatergas: 'water',
  centralheating: 'heating', centralheatinggas: 'heating', gascentralheating: 'heating',
  domestichotwatergas: 'water', gasdomestichotwater: 'water',
  heizen: 'heating', heizung: 'heating', warmwasser: 'water',
};

function key(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

function gasUsage(tab, series) {
  if (!['gas', 'consumedgas'].includes(key(tab))) return null;
  const id = key(series);
  return Object.hasOwn(GAS_SERIES, id) ? GAS_SERIES[id] : null;
}

function volumeValue(raw) {
  const value = typeof raw === 'string' && /^\d+(?:[.,]\d+)?$/.test(raw.trim())
    ? Number(raw.replace(',', '.')) : raw;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function dailyPoints(row) {
  return [row.items, row.data, row.values, row.value, row.points].find(Array.isArray);
}

function dailyVolume(row) {
  const points = dailyPoints(row);
  if (!Array.isArray(points) || !points.length) return null;
  let total = 0;
  let samples = 0;
  let empty = false;
  for (const point of points) {
    const raw = Array.isArray(point) && point.length === 2 ? point[1] :
      point && typeof point === 'object' ? (Object.hasOwn(point, 'value') ? point.value : point.y) : point;
    if (raw === null) {
      empty = true;
      continue;
    }
    const value = volumeValue(raw);
    if (value === null || empty) return null;
    samples += 1;
    total += value;
  }
  return samples && Number.isFinite(total) ? total : null;
}

function pointStructure(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (depth >= 4) return `Array(${value.length})`;
    const sample = value.find(item => item != null);
    return `Array(${value.length})[${pointStructure(sample, depth + 1)}]`;
  }
  if (typeof value !== 'object' || depth >= 4) return typeof value;
  return Object.entries(value)
    .filter(([field]) => /^[a-z][a-z_]{0,30}$/i.test(field))
    .slice(0, 12)
    .map(([field, item]) => `${field}:${pointStructure(item, depth + 1)}`)
    .join(',') || 'Objekt';
}

function decodeMetering(report, diagnostic = {}) {
  const values = {};
  const root = report?.data ?? report;
  const volume = root?.asPhysicalUnit;
  const rows = volume?.donutData;
  diagnostic.volume = Array.isArray(rows) ? `donutData: ${rows.length} Einträge` :
    `donutData: ${rows === undefined ? 'fehlt' : typeof rows}`;
  const labels = value => typeof value === 'string' &&
    /^[a-z0-9 _-]{1,40}$/i.test(value) && !/\d{5}/.test(value)
    ? value : '?';
  const identify = list => [...new Set(list.slice(0, 40).flatMap(row => {
    const parts = Array.isArray(row?.series) ? row.series.slice(0, 8) : [row];
    return parts.map(part => [row?.tab, row?.period,
      part?.series ?? part?.name ?? part?.id].map(labels).join('/'));
  }))].slice(0, 8).join(', ') || 'keine';
  diagnostic.series = `Summen: ${identify(Array.isArray(rows) ? rows : [])}`;
  const histogram = volume?.histogramData;
  diagnostic.histogram = Array.isArray(histogram)
    ? `Zeitreihen: ${identify(histogram)}` : 'Zeitreihen: fehlen oder kein Array';

  for (const row of Array.isArray(rows) ? rows : []) {
    const period = Object.hasOwn(PERIODS, row?.period) ? PERIODS[row.period] : null;
    if (!period) continue;
    const parts = Array.isArray(row.series) ? row.series : [row];
    for (const part of parts) {
      const usage = gasUsage(row.tab, part?.series ?? part?.name ?? part?.id);
      const value = volumeValue(part?.value ?? part?.total);
      if (usage && value !== null) values[`gas_${usage}_${period}_volume`] = value;
    }
  }
  const daily = Array.isArray(histogram) ? histogram.filter(row =>
    row?.period === 'CurrentDay' && gasUsage(row.tab, row.series)) : [];
  for (const usage of ['heating', 'water']) {
    const id = `gas_${usage}_today_volume`;
    if (Object.hasOwn(values, id)) continue;
    const matches = daily.filter(row => gasUsage(row.tab, row.series) === usage);
    if (matches.length !== 1) continue;
    const value = dailyVolume(matches[0]);
    if (value !== null) values[id] = value;
  }
  diagnostic.recognized = Object.keys(values).length;
  diagnostic.layout = daily.slice(0, 4).map(row => {
    const payload = { ...row };
    delete payload.tab;
    delete payload.period;
    delete payload.series;
    return `Tagesstruktur ${gasUsage(row.tab, row.series)}: ${pointStructure(payload).slice(0, 240)}`;
  }).join(' | ');
  return values;
}

class Metering {
  constructor(request, username, password) {
    this.request = request;
    this.username = username;
    this.password = password;
    this.cookies = new Map();
  }

  async send(path, body, referer) {
    const response = await this.request(path, body, this.cookies, referer);
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }

  async login() {
    this.cookies.clear();
    const response = await this.send('/R2/Account/Login');
    const html = await response.text();
    const token = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i)?.[1];
    if (!token || !/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
      throw new Error('RemoconNet-Webanmeldung lieferte kein gültiges Anmeldefeld.');
    }
    this.cookies.set('__formRequestVerificationToken', token);
    const result = await this.send('/R2/Account/Login', {
      email: this.username, password: this.password, rememberMe: false, language: 'German_De',
    }, '/R2/Account/Login');
    if ((await result.json())?.ok !== true) throw new Error('RemoconNet-Webanmeldung fehlgeschlagen.');
    this.authenticated = true;
  }

  async read(gateway, diagnostic) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      diagnostic.step = 'Webanmeldung';
      if (!this.authenticated) await this.login();
      diagnostic.step = 'Anlagenmerkmale';
      try {
        const response = await this.send(`/R2/Plant/Features/${gateway}?eagerMode=true`);
        const payload = await response.json();
        const features = payload?.data ?? payload;
        if (!features || typeof features !== 'object' || Array.isArray(features)) {
          throw new Error('RemoconNet meldet keine Anlagenmerkmale.');
        }
        diagnostic.step = 'Verbrauchsbericht';
        const metering = await this.send(`/R2/PlantMetering/GetData/${gateway}`, {
          features, hasCooling: false,
        }, `/R2/Plant/Index/${gateway}`);
        return decodeMetering(await metering.json(), diagnostic);
      } catch (error) {
        if (attempt || ![302, 401, 403].includes(error.status) && !(error instanceof SyntaxError)) throw error;
        this.authenticated = false;
      }
    }
  }
}

module.exports = { Metering, decodeMetering };
