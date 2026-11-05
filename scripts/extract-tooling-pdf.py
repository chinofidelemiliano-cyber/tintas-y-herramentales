"""Extract the Excel PDF by its cell coordinates; preserve original text values."""
import json,re,sys
from pathlib import Path
import pdfplumber
source=Path(sys.argv[1]);output=Path(sys.argv[2]);page=pdfplumber.open(source).pages[0]
words=page.extract_words(x_tolerance=.3,y_tolerance=.3)
anchors=sorted([w for w in words if re.fullmatch(r'(?:SJ|PD|CMC)\d+(?:-\d+)?',w['text'])],key=lambda w:w['top'])
columns=[('smartier',50.8,68.3),('code',68.3,80.18),('serial',80.18,98.78),('provider',98.78,113.9),('material',113.9,139.5),('liner',139.5,154.3),('type',154.3,166.7),('axis_measure',166.7,188.8),('development_measure',188.8,211.4),('inches',211.4,242.3),('axis_cavities',242.3,261),('development_cavities',261,280.3),('axis_separation',280.3,299.3),('development_separation',299.3,321.2),('corner_radius',321.2,342.1),('th',342.1,360.8),('cost_usd',360.8,387.4),('purchase_date',387.4,413.2),('shape',413.2,440.2),('meters_to_regrind',440.2,466.1),('max_regrinds',466.1,488.1),('regrind_cost_mxn',488.1,508),('cost_mxn',508,524),('exchange_rate',524,539.6),('notes',539.6,590)]
result=[]
for i,anchor in enumerate(anchors):
 low=(anchors[i-1]['top']+anchor['top'])/2 if i else 61
 high=(anchor['top']+anchors[i+1]['top'])/2 if i+1<len(anchors) else anchor['top']+2
 low=max(low,anchor['top']-1);high=min(high,anchor['top']+2)
 row=[w for w in words if low<=w['top']<high]
 details={key:' '.join(w['text'] for w in sorted(row,key=lambda w:w['x0']) if x0<=(w['x0']+w['x1'])/2<x1).strip() for key,x0,x1 in columns}
 code=anchor['text'];assert details['code']==code,(code,details)
 kind='suaje' if code.startswith('SJ') else 'pleca' if code.startswith('PD') else 'cuchilla'
 cost=details['cost_mxn'].replace('$','').replace(',','').replace(' ','');cost=float(cost) if re.fullmatch(r'\d+(?:\.\d+)?',cost) else None
 name={'suaje':'Suaje','pleca':'Pleca','cuchilla':'Cuchilla'}[kind]
 dimensions=' × '.join(v for v in [details['axis_measure'],details['development_measure']] if v)
 name+=' · '+dimensions if dimensions else ''
 if details['th']:name+=' · TH '+details['th']
 if details['shape']:name+=' · '+details['shape']
 result.append({'code':code,'name':name,'kind':kind.title(),'tool_type':kind,'category':'herramental','provider':details['provider'].strip().title() or 'No indicado','cost_kg':cost or 0,'quantity':1,'lot':details['serial'] or code,'details':{**details,'source_file':source.name,'cost_mxn_value':cost,'quantity_basis':'Una pieza por ID de herramental, confirmada por el propietario'}})
assert len(result)==154 and len({r['code'] for r in result})==154
output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
from collections import Counter
print(dict(Counter(r['tool_type'] for r in result)));print('missing costs',sum(r['details']['cost_mxn_value'] is None for r in result))
