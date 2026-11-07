#!/bin/bash
UA="Mozilla/5.0 Chrome/124.0"
curl -sL -A "$UA" "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?geo=EA&unit=RCH_A&lastTimePeriod=2&format=JSON" | python3 -c "
import json,sys
j=json.load(sys.stdin)
print('ids', j['id'], 'size', j['size'])
for d in j['id']:
  cats=j['dimension'][d]['category']
  keys=list(cats['index'].keys())
  print(d, len(keys), [(k, cats.get('label',{}).get(k,'')[:50]) for k in keys if d!='coicop18' or k in ('TOTAL','CP00','TOT_X_NRG_FOOD','TOT_X_NRG_FOOD_NP') or 'X_' in k][:12])
"
echo "== ECB HICP"
curl -sL -A "$UA" "https://data-api.ecb.europa.eu/service/data/HICP/M.U2.....?lastNObservations=1&format=csvdata" | cut -d, -f1,2 | head -3
curl -sL -A "$UA" "https://data-api.ecb.europa.eu/service/data/HICP/?lastNObservations=1&format=csvdata&startPeriod=2026-09" | cut -d, -f1 | grep -iE "U2|EA|I9" | grep -iE "ANR|RCH_A|A$" | head -20
