#!/bin/bash

MERCURY_SERVICE="mercury_app.service"
MAVPROXY_SERVICE="mavproxy.service"

usage() {
    echo "Usage: $0 --mercury | --mavproxy"
    echo
    echo "  --mercury   Follow logs for Mercury app (journalctl -u mercury_app.service -f)"
    echo "  --mavproxy  Follow logs for MAVProxy (journalctl -u mavproxy.service -f)"
}

case "$1" in
    --mercury)
        SERVICE="$MERCURY_SERVICE"
        ;;
    --mavproxy)
        SERVICE="$MAVPROXY_SERVICE"
        ;;
    *)
        usage
        exit 1
        ;;
esac

echo "Following logs for $SERVICE (Ctrl+C to exit)..."
# -f = follow, -n 100 = show last 100 lines then follow
sudo journalctl -u "$SERVICE" -n 100 -f
