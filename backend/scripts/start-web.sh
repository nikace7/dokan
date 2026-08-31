#!/bin/sh
set -eu

# prometheus-client requires a clean directory before each Gunicorn master.
# Keep this a fixed, narrow path so cleanup can never target application data.
mkdir -p /tmp/dokan-prometheus
find /tmp/dokan-prometheus -mindepth 1 -maxdepth 1 -type f -delete

python manage.py collectstatic --noinput
exec gunicorn config.wsgi:application --config config/gunicorn.py
