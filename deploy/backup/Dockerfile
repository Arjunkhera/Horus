# Ops image for the backup CronJob + bucket-versioning Jobs.
# Provides: aws CLI (s3 / s3api), kubectl (exec into pods), sqlite3, gzip, sh.
#
# Build (multi-arch, from any context):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -f deploy/backup/Dockerfile \
#     -t ghcr.io/arjunkhera/horus/backup:0.1.0-alpha.1 deploy/backup --push
FROM alpine:3.20

ARG TARGETARCH=amd64
ARG KUBECTL_VERSION=v1.30.2

RUN apk add --no-cache aws-cli sqlite bash coreutils gzip curl ca-certificates \
    && curl -fsSLo /usr/local/bin/kubectl \
        "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
    && chmod +x /usr/local/bin/kubectl

ENTRYPOINT ["/bin/sh", "-c"]
