import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparationMinutes} from '../public/preparation-model.js';
test('preparation minutes match reference examples and handle explicit overnight work',()=>{
 assert.equal(preparationMinutes('06:58','07:08'),10);assert.equal(preparationMinutes('08:34','08:42'),8);assert.equal(preparationMinutes('12:45','13:07'),22);assert.equal(preparationMinutes('08:00','08:43'),43);
 assert.equal(preparationMinutes('23:50','00:10',true),20);assert.equal(preparationMinutes('06:58:00','06:58:30'),0.5);
 assert.throws(()=>preparationMinutes('23:50','00:10'),/anterior/);assert.throws(()=>preparationMinutes('24:00','07:08'),/válidas/);assert.throws(()=>preparationMinutes('08:00','09:00',true),/24 horas/);
});
