##
## Runner
##
FROM alpine:3.19 AS runner
LABEL maintainer="Pedro Sanders <psanders@fonoster.com>"

ARG CA_CERT_SUBJECT="/CN=Self Signed CA"
ARG SERVER_CERT_SUBJECT="/CN=localhost"
ENV PATH_TO_CERTS=/etc/routr/certs \
  TLS_ON=true \
  CA_CERT_SUBJECT=$CA_CERT_SUBJECT \
  SERVER_CERT_SUBJECT=$SERVER_CERT_SUBJECT \
  VERIFY_CLIENT_CERT=false

WORKDIR /scripts

COPY .scripts/generate-certs.sh /generate-certs.sh
COPY mods/pgdata .

# Todo: We need to normalize user id and group id across all images
RUN chmod +x /generate-certs.sh \
  && apk add --no-cache cmake g++ git make nodejs npm openssl python3 tini \
  && npm pack \
  && npm install -g routr-*.tgz \
  && cp schema.prisma /usr/local/lib/node_modules/@routr/pgdata/ \
  && cd /usr/local/lib/node_modules/@routr/pgdata/ \
  && npx prisma generate \
  && ln -s /usr/local/bin/run_pgdata /usr/local/bin/run \
  && apk del git python3 make cmake g++ npm \
  && mkdir -p ${PATH_TO_CERTS} \
  && chown -R 1000:3000 ${PATH_TO_CERTS} \
  && chmod 700 ${PATH_TO_CERTS} \
  && rm -rf /scripts /var/cache/apk/* /tmp/* /var/tmp/* 

USER 1000:3000

# Re-mapping the signal from 143 to 0
ENTRYPOINT ["tini", "-v", "-e", "143", "--"]
CMD ["sh", "-c", "set -e && /generate-certs.sh $PATH_TO_CERTS && run"]

##
## Migrations
##
FROM node:18-alpine3.19 AS migrations

WORKDIR /db

RUN npm install --location=global prisma@5.9.1 \
  && apk add --no-cache postgresql-client

COPY mods/pgdata/migrations migrations
COPY mods/pgdata/schema.prisma .

CMD ["prisma", "migrate", "deploy"]
