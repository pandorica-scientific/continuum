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

# Compose hands optional variables over as empty strings, and adapter-node
# refuses an empty ORIGIN outright rather than treating it as unset. Unset means
# "discover it from the sidecar", so an empty one is dropped before node starts.
[ -n "$ORIGIN" ] || unset ORIGIN

exec node build
