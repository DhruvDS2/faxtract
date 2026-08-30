import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Local Homebrew Postgres: current OS user is superuser, no password.
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://localhost:5432/faxtract"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()
