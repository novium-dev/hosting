#!/bin/sh
set -eu

image="$1"
dockerfile="$2"
context="$3"
shift 3

tag="$(printf '%s' "$GITHUB_SHA" | cut -c1-8)"

docker pull "$image:latest" || true
docker build --build-arg BUILDKIT_INLINE_CACHE=1 --cache-from "$image:latest" \
    --tag "$image:$tag" --tag "$image:latest" --file "$dockerfile" "$@" "$context"
docker push "$image:$tag"
docker push "$image:latest"
