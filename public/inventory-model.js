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

export function groupByProvider(lots) {
  const providers = new Map();
  for (const lot of lots) {
    const name = String(lot.provider || '').trim() || 'Sin proveedor';
    const key = name.toLocaleLowerCase('es-MX');
    if (!providers.has(key)) providers.set(key, { name, lots: [], grams: 0 });
    const provider = providers.get(key);
    provider.lots.push(lot);
    provider.grams += lot.grams;
  }
  return [...providers.values()].sort((a, b) => a.name.localeCompare(b.name, 'es-MX')).map(p => ({...p, groups: groupLots(p.lots)}));
}

// Keep opening balances separate from actual monthly income and expenses.
export function monthlyMovementDetails(movements, lots, month, selectedLotIds = null) {
  const byId = new Map(lots.map(l => [l.lot_id ?? l.id, l]));
  const selected = selectedLotIds === null ? null : new Set(selectedLotIds);
  const result = { in: [], out: [] };
  for (const m of movements) {
    if (!result[m.type] || m.date.slice(0, 7) !== month || (selected && !selected.has(m.lot_id))) continue;
    const lot = byId.get(m.lot_id);
    const category = lot?.category || 'tinta';
    result[m.type].push({...m, name: lot?.name ?? m.name, code: lot?.code ?? m.code, lot: lot?.lot ?? m.lot,
      unit: category === 'herramental' ? 'pzas' : 'g', value: m.grams * m.cost_kg / (category === 'herramental' ? 1 : 1000)});
  }
  for (const rows of Object.values(result)) rows.sort((a,b) => a.date.localeCompare(b.date) || a.id-b.id);
  return result;
}
