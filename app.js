'use strict';

const Homey = require('homey');

module.exports = class RemoconApp extends Homey.App {
  async onInit() {
    this.homey.flow.getActionCard('set_boiler_mode')
      .registerRunListener(({ device, mode }) => device.changeMode(mode));

    this.homey.dashboards.getWidget('boiler-control')
      .registerSettingAutocompleteListener('boiler', async query => {
        const devices = this.homey.drivers.getDriver('boiler').getDevices();
        return devices.filter(device => device.getName().toLowerCase().includes(query.toLowerCase()))
          .map(device => ({ id: device.getData().id, name: device.getName() }));
      });
  }
};
