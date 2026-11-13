'use strict';

function onHomeyReady(Homey) {
  const label = key => Homey.__(`widget.${key}`);
  const header = document.getElementById('status');
  const buttons = [...document.querySelectorAll('button[data-mode]')];
  const id = Homey.getSettings().boiler?.id;
  const query = id ? `?id=${encodeURIComponent(id)}` : '';
  let data = {};
  let busy = false;
  let error = '';
  let reading = false;
  let revision = 0;

  function render() {
    const pending = data.pending || busy;
    header.dataset.state = pending ? 'pending' : data.active ? 'active' : '';
    header.textContent = error || (data.pending ? `${label('changing')} · ${label(data.pending)}` :
      data.state === 'unconfirmed' ? label('unconfirmed') :
      data.active ? `${label('active')} · ${label(data.active)}` : label('unknown'));
    for (const button of buttons) {
      const mode = button.dataset.mode;
      button.setAttribute('aria-pressed', String(data.active === mode));
      button.dataset.pending = String(data.pending === mode);
      button.disabled = Boolean(pending || data.active === mode || !data.ready);
    }
  }

  async function refresh() {
    if (busy || reading || document.hidden) return;
    reading = true;
    const request = revision;
    try {
      const result = await Homey.api('GET', `/status${query}`);
      if (revision === request) {
        data = { ...result, ready: true };
        error = '';
      }
    } catch {
      if (revision === request) {
        data = {};
        error = label('unavailable');
      }
    } finally {
      reading = false;
      render();
    }
  }

  for (const button of buttons) {
    const mode = button.dataset.mode;
    button.lastElementChild.textContent = label(mode);
    button.addEventListener('click', async () => {
      revision += 1;
      busy = true;
      error = '';
      render();
      try {
        Homey.hapticFeedback?.();
        data = { ...await Homey.api('POST', '/mode', { id, mode }), ready: true };
      } catch {
        error = label('failed');
      } finally {
        busy = false;
        render();
      }
    });
  }

  render();
  Homey.ready();
  void refresh();
  setInterval(refresh, 2500);
}
