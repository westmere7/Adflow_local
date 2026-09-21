# syntax=docker/dockerfile:1
# ============================================================================
# RMIT Adflow — local edition container
# ----------------------------------------------------------------------------
# Adflow is a static site: HTML, CSS, vanilla JS and vendored binaries. Nothing
# runs on the server. This image therefore has two stages:
#
#   build    node:20-alpine     runs the two generator scripts that a static
#                               host runs at deploy time (asset manifest +
#                               startup-template registry), then drops files
#                               the browser never loads.
#   runtime  nginx-unprivileged serves the result. Runs as the `nginx` user
#                               (uid 101), listens on 8080, no shell needed.
#
# Build:   docker build -t rmit-adflow .
# Run:     docker run --rm -p 8080:8080 rmit-adflow
# Open:    http://localhost:8080/
#
# No network access is required at build time beyond pulling the two base
# images, and none at all at runtime: every library and font is in the repo.
# ============================================================================

FROM node:20-alpine AS build
WORKDIR /src

# .dockerignore keeps dev tooling, docs and VCS metadata out of this copy.
COPY . .

# Generate the two indexes the app reads at boot, then remove the generators
# and anything else that is build-time only.
#
# `docker/` holds this image's own nginx config. The runtime stage copies that
# file straight from the build context, so it cannot be .dockerignore'd — but it
# must not survive into the web root either, or the server configuration would be
# downloadable at /docker/nginx.conf. Deleting it here is the one place that
# satisfies both.
RUN node scripts/build-asset-manifest.js \
 && node scripts/build-startup-registry.js \
 && rm -f scripts/build-asset-manifest.js scripts/build-startup-registry.js scripts/build-docs-screenshots.mjs \
 && rm -rf docker


FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="RMIT Adflow" \
      org.opencontainers.image.description="Browser-based HTML5 display-ad builder. Static, local-only edition." \
      org.opencontainers.image.source="https://github.com/westmere7/Adflow"

# Server block: MIME types for .wasm/.mjs, cache policy, health endpoint.
COPY --chown=nginx:nginx docker/nginx.conf /etc/nginx/conf.d/default.conf

# The site itself.
COPY --from=build --chown=nginx:nginx /src /usr/share/nginx/html

EXPOSE 8080

# version.txt is the smallest file the app itself depends on, so a 200 here
# means nginx is up AND the site files are in place.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
