'use strict';

const { Metering } = require('./metering');

const ORIGIN = 'https://www.remocon-net.remotethermo.com';
const MINUTE = 60_000;
const MODES = { summer: 0, winter: 1, heating: 2, off: 5 };

function diagnosticError(error) {
  if (Number.isInteger(error.status)) return `HTTP ${error.status}`;
  if (error.code === 'TIMEOUT' || ['TimeoutError', 'AbortError'].includes(error.name)) {
    return 'Zeitlimit überschritten';
  }
  if (error.code === 'JSON' || error instanceof SyntaxError) return 'Antwort war kein JSON';
  if (error.code === 'NETWORK') return 'Netzwerkfehler';
  return 'Antwort konnte nicht verarbeitet werden';
}

class Remocon {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.retryAt = 0;
    this.metering = new Metering((...args) => this.fetchResponse(...args), username, password);
  }

  async fetchResponse(path, body, cookies, referer) {
    if (Date.now() < this.retryAt) throw new Error('RemoconNet bittet um eine Abfragepause.');
    const headers = {
      Accept: 'application/json',
      'Ajax-Request': 'json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (body) headers['Content-Type'] = 'application/json; charset=UTF-8';
    if (referer) {
      headers.Origin = ORIGIN;
      headers.Referer = ORIGIN + referer;
    }
    if (cookies?.size) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    if (path.startsWith('/api/v2/') && path !== '/api/v2/accounts/login' && this.token) {
      headers['ar.authToken'] = this.token;
    }
    const slowRequest = path.startsWith('/R2/PlantMetering/') || path.endsWith('/set?umsys=si');
    let response;
    try {
      response = await fetch(ORIGIN + path, {
        headers,
        method: body ? 'POST' : 'GET',
        body: body && JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(slowRequest ? 45_000 : 12_000),
      });
    } catch (error) {
      const code = ['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'NETWORK';
      throw Object.assign(new Error('RemoconNet ist derzeit nicht erreichbar.'), { code });
    }
    if (!response.ok) {
      if (response.status === 429 || response.headers.has('retry-after')) {
        const header = response.headers.get('retry-after');
        const delay = /^\d+$/.test(header ?? '') ? Number(header) * 1000 : Date.parse(header) - Date.now();
        this.retryAt = Date.now() + Math.max(15 * MINUTE, Number.isFinite(delay) ? delay : 0);
      }
      throw Object.assign(new Error(`RemoconNet meldet HTTP ${response.status}.`), { status: response.status });
    }
    return response;
  }

  async request(path, body) {
    const response = await this.fetchResponse('/api/v2' + path, body);
    try {
      return await response.json();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw Object.assign(new Error('RemoconNet hat kein gültiges JSON geliefert.'), { code: 'JSON' });
    }
  }

  async login() {
    const result = await this.request('/accounts/login', { usr: this.username, pwd: this.password });
    if (typeof result?.token !== 'string' || !result.token.trim()) {
      throw new Error('RemoconNet-Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.');
    }
    this.token = result.token;
  }

  async read(path, body) {
    if (!this.token) await this.login();
    try {
      return await this.request(path, body);
    } catch (error) {
      if (error.status !== 401) throw error;
      this.token = undefined;
      await this.login();
      return this.request(path, body);
    }
  }

  async discover() {
    for (const path of ['/remote/plants/lite', '/remote/plants']) {
      let plants;
      try {
        plants = await this.read(path);
      } catch (error) {
        if (![403, 404].includes(error.status)) throw error;
      }
      if (!Array.isArray(plants)) continue;
      const devices = plants.filter(plant => typeof plant?.gw === 'string' && plant.gw.trim());
      if (devices.length) return devices;
    }
    return [];
  }

  async checkGateway(id) {
    const features = await this.read(`/remote/plants/${encodeURIComponent(id)}/features`);
    if (!features || typeof features !== 'object' || Array.isArray(features) ||
        !Object.keys(features).length || features.ok === false) {
      throw new Error('RemoconNet hat die Anlage nicht bestätigt. Bitte Gateway-ID prüfen.');
    }
  }

  async modeData(gateway) {
    const payload = await this.read(`/remote/plants/${gateway}/features`);
    const features = payload?.data ?? payload;
    if (!features || typeof features !== 'object' || Array.isArray(features) || !Object.keys(features).length) {
      throw new Error('RemoconNet hat keine Anlagenmerkmale geliefert.');
    }
    const path = `/remote/dataItems/${gateway}`;
    const response = await this.read(`${path}/get?umsys=si`, {
      useCache: false, items: [{ id: 'PlantMode', zn: 0 }], features, culture: 'de-DE',
    });
    const item = findItem(response, 'PlantMode');
    const value = numeric(item?.value);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error('RemoconNet meldet keine gültige Betriebsart.');
    }
    return { path, features, item, value };
  }

  async getMode(id) {
    const { value } = await this.modeData(encodeURIComponent(id));
    return Object.keys(MODES).find(mode => MODES[mode] === value) ?? null;
  }

  async setMode(id, mode) {
    if (!Object.hasOwn(MODES, mode)) throw new Error('Diese Betriebsart ist nicht auswählbar.');
    const gateway = encodeURIComponent(id);
    const current = await this.modeData(gateway);
    const target = MODES[mode];
    if (current.value === target) return;
    if (Array.isArray(current.item.options) && !current.item.options.some(option => numeric(option) === target)) {
      throw new Error('RemoconNet bietet diese Betriebsart für die Anlage nicht an.');
    }

    // A request can take effect even if its response is lost. Send it only once and read back the state.
    try {
      await this.request(`${current.path}/set?umsys=si`, {
        items: [{ id: 'PlantMode', zone: 0, prevValue: current.value, value: target }],
        features: current.features,
      });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        if (await this.getMode(id) === mode) return;
      } catch (error) {
        if ([401, 403].includes(error.status)) throw error;
      }
      if (Date.now() < this.retryAt) break;
    }
    throw new Error('RemoconNet hat die neue Betriebsart noch nicht bestätigt. Bitte den Zustand prüfen.');
  }

  async snapshot(id, includeGas) {
    const gateway = encodeURIComponent(id);
    const values = {};
    const errors = [];
    const diagnostic = { outside: 'Anlagenstatus fehlt', metering: {} };
    const collect = async (path, decode, body, onError) => {
      try {
        Object.assign(values, decode(await this.read(path, body)));
      } catch (error) {
        errors.push(error.message);
        onError?.(error);
        if (error.status === 401 || Date.now() < this.retryAt) return false;
      }
      return true;
    };
    let outsideBlocked = false;
    if (!await collect(`/remote/plantData/${gateway}`, data => {
      const plant = plantData(data);
      const flag = plant?.hasOutsideTempProbe;
      const probe = flag?.value ?? flag;
      const probeConfirmed = [true, 1, '1'].includes(probe);
      outsideBlocked = [false, 0, '0'].includes(probe) || outsideError(plant);
      const decoded = decodePlant(data);
      diagnostic.outside = Object.hasOwn(decoded, 'measure_temperature.outside') ? 'Fühlerwert empfangen' :
        `Fühler: ${flag == null ? 'Angabe fehlt' : probeConfirmed ? 'vorhanden' : 'nicht bestätigt'}, Temperaturfeld: ${plant?.outsideTemp == null ? 'fehlt' : 'vorhanden'}`;
      return decoded;
    }, undefined, error => {
      diagnostic.outside = `Anlagenstatus: ${diagnosticError(error)}`;
    })) return { values, errors, diagnostic };
    const menuPath = `/menuItems/${gateway}?menuItems=`;
    if (!await collect(menuPath + '119,120,121,122,123,124,125,126,127,128,129,130', decodeMenu)) {
      return { values, errors, diagnostic };
    }
    const missing = [
      ['measure_temperature', '123'],
      ['burner_hours_heating', '120'],
      ['burner_hours_water', '121'],
    ];
    for (const [capability, item] of missing) {
      if (values[capability] === undefined && !await collect(menuPath + item, decodeMenu)) {
        return { values, errors, diagnostic };
      }
    }
    diagnostic.menu = missing.map(([capability, item]) =>
      `${item}: ${values[capability] === undefined ? 'fehlt' : 'OK'}`).join(', ');
    const needOutside = !outsideBlocked && values['measure_temperature.outside'] === undefined;
    if (values.burner_active === undefined || needOutside) {
      const items = [];
      if (values.burner_active === undefined) items.push({ id: 'IsFlameOn', zn: 0 });
      if (needOutside) items.push({ id: 'OutsideTemp', zn: 0 });
      const path = `/remote/plants/${gateway}/features`;
      if (!this.flameFeatures) {
        if (!await collect(path, features => {
          if (features && typeof features === 'object' && !Array.isArray(features)) {
            this.flameFeatures = features;
          }
          return {};
        })) return { values, errors, diagnostic };
      }
      if (this.flameFeatures && !await collect(
        `/remote/dataItems/${gateway}/get?umsys=si`,
        data => {
          const result = decodeFlameItem(data);
          if (needOutside) {
            const value = outsideValue(findItem(data, 'OutsideTemp')?.value);
            if (value !== null) {
              result['measure_temperature.outside'] = value;
              diagnostic.outside = 'Temperatur über OutsideTemp empfangen';
            } else {
              diagnostic.outside += ' · OutsideTemp fehlt oder ungültig';
            }
          }
          return result;
        },
        { useCache: false, items, features: this.flameFeatures, culture: 'de-DE' },
        error => {
          if (needOutside) diagnostic.outside += ` · OutsideTemp: ${diagnosticError(error)}`;
        },
      )) return { values, errors, diagnostic };
    }
    if (includeGas && await collect(`/remote/reports/${gateway}/energyAccount`, decodeGas)) {
      try {
        Object.assign(values, await this.metering.read(gateway, diagnostic.metering));
      } catch (error) {
        errors.push(error.message);
        diagnostic.metering.error = diagnosticError(error);
      }
    }
    return { values, errors, diagnostic };
  }
}

function numeric(value) {
  if (typeof value === 'string' && /^-?\d+(?:[.,]\d+)?$/.test(value.trim())) {
    value = Number(value.replace(',', '.'));
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function plantData(data) {
  const root = data?.data ?? data;
  return root?.plantData ?? root;
}

function outsideValue(value) {
  const number = numeric(value?.value ?? value);
  return number !== null && number >= -60 && number <= 65 ? number : null;
}

function outsideError(plant) {
  const flag = plant?.outsideTempError;
  return ![undefined, null, false, 0, '0'].includes(flag?.value ?? flag);
}

function decodePlant(data) {
  const plant = plantData(data);
  const flame = plant?.flameSensor;
  const values = decodeFlame(flame?.value ?? flame);
  if ([true, 1, '1'].includes(plant?.hasOutsideTempProbe?.value ?? plant?.hasOutsideTempProbe) &&
      !outsideError(plant)) {
    const outside = outsideValue(plant.outsideTemp);
    if (outside !== null) {
      values['measure_temperature.outside'] = outside;
    }
  }
  return values;
}

function findItem(data, id) {
  const items = (data?.data ?? data)?.items;
  if (!Array.isArray(items)) return undefined;
  return items.find(entry => entry?.id === id && (entry.zone == null || Number(entry.zone) === 0));
}

function decodeFlameItem(data) {
  return decodeFlame(findItem(data, 'IsFlameOn')?.value);
}

function decodeFlame(flame) {
  if ([true, 1, '1'].includes(flame)) return { burner_active: true };
  if ([false, 0, '0'].includes(flame)) return { burner_active: false };
  return {};
}

function decodeMenu(data) {
  data = data?.data ?? data;
  if (!Array.isArray(data)) return {};
  const valueFor = (id, nodeId) => {
    const item = data.find(entry => entry?.nodeId === nodeId ||
      (entry?.nodeId == null && Number(entry?.id) === id));
    return numeric(item?.value);
  };
  const flow = valueFor(123, 'T_8.3.1');
  const heat = valueFor(120, 'T_8.1.0');
  const power = valueFor(125, 'T_8.2.8');
  const water = valueFor(121, 'T_8.1.1');
  const values = {};
  if (power !== null && power >= 0 && power <= 150) values.burner_power_kw = power;
  if (flow !== null && flow >= -30 && flow <= 130) values.measure_temperature = flow;
  if (heat !== null && heat >= 0 && heat !== 3276 && heat !== 65535) values.burner_hours_heating = heat * 10;
  if (water !== null && water >= 0 && water !== 3276 && water !== 65535) values.burner_hours_water = water * 10;
  return values;
}

function decodeGas(data) {
  data = data?.data ?? data;
  if (!Array.isArray(data?.LastMonth)) return {};
  const heat = numeric(data.LastMonth[0]?.gas);
  const water = numeric(data.LastMonth[1]?.gas);
  const values = {};
  if (heat !== null && heat >= 0) values.gas_heating_last_month = heat;
  if (water !== null && water >= 0) values.gas_water_last_month = water;
  return values;
}

module.exports = { Remocon, decodePlant, decodeMenu, decodeGas };
