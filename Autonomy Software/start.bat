@echo off
wt `
  new-tab `
    --title "MAVProxy" `
    --command "ssh ratbird@100.66.197.16 -p 22 -t \"cd MercuryDelivery && ./start_mavproxy.sh\"" `
  ; split-pane `
    --title "Run.sh" `
    --command "ssh ratbird@100.66.197.16 -p 22 -t \"cd MercuryDelivery && ./run.sh\"" `
  ; focus-tab -t 0
