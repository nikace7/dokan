#!/bin/sh
set -eu

# Keep Docker bind-mount paths intact when this runs under Git Bash on Windows.
export MSYS_NO_PATHCONV=1

suffix=$$
network="dokan-edge-smoke-$suffix"
frontend="dokan-edge-frontend-$suffix"
storefront="dokan-edge-storefront-$suffix"
backend="dokan-edge-backend-$suffix"
caddy="dokan-edge-caddy-$suffix"

cleanup() {
    docker rm -f "$caddy" "$backend" "$frontend" "$storefront" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create "$network" >/dev/null
docker run -d --name "$frontend" --network "$network" --network-alias frontend \
    dokan-frontend:test >/dev/null
docker run -d --name "$storefront" --network "$network" --network-alias storefront \
    dokan-storefront:test >/dev/null
docker run -d --name "$backend" --network "$network" --network-alias backend \
    --entrypoint sh busybox:1.37 -c \
    'mkdir -p /www/api; printf backend-ok > /www/api/probe; exec httpd -f -p 8000 -h /www' \
    >/dev/null
docker run -d --name "$caddy" --network "$network" \
    --network-alias demo.dokan.test --network-alias admin.dokan.test \
    --network-alias yak.shop.dokan.test \
    -e ROOT_DOMAIN=dokan.test -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
    dokan-caddy:test >/dev/null

curl_image=curlimages/curl:8.12.1
for attempt in $(seq 1 45); do
    if docker run --rm --network "$network" "$curl_image" \
        --insecure --fail --silent https://demo.dokan.test/healthz >/dev/null 2>&1; then
        break
    fi
    [ "$attempt" -lt 45 ] || {
        docker logs "$caddy"
        exit 1
    }
    sleep 1
done

request() {
    docker run --rm --network "$network" "$curl_image" --insecure --fail --silent "$@"
}

tenant=$(request https://demo.dokan.test/billing)
admin=$(request https://admin.dokan.test/admin/login)
api=$(request https://demo.dokan.test/api/probe)
shop=$(request https://yak.shop.dokan.test/)
shop_api=$(request https://yak.shop.dokan.test/api/probe)
headers=$(request --head https://demo.dokan.test/billing)
asset=$(printf '%s' "$tenant" | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' | head -n 1)
[ -n "$asset" ]
asset_headers=$(request --head "https://demo.dokan.test$asset")
modules=$(docker run --rm dokan-caddy:test caddy list-modules)
storefront_title=$(sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p' storefront/index.html | head -n 1)
[ -n "$storefront_title" ]

printf '%s' "$tenant" | grep -q '<title>mero-pasal\.online'
printf '%s' "$admin" | grep -q '<title>mero-pasal\.online'
[ "$api" = "backend-ok" ]
# The *.shop namespace serves the storefront SPA and the same backend plumbing.
printf '%s' "$shop" | grep -qF "$storefront_title"
printf '%s' "$shop" | grep -qv '<title>mero-pasal\.online'
[ "$shop_api" = "backend-ok" ]
printf '%s' "$headers" | grep -qi '^content-security-policy:'
printf '%s' "$headers" | grep -qi '^x-frame-options: DENY'
printf '%s' "$asset_headers" | grep -qi '^cache-control:.*immutable'
printf '%s' "$modules" | grep -q '^dns.providers.cloudflare$'

echo "Edge stack smoke test passed."
