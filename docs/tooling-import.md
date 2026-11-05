# Inventario de herramentales importado

Fuente: `Inventario de Hernamentales.pdf` (una hoja exportada desde Excel).

- 112 IDs SJ: suajes.
- 35 IDs PD: plecas.
- 7 IDs CMC: cuchillas, disponibles solo en el inventario general.
- Total: 154 IDs únicos, una pieza por ID según confirmación del propietario.
- 141 costos MXN válidos; suma registrada: $591,343.47 MXN (incluye valores cero explícitos).
- 13 costos MXN vacíos o con error, conservados como no registrados: CMC001, CMC002, CMC003, CMC004-1, CMC004-2, CMC005, CMC006, SJ043-1, SJ053-6, SJ091-1, SJ092-1, SJ093-1, SJ094-1.

Se conservaron serie, número Smartier, proveedor original, material, liner, tipo del PDF, medidas al eje y desarrollo, pulgadas, cavidades, separaciones, radio, TH, costo USD original, fecha de compra, figura, metros para reafilar, máximos de reafilado, costo por reafilado, costo MXN, tipo de cambio y notas. No se convierten costos USD ni se estiman medidas faltantes. `data/tooling-inventory.json` conserva los textos de origen; `scripts/extract-tooling-pdf.py` reproduce la extracción por coordenadas.

La carga registra entradas trazables por pieza, no altera saldos de tinta ni modifica movimientos anteriores. El marcador `tooling_pdf_20261104_v1` evita repetirla; tampoco agrega piezas a productos que ya tengan lotes. Las selecciones públicas solo exponen códigos y descripciones y se validan por prefijo: Suaje = SJ, Pleca = PD. Las fichas internas conservan el resto de los datos.

Para una base existente ejecutar completo `supabase/import-tooling-inventory.sql` en SQL Editor; incluye las dependencias anteriores. No regenera ni desactiva enlaces de captura. Para instalaciones nuevas `setup.sql` ya incluye la carga.
