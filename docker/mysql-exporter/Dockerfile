FROM prom/mysqld-exporter:v0.16.0 AS upstream

FROM alpine:3.22
RUN addgroup -S -g 10001 exporter && adduser -S -D -H -u 10001 -G exporter exporter
COPY --from=upstream /bin/mysqld_exporter /usr/local/bin/mysqld_exporter
COPY docker/mysql-exporter/entrypoint.sh /entrypoint.sh
RUN chmod 0555 /usr/local/bin/mysqld_exporter /entrypoint.sh
USER 10001:10001
EXPOSE 9104
ENTRYPOINT ["/entrypoint.sh"]
