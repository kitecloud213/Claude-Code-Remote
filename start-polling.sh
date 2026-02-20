#!/bin/bash
#
# Telegram Polling Bot - listens to a tmux session and relays commands
#

usage() {
    echo "Usage: ./start-polling.sh <tmux_target>"
    echo ""
    echo "  tmux_target   tmux session:window to listen (e.g. claude:0)"
    echo ""
    echo "Examples:"
    echo "  ./start-polling.sh claude:0     # listen to session 'claude', window 0"
    echo "  ./start-polling.sh claude:1     # listen to session 'claude', window 1"
    echo "  ./start-polling.sh dev:0        # listen to session 'dev', window 0"
    echo ""
    echo "Available tmux sessions:"
    tmux list-windows -a -F "  #{session_name}:#{window_index}  (#{window_name})" 2>/dev/null || echo "  (no tmux sessions found)"
}

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    usage
    exit 0
fi

if [[ -z "$1" ]]; then
    echo "Error: tmux_target is required"
    echo ""
    usage
    exit 1
fi

TARGET="$1"

# Verify the target exists
if ! tmux has-session -t "${TARGET%%:*}" 2>/dev/null; then
    echo "Error: tmux session '${TARGET%%:*}' not found"
    echo ""
    echo "Available tmux sessions:"
    tmux list-windows -a -F "  #{session_name}:#{window_index}  (#{window_name})" 2>/dev/null || echo "  (no tmux sessions found)"
    exit 1
fi

echo "🎯 Listening to tmux target: $TARGET"
INJECTION_MODE=tmux TMUX_SESSION="$TARGET" node start-telegram-polling.js
