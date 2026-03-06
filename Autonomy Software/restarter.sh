#!/bin/bash

# Services
MERCURY_SERVICE="mercury_app.service"
MAVPROXY_SERVICE="mavproxy.service"

usage() {
    echo "Usage: $0 [--mercury | --mavproxy]"
    echo
    echo "No arguments: restart BOTH services."
    echo "  --mercury   Restart only Mercury app service."
    echo "  --mavproxy  Restart only MAVProxy service."
}

# Determine target(s)
case "$1" in
    "")
        TARGETS=("$MERCURY_SERVICE" "$MAVPROXY_SERVICE")
        ;;
    --mercury)
        TARGETS=("$MERCURY_SERVICE")
        ;;
    --mavproxy)
        TARGETS=("$MAVPROXY_SERVICE")
        ;;
    *)
        usage
        exit 1
        ;;
esac

for svc in "${TARGETS[@]}"; do
    echo "Restarting $svc..."
    sudo systemctl restart "$svc"
done

echo "Done."
