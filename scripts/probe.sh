#!/bin/bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
g(){ python3 -c "import urllib.parse,sys;print('https://news.google.com/rss/search?q='+urllib.parse.quote(sys.argv[1])+'&hl=en-GB&gl=GB&ceid=GB:en')" "$1"; }
for q in 'site:egi.co.uk' 'site:eg.co.uk' '"Estates Gazette" when:14d' 'EG property news when:7d' 'site:reactnews.com' '"React News" when:30d' 'site:recapitalnews.com' '"Real Estate Capital Europe" when:30d' 'site:perenews.com when:30d' 'site:costar.com/article when:7d' 'site:greenstreet.com when:30d' '"Green Street News" when:30d'; do
  n=$(curl -sL -A "$UA" "$(g "$q")" | grep -o "<item>" | wc -l); echo "GN $n :: $q"; done
for u in https://www.egi.co.uk/feed/ https://www.egi.co.uk/rss https://www.reactnews.com/feed https://www.reactnews.com/rss.xml https://www.recapitalnews.com/feed/ https://www.perenews.com/rss https://www.propertyweek.com/rss.xml https://www.costar.com/rss/news https://realassets.ipe.com/rss.xml https://www.cityam.com/category/property/feed/ https://www.estatesgazette.com/feed; do
  r=$(curl -sL -A "$UA" -o /tmp/f -w "%{http_code}" "$u"); echo "RSS $r $(grep -o '<item>' /tmp/f | wc -l) :: $u"; done
for u in \
 "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?geo=EA&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT&lastTimePeriod=3&format=JSON" \
 "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?geo=EA21&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT&lastTimePeriod=3&format=JSON" \
 "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=EA&coicop=CP00&lastTimePeriod=3&format=JSON" \
 "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=EA&coicop=TOT_X_NRG_FOOD&lastTimePeriod=3&format=JSON" \
 "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=EA21&coicop=CP00&lastTimePeriod=3&format=JSON" \
 "https://data-api.ecb.europa.eu/service/data/ICP/M.U3.N.000000.4.ANR?lastNObservations=2&format=csvdata" \
 "https://data-api.ecb.europa.eu/service/data/ICP/M.U4.N.000000.4.ANR?lastNObservations=2&format=csvdata" \
 "https://data-api.ecb.europa.eu/service/data/ICP/M.U2.N.000000.4.ANR?lastNObservations=2&format=csvdata" \
 ; do echo "== $u"; curl -sL -A "$UA" "$u" | head -c 600 | tr '\n' ' ' | sed 's/"label"[^}]*}//g'; echo; done
curl -sL "https://data-api.ecb.europa.eu/service/data/ICP/M..N.000000.4.ANR?lastNObservations=1&format=csvdata" | cut -d, -f1-8 | grep -E "U[0-9]|EA|I[0-9]" | head
