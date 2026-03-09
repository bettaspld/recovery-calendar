#!/bin/bash
# Recovery Calendar — Local Preview Server
# Double-click this file to start, then open http://localhost:8080

cd "$(dirname "$0")"

PORT=8080

# Kill any existing server on this port
lsof -ti:$PORT | xargs kill -9 2>/dev/null

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     Recovery Calendar — Local Mode     ║"
echo "  ╠═══════════════════════════════════════╣"
echo "  ║                                       ║"
echo "  ║  Server running at:                   ║"
echo "  ║  http://localhost:$PORT               ║"
echo "  ║                                       ║"
echo "  ║  Press Ctrl+C to stop                 ║"
echo "  ║                                       ║"
echo "  ║  Note: AI features (search, What to   ║"
echo "  ║  Expect, Find Local) need Netlify.    ║"
echo "  ║  Everything else works locally.        ║"
echo "  ║                                       ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# Open in default browser after a short delay
(sleep 1 && open "http://localhost:$PORT") &

# Start Python HTTP server
python3 -m http.server $PORT
