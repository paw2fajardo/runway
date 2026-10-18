#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT
mkdir "$TEMP/bin" "$TEMP/work"
cp "$ROOT/docker_deploy.sh" "$TEMP/work/"
cat > "$TEMP/work/package.json" <<'EOF'
{
  "name": "fixture",
  "version": "1.2.3"
}
EOF
cat > "$TEMP/work/package-lock.json" <<'EOF'
{
  "name": "fixture",
  "version": "1.2.3",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "fixture",
      "version": "1.2.3"
    }
  }
}
EOF
cat > "$TEMP/bin/git" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$TEMP/bin/docker" <<'EOF'
#!/bin/sh
if [ "${FAIL_PUSH:-0}" = 1 ] && [ "$1" = push ]; then exit 1; fi
printf '%s\n' "$*" >> "$CALL_LOG"
EOF
chmod +x "$TEMP/bin/git" "$TEMP/bin/docker"
export PATH="$TEMP/bin:$PATH" CALL_LOG="$TEMP/calls"

reset_files() {
  cat > "$TEMP/work/package.json" <<'EOF'
{
  "name": "fixture",
  "version": "1.2.3"
}
EOF
  cat > "$TEMP/work/package-lock.json" <<'EOF'
{
  "name": "fixture",
  "version": "1.2.3",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "fixture",
      "version": "1.2.3"
    }
  }
}
EOF
}

for pair in '1 1.2.4' '2 1.3.0' '3 2.0.0'; do
  set -- $pair
  reset_files
  : > "$CALL_LOG"
  (cd "$TEMP/work" && sh ./docker_deploy.sh "$1")
  grep -q '"version": "'"$2"'"' "$TEMP/work/package.json"
  grep -q '"version": "'"$2"'"' "$TEMP/work/package-lock.json"
  grep -q "paw2fajardo/runway:$2" "$CALL_LOG"
done

reset_files
if (cd "$TEMP/work" && FAIL_PUSH=1 sh ./docker_deploy.sh 1 >/dev/null 2>&1); then
  echo 'Push failure must fail the deploy.' >&2
  exit 1
fi
grep -q '"version": "1.2.3"' "$TEMP/work/package.json"
grep -q '"version": "1.2.3"' "$TEMP/work/package-lock.json"
(cd "$TEMP/work" && sh ./docker_deploy.sh 1 >/dev/null)
grep -q '"version": "1.2.4"' "$TEMP/work/package.json"
echo 'PASS: numeric bumps, version persistence, failed push safety, and repeated patch bump.'
