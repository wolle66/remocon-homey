'use strict';

const Homey = require('homey');
const Measurements = require('../../lib/insights');
const { Remocon } = require('../../lib/remocon');

const POLL_INTERVAL = 15 * 60_000;
const GAS_INTERVAL = 60 * 60_000;
const manifest = require('../../app.json');
const MODE_VALUES = manifest.capabilities.boiler_mode.values;
const { capabilities: CAPABILITIES, capabilitiesOptions: OPTIONS } = manifest.drivers[0];

module.exports = class BoilerDevice extends Homey.Device {
  async onInit() {
    for (const id of CAPABILITIES) {
      if (this.hasCapability(id)) continue;
      await this.addCapability(id);
      if (OPTIONS[id]) await this.setCapabilityOptions(id, OPTIONS[id]);
    }
    if (!this.getCapabilityOptions('burner_active')?.preventInsights) {
      await this.setCapabilityOptions('burner_active', {
        ...this.getCapabilityOptions('burner_active'),
        preventInsights: true,
      });
    }
    this.registerCapabilityListener('boiler_mode', mode => this.changeMode(mode));
    this.measurements = new Measurements(this.homey.insights, this.getData().id, this.getName());
    const { email, password } = this.getStoreValue('credentials');
    this.useClient(new Remocon(email, password));
  }

  useClient(client) {
    this.homey.clearTimeout(this.timer);
    this.client = client;
    this.gasCheckedAt = null;
    if (!this.polling) void this.poll();
  }

  async changeMode(mode) {
    const client = this.client;
    if (!client) throw new Error('RemoconNet ist noch nicht bereit.');
    if (!MODE_VALUES.some(item => item.id === mode)) throw new Error('Ungültige Betriebsart.');
    if (this.modeChange) throw new Error('Eine Änderung der Betriebsart läuft bereits.');
    this.modeRevision = (this.modeRevision ?? 0) + 1;
    this.modeChange = true;
    this.requestedMode = mode;
    void this.applyMode(client, mode);
  }

  async applyMode(client, mode) {
    try {
      await this.setCapabilityValue('boiler_mode_state', 'pending');
      await client.setMode(this.getData().id, mode);
      if (this.client === client) await this.showMode(mode);
    } catch (error) {
      this.log('Betriebsart konnte nicht bestätigt werden:', error.message);
      if (this.client === client) {
        await this.setCapabilityValue('boiler_mode_state', 'unconfirmed').catch(() => {});
        if (Date.now() >= client.retryAt) {
          try {
            const actual = await client.getMode(this.getData().id);
            if (this.client === client) await this.showMode(actual);
          } catch {
            // Keep the unconfirmed state until the next regular poll.
          }
        }
      }
    } finally {
      this.requestedMode = null;
      this.modeChange = false;
    }
  }

  async showMode(mode) {
    await this.setCapabilityValue('boiler_mode_state', mode ?? 'other');
    this.confirmedMode = mode ?? 'other';
  }

  async poll() {
    const client = this.client;
    const includeGas = this.gasCheckedAt === null || Date.now() - this.gasCheckedAt >= GAS_INTERVAL;
    this.polling = true;
    try {
      if (!this.modeChange && Date.now() >= client.retryAt) {
        const revision = this.modeRevision;
        try {
          const mode = await client.getMode(this.getData().id);
          if (this.client === client && !this.modeChange && this.modeRevision === revision &&
              this.getCapabilityValue('boiler_mode_state') !== (mode ?? 'other')) {
            await this.showMode(mode);
          }
        } catch (error) {
          this.log('Betriebsart konnte nicht gelesen werden:', error.message);
        }
      }
      const { values, errors, diagnostic } = await client.snapshot(this.getData().id, includeGas);
      if (this.client !== client) return;
      const capabilities = this.getCapabilities();
      const checked = capabilities.filter(id => !['boiler_mode', 'boiler_mode_state'].includes(id) && (includeGas || !id.startsWith('gas_')));
      let recorded = 0;
      let failed = 0;
      const insightsErrors = new Set();
      for (const id of checked) {
        if (this.client !== client) return;
        const value = values[id] ?? null;
        const keepLast = ['measure_temperature', 'burner_hours_heating', 'burner_hours_water'].includes(id);
        if (value !== null || (!keepLast && this.getCapabilityValue(id) != null)) {
          await this.setCapabilityValue(id, value);
        }
        if (value === null || id === 'burner_active') continue;
        const capability = manifest.capabilities[id];
        const metadata = {
          title: (OPTIONS[id]?.title ?? capability?.title)?.de ?? id,
          type: typeof value === 'boolean' ? 'boolean' : 'number',
        };
        if (metadata.type === 'number') {
          metadata.units = capability?.units?.de ?? '°C';
          metadata.decimals = capability?.decimals ?? 1;
        }
        try {
          await this.measurements.record(id, value, metadata);
          recorded += 1;
        } catch (error) {
          failed += 1;
          insightsErrors.add(`${metadata.title}: ${error.message}`);
        }
      }
      if (includeGas) {
        this.gasCheckedAt = Date.now();
        const report = diagnostic.metering;
        const info = [
          `Version ${manifest.version}`,
          `Insights: ${recorded} gespeichert, ${failed} Fehler`,
          ...insightsErrors,
          `Außen: ${diagnostic.outside}`,
          `Vorlauf/Brennerstunden: ${diagnostic.menu ?? 'Abfrage nicht erreicht'}`,
          `Gas: ${report.step ?? 'Abfrage nicht erreicht'}`,
          report.error, report.volume,
          Number.isInteger(report.recognized) ? `${report.recognized}/6 Werte` : null,
          report.layout,
          report.series, report.histogram,
        ].filter(Boolean).join(' · ');
        if (this.getSetting('remocon_diagnostic') !== info) {
          await this.setSettings({ remocon_diagnostic: info }).catch(() => {
            this.log(info);
          });
        }
      }
      if (Object.keys(values).length || (!errors.length && capabilities.some(id => this.getCapabilityValue(id) != null))) {
        await this.setAvailable();
      } else {
        await this.setUnavailable(errors[0] ?? 'Für diese Anlage wurden keine unterstützten Messwerte gefunden.');
      }
    } catch {
      if (this.client === client) await this.setUnavailable('Die Messwerte konnten nicht aktualisiert werden.').catch(() => {});
    } finally {
      this.polling = false;
      if (this.client) {
        const delay = this.client === client ? Math.max(POLL_INTERVAL, client.retryAt - Date.now()) : 0;
        this.timer = this.homey.setTimeout(() => void this.poll(), delay);
      }
    }
  }

  async onDeleted() {
    this.client = undefined;
    this.homey.clearTimeout(this.timer);
  }
};
