#!/bin/bash
# Timeline Memory CLI Tool

DB_PATH="$HOME/.opencode/memory/memory.db"
TIMELINE_PATH="$HOME/.opencode/memory/timeline"

show_help() {
    echo "Timeline Memory CLI"
    echo ""
    echo "Usage: memory <command> [args]"
    echo ""
    echo "Commands:"
    echo "  store <content>     Store a new memory"
    echo "  recall <query>      Search memories"
    echo "  stats               Show memory statistics"
    echo "  list [tier]         List memories by tier"
    echo "  migrate             Run content migration"
    echo "  cleanup             Clean up isolated memories"
    echo ""
    echo "Tiers: hot, warm, cold, isolated"
}

cmd_stats() {
    echo "📊 Memory Statistics"
    echo "==================="
    
    total=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM blocks;")
    echo "Total blocks: $total"
    
    echo ""
    echo "By tier:"
    sqlite3 "$DB_PATH" "SELECT tier, COUNT(*) as count FROM blocks GROUP BY tier ORDER BY tier;"
    
    echo ""
    echo "Timeline files:"
    ls -la "$TIMELINE_PATH"/*.md 2>/dev/null | wc -l
}

cmd_list() {
    tier=${1:-"all"}
    
    if [ "$tier" = "all" ]; then
        sqlite3 "$DB_PATH" "SELECT id, summary, tier, weight FROM blocks ORDER BY weight DESC LIMIT 20;"
    else
        sqlite3 "$DB_PATH" "SELECT id, summary, weight FROM blocks WHERE tier='$tier' ORDER BY weight DESC LIMIT 20;"
    fi
}

cmd_recall() {
    query="$1"
    if [ -z "$query" ]; then
        echo "Error: Please provide a search query"
        exit 1
    fi
    
    echo "🔍 Searching for: $query"
    echo ""
    sqlite3 "$DB_PATH" "SELECT id, summary, tier FROM blocks WHERE content LIKE '%$query%' OR summary LIKE '%$query%' LIMIT 10;"
}

cmd_cleanup() {
    echo "🧹 Cleaning up isolated memories..."
    deleted=$(sqlite3 "$DB_PATH" "DELETE FROM blocks WHERE tier='isolated' AND access_count=0; SELECT changes();")
    echo "Deleted: $deleted blocks"
}

case "$1" in
    store)
        echo "Use OpenCode tool: memory_store"
        ;;
    recall)
        cmd_recall "$2"
        ;;
    stats)
        cmd_stats
        ;;
    list)
        cmd_list "$2"
        ;;
    migrate)
        echo "Run: cd ~/.config/opencode/plugin && bun migrate.ts"
        ;;
    cleanup)
        cmd_cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        ;;
esac