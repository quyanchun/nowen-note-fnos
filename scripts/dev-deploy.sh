#!/usr/bin/env bash
# Development updates from the current working tree. No old-package backup or rollback.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-all}"
case "$TARGET" in
  -h|--help) printf 'Usage: %s [all|nas|mac|build]\nConfig: deploy/fnos-private/dev.local.env (not committed)\nQuit Nowen Note before mac/all. User data and NAS ports are preserved.\n' "$0"; exit 0 ;;
  all|nas|mac|build) ;;
  *) echo 'Expected all, nas, mac or build' >&2; exit 2 ;;
esac
CONFIG="${DEV_DEPLOY_ENV:-$ROOT/deploy/fnos-private/dev.local.env}"
if [[ -f "$CONFIG" ]]; then source "$CONFIG"; fi
if [[ -n "${MAC_SIGN_IDENTITY:-}" ]]; then export MAC_SIGN_IDENTITY; fi
OUT="$ROOT/dist-private/dev-deploy"
mkdir -p "$OUT"
if [[ "$TARGET" == all || "$TARGET" == mac ]]; then
  python3 "$ROOT/scripts/dev-deploy.py" mac-check "$ROOT" "${MAC_APP:-/Applications/Nowen Note.app}"
fi
printf '\nBuilding current backend and frontend…\n'
npm --prefix "$ROOT/backend" run build
npm --prefix "$ROOT/frontend" run build
if [[ "$TARGET" == all || "$TARGET" == nas || "$TARGET" == build ]]; then
  tar -czf "$OUT/latest.tar.gz" -C "$ROOT" backend/dist backend/package.json backend/package-lock.json frontend/dist
  echo "NAS payload: $(du -h "$OUT/latest.tar.gz" | cut -f1)"
fi
if [[ "$TARGET" == all || "$TARGET" == nas ]]; then
  : "${NAS_SSH:?Set NAS_SSH=user@host in the local config}"
  REMOTE="${NAS_UPLOAD_DIR:-.cache/nowen-dev-deploy}"
  [[ "$REMOTE" =~ ^[a-zA-Z0-9_./-]+$ ]] || { echo 'NAS_UPLOAD_DIR must be a simple remote path' >&2; exit 2; }
  SSH_OPTS=(-o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
  if [[ -n "${NAS_CONTROL_PATH:-}" ]]; then SSH_OPTS+=(-o "ControlPath=$NAS_CONTROL_PATH" -o ControlMaster=auto -o ControlPersist=3600); fi
  if [[ -n "${NAS_KEYCHAIN_SERVICE:-}" ]]; then
    export NAS_KEYCHAIN_SERVICE
    export NAS_KEYCHAIN_ACCOUNT="${NAS_KEYCHAIN_ACCOUNT:-${NAS_SSH%%@*}}"
    ASKPASS="$(mktemp -t nowen-askpass.XXXXXX)"
    trap 'rm -f "$ASKPASS"' EXIT
    cat > "$ASKPASS" <<'ASK'
#!/bin/sh
exec security find-generic-password -s "$NAS_KEYCHAIN_SERVICE" -a "$NAS_KEYCHAIN_ACCOUNT" -w
ASK
    chmod 700 "$ASKPASS"
    export SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force
  fi
  ssh "${SSH_OPTS[@]}" "$NAS_SSH" "mkdir -p '$REMOTE'"
  scp "${SSH_OPTS[@]}" "$OUT/latest.tar.gz" "$ROOT/scripts/dev-deploy.py" "$NAS_SSH:$REMOTE/"
  CONTAINER="${NAS_CONTAINER:-nowen-note-private}"
  [[ "$CONTAINER" =~ ^[a-zA-Z0-9_.-]+$ ]] || { echo 'Invalid container name' >&2; exit 2; }
  IMAGE="local/$CONTAINER:dev-$(date +%Y%m%d%H%M%S)"
  SHA="$(shasum -a 256 "$OUT/latest.tar.gz" | cut -d' ' -f1)"
  COMMAND="python3 '$REMOTE/dev-deploy.py' nas '$REMOTE/latest.tar.gz' '$CONTAINER' '$IMAGE' '$SHA'"
  if [[ -n "${NAS_KEYCHAIN_SERVICE:-}" ]]; then
    security find-generic-password -s "$NAS_KEYCHAIN_SERVICE" -a "$NAS_KEYCHAIN_ACCOUNT" -w |
      ssh "${SSH_OPTS[@]}" "$NAS_SSH" "sudo -S -p '' $COMMAND"
  else
    ssh "${SSH_OPTS[@]}" -t "$NAS_SSH" "sudo $COMMAND"
  fi
fi
if [[ "$TARGET" == all || "$TARGET" == mac ]]; then
  python3 "$ROOT/scripts/dev-deploy.py" mac "$ROOT" "${MAC_APP:-/Applications/Nowen Note.app}"
fi
