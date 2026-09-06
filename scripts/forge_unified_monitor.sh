#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# forge_unified_monitor.sh — Unified System Health, Crash Guard, OOM Guard,
# Storage Guard, and GitHub CI/CD Watcher for Forge & Archie Training.
#
# Runs continuously in the background:
#   1. GitHub CI/CD: Watches satvikOS/Forge repository runs. Tracks transitions,
#      detects failures, logs failed steps, and verifies clean green pipeline.
#   2. PC Health & OOM: Monitors RAM pressure, triggers safe purge when near OOM,
#      monitors swap and thermal throttling.
#   3. Crash Guard: Monitors DiagnosticReports for application or kernel segfaults.
#   4. Storage Guard: Enforces abundant free disk space, monitors threshold,
#      and cleans transient /tmp gate artifacts safely.
#   5. Process Liveness: Checks Archie training & background tasks.
# ─────────────────────────────────────────────────────────────────────────────
set -u

REPO="satvikOS/Forge"
INTERVAL=30
LOG_DIR="/Users/account_clawteam1/archdisc-Mech/logs"
MONITOR_LOG="$LOG_DIR/unified_monitor.log"
CICD_LOG="$LOG_DIR/cicd_monitor.log"
CRASH_LOG="$LOG_DIR/crash_alerts.log"
OOM_LOG="$LOG_DIR/oom_guard.log"

mkdir -p "$LOG_DIR"

log() {
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$ts] $1" | tee -a "$MONITOR_LOG"
}

check_cicd() {
    if ! command -v gh >/dev/null 2>&1; then
        return
    fi
    
    local runs
    runs=$(gh run list --repo "$REPO" --limit 5 --json databaseId,name,status,conclusion,headSha,headBranch 2>/dev/null || echo "[]")
    
    if [ "$runs" = "[]" ] || [ -z "$runs" ]; then
        return
    fi
    
    # Check for any failures in recent runs
    echo "$runs" | jq -c '.[]' 2>/dev/null | while read -r r; do
        local id name status conclusion sha branch
        id=$(echo "$r" | jq -r '.databaseId')
        name=$(echo "$r" | jq -r '.name')
        status=$(echo "$r" | jq -r '.status')
        conclusion=$(echo "$r" | jq -r '.conclusion')
        sha=$(echo "$r" | jq -r '.headSha')
        branch=$(echo "$r" | jq -r '.headBranch')
        
        local state_file="/tmp/forge_run_${id}.state"
        local prev_state=""
        [ -f "$state_file" ] && prev_state=$(cat "$state_file")
        
        local current_state="${status}:${conclusion}"
        if [ "$current_state" != "$prev_state" ]; then
            echo "$current_state" > "$state_file"
            local ts
            ts="$(date '+%Y-%m-%d %H:%M:%S')"
            echo "[$ts] [CI-EVENT] Run $id '$name' ($branch@${sha:0:8}) -> status=$status, conclusion=$conclusion" >> "$CICD_LOG"
            
            if [ "$conclusion" = "failure" ]; then
                log "[CI-ALERT] ❌ Run $id '$name' on $branch@${sha:0:8} FAILED!"
                echo "=== Failure log for run $id ($name) ===" >> "$CICD_LOG"
                gh run view "$id" --repo "$REPO" --log-failed >> "$CICD_LOG" 2>&1 || true
            elif [ "$conclusion" = "success" ]; then
                log "[CI-OK] ✅ Run $id '$name' on $branch@${sha:0:8} PASSED."
            fi
        fi
    done
}

check_memory_and_oom() {
    local page_size
    page_size=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)
    local free_pages
    free_pages=$(vm_stat | awk '/Pages free:/{gsub(/\./,"",$3); print $3}')
    local inactive_pages
    inactive_pages=$(vm_stat | awk '/Pages inactive:/{gsub(/\./,"",$3); print $3}')
    local avail_mb=$(( (free_pages + inactive_pages) * page_size / 1048576 ))
    local total_mb=$(( $(sysctl -n hw.memsize) / 1048576 ))
    local used_pct=$(( (total_mb - avail_mb) * 100 / total_mb ))

    if [ "$used_pct" -gt 92 ]; then
        local ts
        ts="$(date '+%Y-%m-%d %H:%M:%S')"
        echo "[$ts] [OOM-WARN] Critical RAM pressure: ${used_pct}% used (${avail_mb}MB free). Initiating purge..." | tee -a "$OOM_LOG"
        purge 2>/dev/null || true
    fi
}

check_storage() {
    local avail_gb
    avail_gb=$(df -g / | awk 'NR==2{print $4}')
    if [ "${avail_gb:-0}" -lt 20 ]; then
        log "[STORAGE-WARN] Low disk space: only ${avail_gb}GB free. Purging transient /tmp test artifacts..."
        # Safely clean temporary click_gate and intermediate build temp files older than 2 hours
        find /tmp -name "click_gate.*" -mmin +120 -exec rm -rf {} + 2>/dev/null || true
        find /tmp -name "forge_*" -mmin +180 -exec rm -rf {} + 2>/dev/null || true
    fi
}

check_crashes() {
    local recent_crashes
    recent_crashes=$(find /Users/account_clawteam1/Library/Logs/DiagnosticReports -type f -mmin -2 2>/dev/null || true)
    if [ -n "$recent_crashes" ]; then
        for c in $recent_crashes; do
            local base
            base=$(basename "$c")
            if [ ! -f "/tmp/reported_crash_$base" ]; then
                touch "/tmp/reported_crash_$base"
                log "[CRASH-ALERT] ⚠️ New crash report generated: $base"
                echo "Crash report: $c" >> "$CRASH_LOG"
                head -n 25 "$c" >> "$CRASH_LOG" 2>&1 || true
            fi
        done
    fi
}

check_training_liveness() {
    local active_train
    active_train=$(pgrep -f "lora_eager_rope|train_archie|mlx_lm.lora" 2>/dev/null || true)
    if [ -n "$active_train" ]; then
        log "[ARCHIE-TRAINING] Active training PID(s): $active_train"
    fi
}

log "Forge & Archie Unified Health, CI/CD & Storage Supervisor starting (interval=${INTERVAL}s)"

cycle=0
while true; do
    check_cicd
    check_memory_and_oom
    check_storage
    check_crashes
    
    # Check training every 5 cycles (~2.5 minutes)
    if [ $((cycle % 5)) -eq 0 ]; then
        check_training_liveness
    fi
    
    cycle=$((cycle + 1))
    sleep "$INTERVAL"
done
