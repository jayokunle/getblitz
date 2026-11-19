#!/usr/bin/env bash
# GetBlitz shutdown — Stage 4 runner.
#
# DRY RUN BY DEFAULT: prints what each step WOULD change. Nothing changes
# without --execute. Destructive steps also need the confirmation token that
# the app returns for the current data, so a stale plan cannot run.
#
# Order (from the shutdown plan):
#   1 block-sessions  BLOCK_NEW_PAYMENT_SESSIONS=true on the app, redeploy,
#                     then wait until no PENDING/PARTIAL session is still open
#   2 revoke-banks    delete our webhook at Qonto/Wise, revoke tokens, wipe
#                     stored credentials/config/webhook secrets
#   3 delete-keys     delete all API keys and merchant webhooks
#   4 purge           delete all orgs except KEEP_ORG_SLUGS + their non-member users
#   5 notice          move getblitz.io, www, app. to the static notice app; docs. via Pages
#   6 stop            stop the GetBlitz app and website in Coolify (no deletes)
#
# Usage:
#   shutdown/run.sh                    # dry run of all steps
#   shutdown/run.sh --execute          # run all steps
#   shutdown/run.sh --execute --step 2 # run one step
#
# Environment:
#   SHUTDOWN_SECRET   value of SHUTDOWN_NOTICE_SECRET on the app (required for live data)
#   COOLIFY_URL       e.g. https://coolify.example.com   (steps 1, 5, 6)
#   COOLIFY_TOKEN     Coolify API token with write+deploy (steps 1, 5, 6)
#   NOTICE_UUID       Coolify uuid of the static notice app (step 5)
#   BACKUP_FILE       path of the verified backup from backup.sh (required for step 4)
#   APP_URL           default https://app.getblitz.io
#   KEEP_ORG_SLUGS    default jayokunle,test,test4325
#   SHUTDOWN_AT       default 2026-11-19T11:00:00Z (12:00 CET); --execute refuses before it
#
# Output and LOG.md entries contain counts, slugs and provider names only.
set -euo pipefail

APP_URL="${APP_URL:-https://app.getblitz.io}"
APP_UUID="${APP_UUID:-hy5ifixzasfpycsiggyptajs}"
WEBSITE_UUID="${WEBSITE_UUID:-rjdcllp6unds5vcaz66ci9v9}"
KEEP_ORG_SLUGS="${KEEP_ORG_SLUGS:-jayokunle,test,test4325}"
SHUTDOWN_AT="${SHUTDOWN_AT:-2026-11-19T11:00:00Z}"
NOTICE_DOMAINS="https://getblitz.io,https://www.getblitz.io,https://app.getblitz.io"
LOG="$(dirname "$0")/LOG.md"

EXECUTE=0; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --dry-run) EXECUTE=0 ;;
    --step) ONLY="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
log() { printf -- '- %s run.sh: %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$*" >> "$LOG"; }
die() { say "ERROR: $*" >&2; exit 1; }
want() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }
need() { [[ -n "${!1:-}" ]] || die "$1 is required for this step"; }
keep_json() { printf '%s' "$KEEP_ORG_SLUGS" | jq -R 'split(",")'; }

api() { # api MODE [EXECUTE CONFIRM]
  need SHUTDOWN_SECRET
  local body
  body="$(jq -nc --arg m "$1" --argjson k "$(keep_json)" \
    --argjson e "${2:-false}" --arg c "${3:-}" \
    '{mode:$m, keepOrgSlugs:$k, execute:$e, confirm:$c}')"
  curl -fsS -X POST "$APP_URL/api/internal/shutdown" \
    -H "content-type: application/json" \
    -H "x-shutdown-secret: $SHUTDOWN_SECRET" -d "$body"
}

coolify() { # coolify METHOD PATH [JSON]
  need COOLIFY_URL; need COOLIFY_TOKEN
  curl -fsS -X "$1" "$COOLIFY_URL/api/v1$2" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    -H "content-type: application/json" ${3:+-d "$3"}
}

command -v jq >/dev/null || die "jq not found"
command -v curl >/dev/null || die "curl not found"

if [[ $EXECUTE -eq 1 ]]; then
  now="$(date -u +%s)"; at="$(date -u -d "$SHUTDOWN_AT" +%s)"
  [[ $now -ge $at ]] || die "refusing to execute before SHUTDOWN_AT ($SHUTDOWN_AT)"
  say "*** EXECUTE MODE — changes will be made ***"
else
  say "*** DRY RUN — nothing will be changed ***"
fi

plan=""
if [[ -n "${SHUTDOWN_SECRET:-}" ]]; then
  plan="$(api plan)"
else
  say "(SHUTDOWN_SECRET not set: showing the static plan without live counts)"
fi
pj() { [[ -n "$plan" ]] && jq -r "$1" <<<"$plan" || echo "?"; }

# ---- 1 ----------------------------------------------------------------------
if want 1; then
  say ""; say "STEP 1  block new payment sessions"
  say "  current flag: $(pj .blockNewPaymentSessions)   in-flight sessions: $(pj '.inFlightSessions | length') ($(pj '.inFlightSessions | unique | join(", ")'))"
  say "  would: set BLOCK_NEW_PAYMENT_SESSIONS=true on app $APP_UUID and redeploy (no rebuild),"
  say "         then wait (max 30 min) until no PENDING/PARTIAL session is still open"
  if [[ $EXECUTE -eq 1 ]]; then
    coolify PATCH "/applications/$APP_UUID/envs" \
      '{"key":"BLOCK_NEW_PAYMENT_SESSIONS","value":"true","is_preview":false}' >/dev/null
    coolify GET "/deploy?uuid=$APP_UUID&force=false" >/dev/null
    say "  deploy queued; waiting for the flag and for in-flight sessions…"
    for _ in $(seq 1 60); do
      p="$(api plan 2>/dev/null || true)"
      if [[ "$(jq -r '.blockNewPaymentSessions' <<<"$p" 2>/dev/null)" == "true" &&
            "$(jq -r '.inFlightSessions | length' <<<"$p")" == "0" ]]; then break; fi
      sleep 30
    done
    log "step 1 done — new sessions blocked; in-flight now $(jq -r '.inFlightSessions | length' <<<"$p")"
  fi
fi

# ---- 2 ----------------------------------------------------------------------
if want 2; then
  say ""; say "STEP 2  revoke bank access, then wipe stored credentials"
  if [[ -n "$plan" ]]; then
    jq -r '.bankConnectionsWithSecrets[] | "  would revoke: \(.org) / \(.provider) (\(.status), webhook=\(.hasWebhook), kept org=\(.kept))"' <<<"$plan"
  fi
  if [[ $EXECUTE -eq 1 ]]; then
    tok="$(api revoke-banks | jq -r .confirm)"
    res="$(api revoke-banks true "$tok")"
    jq -r '.results[] | "  \(.org) / \(.provider): webhook=\(.webhook) token=\(.token) wiped=\(.storedSecretsWiped)\(if .manualAction then "  MANUAL: " + .manualAction else "" end)"' <<<"$res"
    log "step 2 done — $(jq -c '[.results[] | {org,provider,webhook,token}]' <<<"$res")"
  fi
fi

# ---- 3 ----------------------------------------------------------------------
if want 3; then
  say ""; say "STEP 3  delete API keys and merchant webhooks"
  say "  would delete: apikey=$(pj .apiKeys) organization_webhook=$(pj .merchantWebhooks)"
  if [[ $EXECUTE -eq 1 ]]; then
    tok="$(api delete-keys | jq -r .confirm)"
    res="$(api delete-keys true "$tok")"
    say "  deleted: $(jq -c .deleted <<<"$res")"
    log "step 3 done — deleted $(jq -c .deleted <<<"$res")"
  fi
fi

# ---- 4 ----------------------------------------------------------------------
if want 4; then
  say ""; say "STEP 4  delete all data except orgs: $KEEP_ORG_SLUGS (and their members)"
  if [[ -n "$plan" ]]; then
    say "  keeps (unchanged): $(pj '.kept | to_entries | map("\(.key)=\(.value)") | join(" ")')"
    say "  would delete orgs ($(pj '.purge.deleteOrgSlugs | length')): $(pj '.purge.deleteOrgSlugs | join(", ")')"
    say "  would delete rows: $(pj '.purge.rows | to_entries | map("\(.key)=\(.value)") | join(" ")')"
  fi
  if [[ $EXECUTE -eq 1 ]]; then
    need BACKUP_FILE; [[ -s "$BACKUP_FILE" ]] || die "BACKUP_FILE does not exist: $BACKUP_FILE"
    tok="$(api purge | jq -r .confirm)"
    res="$(api purge true "$tok")"
    say "  deleted: $(jq -c .deleted <<<"$res")"
    say "  kept unchanged: $(jq -r .keptUnchanged <<<"$res")"
    [[ "$(jq -r .keptUnchanged <<<"$res")" == "true" ]] || die "kept data changed — investigate"
    log "step 4 done — deleted $(jq -c .deleted <<<"$res"); keptUnchanged=$(jq -r .keptUnchanged <<<"$res")"
  fi
fi

# ---- 5 ----------------------------------------------------------------------
if want 5; then
  say ""; say "STEP 5  switch domains to the static notice"
  say "  would: remove domains from app $APP_UUID and website $WEBSITE_UUID,"
  say "         set $NOTICE_DOMAINS on notice app ${NOTICE_UUID:-<NOTICE_UUID>} and deploy it"
  say "  docs.getblitz.io (GitHub Pages): copy shutdown/deploy-docs-notice.yml over .github/workflows/deploy-docs.yml and merge"
  if [[ $EXECUTE -eq 1 ]]; then
    need NOTICE_UUID
    coolify PATCH "/applications/$APP_UUID" '{"domains":""}' >/dev/null
    coolify PATCH "/applications/$WEBSITE_UUID" '{"domains":""}' >/dev/null
    coolify PATCH "/applications/$NOTICE_UUID" "$(jq -nc --arg d "$NOTICE_DOMAINS" '{domains:$d}')" >/dev/null
    coolify GET "/deploy?uuid=$NOTICE_UUID&force=false" >/dev/null
    log "step 5 done — domains moved to notice app $NOTICE_UUID"
  fi
fi

# ---- 6 ----------------------------------------------------------------------
if want 6; then
  say ""; say "STEP 6  stop GetBlitz apps in Coolify (no deletes; DB, Valkey, servers untouched)"
  say "  would stop: app $APP_UUID, website $WEBSITE_UUID"
  if [[ $EXECUTE -eq 1 ]]; then
    coolify GET "/applications/$APP_UUID/stop" >/dev/null
    coolify GET "/applications/$WEBSITE_UUID/stop" >/dev/null
    log "step 6 done — app and website stopped"
  fi
fi

say ""; [[ $EXECUTE -eq 1 ]] && say "Done." || say "Dry run complete. Re-run with --execute after GATE 3."
