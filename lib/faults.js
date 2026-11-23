'use strict';

// ELCO THISION MINI operator manuals, pp. 20 (24-page edition)
// and 15 (20-page edition). Availability varies by boiler version.
const FAULTS = {
  '101': ['Überhitzung', 'Overheating'],
  '103': ['Störung der Wasserzirkulation', 'Water circulation fault'],
  '104': ['Störung der Wasserzirkulation', 'Water circulation fault'],
  '105': ['Störung der Wasserzirkulation', 'Water circulation fault'],
  '106': ['Störung der Wasserzirkulation', 'Water circulation fault'],
  '107': ['Störung der Wasserzirkulation', 'Water circulation fault'],
  '108': ['Wasserdruck zu niedrig / Anlage füllen', 'Low water pressure / refill system'],
  '110': ['Vorlauffühler: Unterbrechung oder Kurzschluss', 'Flow sensor: open or short circuit'],
  '112': ['Rücklauffühler: Unterbrechung oder Kurzschluss', 'Return sensor: open or short circuit'],
  '203': ['Speicherfühler: Unterbrechung oder Kurzschluss', 'Cylinder sensor: open or short circuit'],
  '305': ['Störung der Reglerplatine', 'Control board fault'],
  '306': ['Störung der Reglerplatine', 'Control board fault'],
  '307': ['Störung der Reglerplatine', 'Control board fault'],
  '501': ['Keine Flamme erkannt', 'No flame detected'],
  '1P4': ['Warnung: Anlagendruck niedrig', 'Warning: low system pressure'],
};

function describeFaults(codes, language = 'de') {
  const english = language !== 'de';
  return String(codes ?? '').split(',').map(code => code.trim()).filter(Boolean).map(code => {
    const key = code.replace(/\s+/g, '').toUpperCase();
    const description = FAULTS[key]?.[english ? 1 : 0] ??
      (english ? 'Unknown fault code' : 'Unbekannter Fehlercode');
    return `${code} – ${description}`;
  }).join('; ');
}

module.exports = { describeFaults };
