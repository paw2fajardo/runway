#!/bin/sh
set -e

docker build -t paw2fajardo/runway:latest .
docker build --target payday-worker -t paw2fajardo/runway-worker:latest .

docker push paw2fajardo/runway:latest
docker push paw2fajardo/runway-worker:latest