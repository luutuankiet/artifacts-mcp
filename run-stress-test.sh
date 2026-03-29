#!/bin/bash
set -e

# Start server in background
PORT=3335 BASE_URL=http://localhost:3335 node src/index.js &
SERVER_PID=$!
sleep 2

# Run tests
ARTIFACT_HOST=localhost:3335 node tests/e2e-stress.mjs
RESULT=$?

# Cleanup
kill $SERVER_PID 2>&1 || true
exit $RESULT
