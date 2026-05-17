#!/bin/bash
pushd ~/Git/FlameRelay || exit 1
git fetch
git reset --hard origin/main
# mkdir -p /srv/flamerelay/media
# chown -R 10001:10001 /srv/flamerelay/media
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml down -t 20
docker compose -f docker-compose.production.yml run --rm django python manage.py migrate
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml exec -T django python manage.py shell -c \
  "from backend.tasks import health_check; health_check.delay()"
docker image prune -f
popd
