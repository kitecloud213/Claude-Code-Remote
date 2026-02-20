#!/bin/bash
#
# Auto-create tmux session with Claude Code + Polling Bot
# Claude Code will resume the last conversation automatically
#
# Usage: ./start-tmux-session.sh
#

SESSION="claude"
PROJECT_DIR="$HOME/projects/Claude-Code-Remote"

# Skip if session already exists
if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux session '$SESSION' already exists. Attach with: tmux attach -t $SESSION"
    exit 0
fi

echo "Creating tmux session '$SESSION'..."

# Window 0: Claude Code (resume last conversation)
tmux new-session -d -s "$SESSION" -n claude -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION:0" "claude --resume" Enter

# Window 1: Polling bot
tmux new-window -t "$SESSION" -n polling -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION:1" "./start-polling.sh ${SESSION}:0" Enter

# Focus on window 0
tmux select-window -t "$SESSION:0"

echo "✅ tmux session '$SESSION' created"
echo "   window 0: Claude Code (resumed)"
echo "   window 1: Telegram Polling Bot"
echo ""
echo "Attach with: tmux attach -t $SESSION"
