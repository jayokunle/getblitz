#!/usr/bin/env bash
# GetBlitz shutdown — Stage 3: encrypted backup of the GetBlitz database,
# verified by restoring it into a throwaway database and comparing row counts.
#
# Runs on the operator's machine (the agent session cannot reach the DB).
# The unencrypted dump never touches disk: pg_dump | gpg (AES-256, symmetric).
#
# Requirements: pg_dump/pg_restore/psql (v17+ to match the server), gpg,
#               and either Docker (default) or SCRATCH_URL for the restore test.
#
# Usage:
#   export PGHOST=... PGPORT=... PGUSER=... PGDATABASE=...   # GetBlitz DB only
#   export PGPASSWORD=...        # or use ~/.pgpass
#   shutdown/backup.sh                     # dump + encrypt + verify
#   shutdown/backup.sh --verify FILE.gpg   # verify an existing backup only
#
# Optional:
#   OUT_DIR=~/getblitz-shutdown-backup    where the .gpg file goes (outside the repo)
#   SCRATCH_URL=postgres://...            empty scratch DB instead of Docker
#   GPG_PASSPHRASE_FILE=path              non-interactive passphrase (else gpg prompts)
#
# Output contains table names and row counts only.
set -euo pipefail

OUT_DIR="${OUT_DIR:-$HOME/getblitz-shutdown-backup}"
VERIFY_ONLY=""
if [[ "${1:-}" == "--verify" ]]; then VERIFY_ONLY="${2:?file required}"; fi

die() { echo "ERROR: $*" >&2; exit 1; }
for bin in pg_dump pg_restore psql gpg; do
  command -v "$bin" >/dev/null || die "$bin not found"
done
: "${PGHOST:?set PGHOST}" "${PGDATABASE:?set PGDATABASE}"

gpg_pass_args=()
if [[ -n "${GPG_PASSPHRASE_FILE:-}" ]]; then
  gpg_pass_args=(--batch --pinentry-mode loopback --passphrase-file "$GPG_PASSPHRASE_FILE")
fi

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$VERIFY_ONLY" ]]; then
  out="$(realpath -m "$OUT_DIR")"
  if [[ -n "$repo_root" && "$out" == "$repo_root"* ]]; then
    die "OUT_DIR must be outside the repository"
  fi
  mkdir -p "$out"; chmod 700 "$out"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  FILE="$out/getblitz-${PGDATABASE}-${stamp}.dump.gpg"
  echo "==> Dumping $PGDATABASE and encrypting to $FILE"
  pg_dump --format=custom --no-owner --no-acl \
    | gpg "${gpg_pass_args[@]}" --symmetric --cipher-algo AES256 \
          --compress-algo none --output "$FILE"
  chmod 600 "$FILE"
  (cd "$out" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256")
  echo "    size: $(du -h "$FILE" | cut -f1)  sha256: $(cut -c1-16 "$FILE.sha256")…"
else
  FILE="$VERIFY_ONLY"
  [[ -f "$FILE" ]] || die "no such file: $FILE"
fi

# ---- scratch database --------------------------------------------------------
container=""
cleanup() { [[ -n "$container" ]] && docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [[ -n "${SCRATCH_URL:-}" ]]; then
  scratch="$SCRATCH_URL"
else
  command -v docker >/dev/null || die "docker not found (or set SCRATCH_URL)"
  container="getblitz-restore-check-$$"
  pw="$(openssl rand -hex 16)"
  docker run -d --rm --name "$container" -e POSTGRES_PASSWORD="$pw" \
    -e POSTGRES_DB=restorecheck -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
  port="$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')"
  scratch="postgres://postgres:${pw}@127.0.0.1:${port}/restorecheck"
  for _ in $(seq 1 30); do psql "$scratch" -qAtc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
fi

echo "==> Restoring into scratch database"
gpg "${gpg_pass_args[@]}" --quiet --decrypt "$FILE" \
  | pg_restore --no-owner --no-acl --exit-on-error -d "$scratch"

echo "==> Comparing row counts (live vs restored)"
tables="$(psql -qAtc "select tablename from pg_tables where schemaname='public' order by 1")"
fail=0
printf '%-28s %10s %10s\n' table live restored
for t in $tables; do
  live="$(psql -qAtc "select count(*) from public.\"$t\"")"
  rest="$(psql "$scratch" -qAtc "select count(*) from public.\"$t\"")"
  mark=""; [[ "$live" == "$rest" ]] || { mark="  <-- MISMATCH"; fail=1; }
  printf '%-28s %10s %10s%s\n' "$t" "$live" "$rest" "$mark"
done
if [[ $fail -ne 0 ]]; then
  echo "RESULT: MISMATCH (rows may have changed while the app is running; re-run, or stop the app first)"
  exit 2
fi
echo "RESULT: OK — backup restores and all row counts match"
echo "Backup: $FILE"
