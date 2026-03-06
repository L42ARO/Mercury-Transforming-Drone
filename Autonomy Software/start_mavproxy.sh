#!/bin/bash
set -e

# Activate the Python virtual environment
source /home/ratbird/.venv/bin/activate

# Detect if we're running in an interactive terminal
if [ -t 0 ]; then
    # Interactive (manual run over SSH)
    echo "[$(date)] Starting MAVProxy in INTERACTIVE mode"
    MAVPROXY_OPTS=""
else
    # Non-interactive (e.g. systemd)
    echo "[$(date)] Starting MAVProxy in NON-INTERACTIVE mode (no TTY)"
    MAVPROXY_OPTS="--daemon"
fi

# Replace the shell with MAVProxy so systemd tracks the right PID
exec mavproxy.py \
    --master=/dev/ttyAMA0 \
    --baudrate 115200 \
    --out=udp:127.0.0.1:14550 \
    $MAVPROXY_OPTS
