FROM nginxinc/nginx-unprivileged:alpine

USER root
RUN mkdir -p /var/log/dongo && chown 101:101 /var/log/dongo
USER 101
