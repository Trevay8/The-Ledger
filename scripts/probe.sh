#!/bin/bash
UA="Mozilla/5.0 Chrome/124.0"
echo "== ECB ICP series with 2026 data (U2/EA)"
curl -sL -A "$UA" "https://data-api.ecb.europa.eu/service/data/ICP/M.U2+EA+I9+EA21+I10+U21..000000+XEF000+TOT_X_NRG_FOOD+TOTAL..ANR?lastNObservations=1&format=csvdata" | cut -d, -f1,8,9 | head -20
echo "== ECB HICP flow?"
curl -sL -A "$UA" "https://data-api.ecb.europa.eu/service/dataflow/ECB" | grep -oE 'id="[A-Z_]*(ICP|HICP|PRC)[A-Z_]*"' | sort -u
echo "== Eurostat datasets"
for d in prc_hicp_manr prc_hicp_minr prc_hicp_mmor prc_hicp_cmon prc_hicp_inw; do
  for geo in EA EA21 EA20; do
    r=$(curl -sL -A "$UA" "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/$d?geo=$geo&lastTimePeriod=1&format=JSON" | python3 -c "import json,sys
try:
  j=json.load(sys.stdin); print(list(j['dimension']['time']['category']['index'].keys()), 'coicop:', list(j['dimension'].get('coicop',{}).get('category',{}).get('index',{}).keys())[:6], 'unit:', list(j['dimension'].get('unit',{}).get('category',{}).get('index',{}).keys())[:4])
except Exception as e: print('ERR', str(e)[:80])")
    echo "$d $geo $r"
  done
done
