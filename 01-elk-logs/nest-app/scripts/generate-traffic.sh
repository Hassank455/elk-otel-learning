#!/usr/bin/env bash
# Sends random requests to the app so we have logs to explore in Kibana.
# Usage: ./scripts/generate-traffic.sh [count]
COUNT=${1:-20}
URL=${URL:-http://localhost:3000}
PRODUCTS=(book laptop phone headphones keyboard)

for i in $(seq 1 "$COUNT"); do
  user=$((RANDOM % 10 + 1))
  product=${PRODUCTS[$((RANDOM % ${#PRODUCTS[@]}))]}
  amount=$((RANDOM % 500 + 10))
  curl -s -X POST "$URL/orders" -H 'Content-Type: application/json' \
    -d "{\"userId\":$user,\"product\":\"$product\",\"amount\":$amount}" > /dev/null
  # sometimes ask for an order that doesn't exist (404)
  curl -s "$URL/orders/$((RANDOM % (i + 5) + 1))" > /dev/null
  echo "request $i/$COUNT"
done
