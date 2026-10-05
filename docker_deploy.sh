#!/usr/bin/env sh
set -eu

docker build -t paw2fajardo/runway:latest .
docker push paw2fajardo/runway:latest
