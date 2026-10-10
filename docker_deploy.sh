#!/bin/sh
set -e

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 small|big|major" >&2
  exit 2
fi

VERSION_TYPE=$1
case "$VERSION_TYPE" in
  small|big|major) ;;
  *)
    echo "Invalid version type: $VERSION_TYPE (expected small, big, or major)" >&2
    exit 2
    ;;
esac

git checkout main
git pull

CURRENT_VERSION=$(node -p "require('./package.json').version")
VERSION=$(node -e '
  const [major, minor, patch] = process.argv[1].split(".").map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) process.exit(1);
  const type = process.argv[2];
  console.log(type === "major" ? `${major + 1}.0.0` : type === "big" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`);
' "$CURRENT_VERSION" "$VERSION_TYPE")

echo "Building runway version $VERSION ($VERSION_TYPE bump from $CURRENT_VERSION)"

docker build -t "paw2fajardo/runway:$VERSION" -t paw2fajardo/runway:latest .
docker build --target payday-worker -t "paw2fajardo/runway-worker:$VERSION" -t paw2fajardo/runway-worker:latest .

docker push "paw2fajardo/runway:$VERSION"
docker push paw2fajardo/runway:latest
docker push "paw2fajardo/runway-worker:$VERSION"
docker push paw2fajardo/runway-worker:latest
