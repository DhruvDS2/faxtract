-- Runs once, when the container's data volume is first created (docker-compose.yml).
-- app.db.init_db() (make bootstrap) also does this; it is here so the extension exists
-- even before the bootstrap runs.
CREATE EXTENSION IF NOT EXISTS vector;
