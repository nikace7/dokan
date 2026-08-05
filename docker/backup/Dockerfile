FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends awscli ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY *.sh /usr/local/bin/
RUN find /usr/local/bin -maxdepth 1 -type f \
        \( -name 'backup*.sh' -o -name 'common.sh' -o -name 'restore-drill.sh' -o -name 'wal-*.sh' \) \
        -exec sed -i 's/\r$//' {} + \
    && find /usr/local/bin -maxdepth 1 -type f \
        \( -name 'backup*.sh' -o -name 'common.sh' -o -name 'restore-drill.sh' -o -name 'wal-*.sh' \) \
        -exec chmod 0755 {} + \
    && for script in /usr/local/bin/backup*.sh /usr/local/bin/common.sh \
        /usr/local/bin/restore-drill.sh /usr/local/bin/wal-*.sh; do \
        sh -n "$script" || exit 1; \
    done \
    && mkdir -p /backups /wal-archive \
    && chown -R postgres:postgres /backups /wal-archive

USER postgres
CMD ["backup-loop.sh"]
