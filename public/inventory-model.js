// Legacy code was joined to the preceding name in the original PDF extraction.
const aliases = { UIAPP50EP021ID: 'APP50EP021ID' };
export function canonicalCode(code) {
  const normalized = String(code).trim().toUpperCase();
  return aliases[normalized] || normalized;
}

export function splitContainers(grams, capacity = 4000) {
  if (!Number.isFinite(grams) || !Number.isFinite(capacity) || capacity <= 0) throw Error('Cantidad o capacidad no válida.');
  if (grams <= 0) return [];
  const result = [];
  const full = Math.floor(grams / capacity);
  for (let i = 0; i < full; i++) result.push({ number: i + 1, grams: capacity, capacity, estimated: true });
  const remainder = Math.round((grams - full * capacity) * 1000000) / 1000000;
  if (remainder > 0) result.push({ number: result.length + 1, grams: remainder, capacity, estimated: true });
  return result;
}

export function groupLots(lots) {
  const groups = new Map();
  for (const lot of lots) {
    const code = canonicalCode(lot.code);
    if (!groups.has(code)) groups.set(code, { ...lot, code, grams: 0, lots: [] });
    const group = groups.get(code);
    group.grams += lot.grams;
    group.lots.push(lot);
  }
  return [...groups.values()];
}
