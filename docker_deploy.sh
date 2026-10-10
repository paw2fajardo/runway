#!/bin/sh
set -e

if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [small|big|major]" >&2
  exit 2
fi

if [ "$#" -eq 1 ]; then
  VERSION_TYPE=$1
else
  printf "Version bump (small/big/major): "
  IFS= read -r VERSION_TYPE
fi

case "$VERSION_TYPE" in
  small|big|major) ;;
  *)
    echo "Invalid version type: $VERSION_TYPE (expected small, big, or major)" >&2
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
  small) VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
  big) VERSION="$MAJOR.$((MINOR + 1)).0" ;;
  major) VERSION="$((MAJOR + 1)).0.0" ;;
esac

echo "Building runway version $VERSION ($VERSION_TYPE bump from $CURRENT_VERSION)"

docker build -t "paw2fajardo/runway:$VERSION" -t paw2fajardo/runway:latest .
docker build --target payday-worker -t "paw2fajardo/runway-worker:$VERSION" -t paw2fajardo/runway-worker:latest .

docker push "paw2fajardo/runway:$VERSION"
docker push paw2fajardo/runway:latest
docker push "paw2fajardo/runway-worker:$VERSION"
docker push paw2fajardo/runway-worker:latest
