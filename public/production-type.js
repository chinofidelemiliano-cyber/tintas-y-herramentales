export const productionTypes = {
 cut: 'Puro corte',
 print_cut: 'Impresión y corte',
 print: 'Solo impresión',
 white: 'Etiqueta blanca'
};

export function productionRequirements(type, whiteProcess) {
 if (!Object.hasOwn(productionTypes, type)) throw Error('Selecciona el tipo de producción.');
 if (type === 'white' && !['material', 'ink'].includes(whiteProcess)) {
  throw Error('Indica si la etiqueta blanca usa material blanco o tinta blanca.');
 }
 return {
  printing: ['print_cut', 'print'].includes(type) || (type === 'white' && whiteProcess === 'ink'),
  cutting: ['cut', 'print_cut', 'white'].includes(type)
 };
}

export function normalizeProductionType(order) {
 const type = order.production_type;
 const white = type === 'white' ? order.white_process : null;
 const requirements = productionRequirements(type, white);
 const plates = String(order.plates ?? '').trim();
 if (requirements.printing && (!plates || plates.length > 200)) throw Error('Captura las placas o clichés.');
 if (!requirements.printing && (plates || order.colors || order.ink_selections?.length || order.ink_family)) {
  throw Error('Este proceso no admite datos de impresión.');
 }
 if (requirements.printing && !order.ink_selections?.length) throw Error('Selecciona al menos una tinta o Pantone.');
 if (requirements.cutting && !order.die_id) throw Error('Selecciona el suaje para el corte.');
 if (!requirements.cutting && (order.die_id || order.crease_id || order.has_crease === 'yes')) {
  throw Error('Solo impresión no admite herramentales de corte.');
 }
 return {production_type:type,white_process:white,plates:requirements.printing?plates:''};
}
