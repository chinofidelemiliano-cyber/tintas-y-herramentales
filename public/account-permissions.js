export const permissionLabels=Object.freeze({inventory:'Inventario',movements:'Ingresos y egresos',catalog:'Catálogo',production:'Consumos y órdenes cerradas',preparation:'Tiempos de preparación y Pantone',incidents:'Incidencias',cuts:'Cortes mensuales',devices:'Dispositivos y notificaciones',settings:'Configuración de página',production_audit:'Bitácora privada de producción y paros',preparation_edit:'Editar órdenes de preparación',preparation_correct:'Corregir tiempos de preparación',die_authorize:'Autorizar incompatibilidades de suaje',preparation_kpi:'Consultar indicadores de todos los preparadores',preparation_handoff:'Registrar entrega a producción'});
export const viewPermission=Object.freeze({stock:'inventory',herramental:'production',anilox:'production',recetas:'production',inventario:'inventory',movimientos:'movements',catalogo:'catalog',ordenes:'production',suajes:'production',plecas:'production',preparacion:'preparation',incidencias:'incidents',cortes:'cuts',dispositivos:'devices',configuracion:'settings',bitacora:'production_audit',historial:'production_audit'});
export function allowedView(view,access){if(!access)return view!=='administracion';if(view==='hojas')return !!access.is_admin||access.permissions?.some(p=>['production','preparation'].includes(p));if(view==='administracion')return !!access.is_admin;return !!access.is_admin||access.permissions?.includes(viewPermission[view]);}
export const permissionPresets=Object.freeze({
 Supervisor:['inventory','production','preparation','preparation_edit','preparation_correct','die_authorize','preparation_kpi','preparation_handoff'],
 Preparador:['inventory','preparation'],
 Producción:['inventory','production','preparation','preparation_handoff'],
 Consulta:['inventory']
});
