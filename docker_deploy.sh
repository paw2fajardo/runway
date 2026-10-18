#!/bin/sh
set -e

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [1|2|3]" >&2
  exit 2
fi

if [ "$#" -eq 1 ]; then
  VERSION_TYPE=$1
else
  printf "Version bump (1=small, 2=big, 3=major): "
  IFS= read -r VERSION_TYPE
fi

case "$VERSION_TYPE" in
  1|2|3) ;;
  *)
    echo "Invalid version type: $VERSION_TYPE (expected 1, 2, or 3)" >&2
    exit 2
    ;;
esac

git checkout main
git pull

CURRENT_VERSION=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' package.json)
if [ -z "$CURRENT_VERSION" ]; then
  echo "Could not read a numeric major.minor.patch version from package.json" >&2
  exit 1
fi

IFS=. read -r MAJOR MINOR PATCH <<EOF
$CURRENT_VERSION
EOF

case "$VERSION_TYPE" in
  1) VERSION="$MAJOR.$MINOR.$((PATCH + 1))"; BUMP_NAME=small ;;
  2) VERSION="$MAJOR.$((MINOR + 1)).0"; BUMP_NAME=big ;;
  3) VERSION="$((MAJOR + 1)).0.0"; BUMP_NAME=major ;;
esac

echo "Building runway version $VERSION ($BUMP_NAME bump from $CURRENT_VERSION)"

docker build -t "paw2fajardo/runway:$VERSION" -t paw2fajardo/runway:latest .
docker build --target payday-worker -t "paw2fajardo/runway-worker:$VERSION" -t paw2fajardo/runway-worker:latest .

docker push "paw2fajardo/runway:$VERSION"
docker push paw2fajardo/runway:latest
docker push "paw2fajardo/runway-worker:$VERSION"
docker push paw2fajardo/runway-worker:latest

PACKAGE_TMP="package.json.tmp.$$"
LOCK_TMP="package-lock.json.tmp.$$"
cleanup() { rm -f "$PACKAGE_TMP" "$LOCK_TMP"; }
trap cleanup EXIT

update_version_fields() {
  file=$1
  count=$2
  awk -v version="$VERSION" -v count="$count" '
    /"version"[[:space:]]*:/ && updated < count {
      sub(/"version"[[:space:]]*:[[:space:]]*"[^"]+"/, "\"version\": \"" version "\"")
      updated++
    }
    { print }
    END { if (updated != count) exit 1 }
  ' "$file"
}

update_version_fields package.json 1 > "$PACKAGE_TMP"
update_version_fields package-lock.json 2 > "$LOCK_TMP"
mv "$PACKAGE_TMP" package.json
mv "$LOCK_TMP" package-lock.json
trap - EXIT
echo "Saved release version $VERSION to package.json and package-lock.json."
