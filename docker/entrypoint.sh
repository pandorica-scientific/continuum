#!/bin/sh
# Two jobs: hand out the Compose file, or run the app.
#
#   docker run --rm kerth92/continuum compose > compose.yaml
#
# prints the Compose file this image was built with, so an install needs
# nothing from anywhere but Docker Hub. Anything else starts the server.
set -e

if [ "$1" = "compose" ]; then
	exec cat /app/compose.yaml
fi

# The mDNS announcer — the `mdns` service in compose.yaml, on the host network,
# answering continuum.local for the machine.
if [ "$1" = "mdns" ]; then
	exec node /app/mdns.mjs
fi

exec node build
