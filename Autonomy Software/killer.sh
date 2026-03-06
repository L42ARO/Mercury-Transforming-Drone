#!/bin/bash

# Services
MERCURY_SERVICE="mercury_app.service"
MAVPROXY_SERVICE="mavproxy.service"

usage() {
    echo "Usage: $0 [--mercury | --mavproxy]"
    echo
    echo "No arguments: stop BOTH services."
    echo "  --mercury   Stop only Mercury app service."
    echo "  --mavproxy  Stop only MAVProxy service."
}

# Determine target(s)
case "$1" in
    "")
        # No args -> stop both
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
    echo "Stopping $svc..."
    sudo systemctl stop "$svc"
done

echo "Done."
