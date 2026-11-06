import {readFile,writeFile} from 'node:fs/promises';
const files=['work-history-rewind.sql','capture-order-details.sql','owner-full-access.sql'];
const sections=await Promise.all(files.map(f=>readFile(new URL('../supabase/'+f,import.meta.url),'utf8')));
await writeFile(new URL('../public/activar-produccion.sql',import.meta.url),'-- Ejecutar TODO el archivo en una consulta nueva, sin seleccionar fragmentos.\n'+sections.join('\n'));
