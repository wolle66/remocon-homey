'use strict';

const Homey = require('homey');
const { Remocon } = require('../../lib/remocon');

module.exports = class BoilerDriver extends Homey.Driver {
  async onPair(session) {
    let client;
    let credentials;
    let devices = [];

    const makeDevice = plant => ({
      name: typeof plant.name === 'string' && plant.name.trim() ? plant.name : 'ELCO RemoconNet',
      data: { id: plant.gw },
      store: { credentials },
    });

    session.setHandler('login', async ({ username, password }) => {
      client = undefined;
      devices = [];
      const email = username?.trim();
      if (!email || !password) throw new Error('Bitte E-Mail-Adresse und Passwort eingeben.');
      const candidate = new Remocon(email, password);
      await candidate.login();
      credentials = { email, password };
      client = candidate;
      return true;
    });

    session.setHandler('discover_gateways', async () => {
      if (!client) throw new Error('Bitte zuerst bei RemoconNet anmelden.');
      devices = (await client.discover()).map(makeDevice);
      return devices.length > 0;
    });

    session.setHandler('use_gateway', async input => {
      if (!client) throw new Error('Bitte zuerst bei RemoconNet anmelden.');
      const id = typeof input === 'string' ? input.trim() : '';
      if (!/^[a-z0-9_-]{1,100}$/i.test(id)) throw new Error('Bitte die Gateway-ID aus der Portaladresse eingeben.');
      try {
        await client.checkGateway(id);
      } catch (error) {
        if (![403, 404].includes(error.status)) throw error;
        throw new Error('Für diese Gateway-ID ist kein Zugriff möglich. Bitte Konto und ID prüfen.');
      }
      devices = [makeDevice({ gw: id })];
      return true;
    });

    session.setHandler('list_devices', async () => devices);
  }

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password }) => {
      const email = username?.trim();
      if (!email || !password) throw new Error('Bitte E-Mail-Adresse und Passwort eingeben.');
      const client = new Remocon(email, password);
      await client.checkGateway(device.getData().id);
      await device.setStoreValue('credentials', { email, password });
      device.useClient(client);
      return true;
    });
  }
};
