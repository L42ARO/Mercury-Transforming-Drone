#!/bin/bash
# Exit immediately if a command fails
set -e

# Go to your project directory
cd /home/ratbird/MercuryDelivery

# Activate the virtual environment
source /home/ratbird/MercuryDelivery/.venv/bin/activate

# Run your Python script
python app.py