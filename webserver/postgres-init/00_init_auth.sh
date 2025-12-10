#!/bin/bash
set -e

# Read the web_app password from the secret file
if [ ! -f /run/secrets/webapp_password ]; then
    echo "Warning: /run/secrets/webapp_password not found. Skipping web_app user creation."
    exit 0
fi

WEBAPP_PWD=$(cat /run/secrets/webapp_password)

echo "Creating web_app user..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO
    \$do\$
    BEGIN
       IF NOT EXISTS (
          SELECT FROM pg_catalog.pg_roles
          WHERE  rolname = 'web_app') THEN

          CREATE USER web_app WITH PASSWORD '$WEBAPP_PWD';
          GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO web_app;
          GRANT USAGE ON SCHEMA public TO web_app;
       ELSE
          ALTER USER web_app WITH PASSWORD '$WEBAPP_PWD';
       END IF;
    END
    \$do\$;
EOSQL
echo "web_app user created/updated."
