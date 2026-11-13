'use strict';

function getDevice(homey, id) {
  const devices = homey.drivers.getDriver('boiler').getDevices();
  const device = id ? devices.find(item => item.getData().id === id) :
    devices.length === 1 ? devices[0] : undefined;
  if (!device) throw new Error('Bitte eine Heizung in den Widget-Einstellungen auswählen.');
  return device;
}

function status(device) {
  const state = device.getCapabilityValue('boiler_mode_state');
  return {
    active: device.confirmedMode ?? (['pending', 'unconfirmed'].includes(state) ? null : state),
    pending: device.requestedMode ?? null,
    state,
  };
}

module.exports = {
  async getStatus({ homey, query }) {
    return status(getDevice(homey, query.id));
  },

  async setMode({ homey, body }) {
    const device = getDevice(homey, body.id);
    await device.changeMode(body.mode);
    return status(device);
  },
};
