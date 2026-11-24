# referral-intake: the one-command demo and dev tasks. Run make from referral-intake/.
#
#   make demo         fresh clone -> .venv + pip install -e .[dev], npm ci, demo Postgres,
#                     bootstrap, corpus, RIS :2575 + API :8000 + web :5173, seed; prints the URL
#   make demo-stop    stop everything the demo started, including its Postgres
#   make demo-status  what is running
#   make demo-clean   demo-stop, then delete .demo/ (database, logs, uploads, RIS orders)
#   make test         pytest against TEST_DATABASE_URL, else the demo Postgres (started if needed)
#   make bootstrap    init_db + policy index + graph setup (DATABASE_URL, else the demo Postgres)
#   make seed         seed the running demo API again (idempotent)
#
# Knobs: PYTHON=python3.12  DEMO_ARGS=--keep-going  PYTEST_ARGS="-q -x"  SEED_ARGS="--reject 6"
# No Docker needed. docker-compose.yml (Postgres only) is an untested alternative.

PYTHON ?= python3
VENV ?= .venv
PY := $(VENV)/bin/python
DEMO_ARGS ?=
PYTEST_ARGS ?= -q
SEED_ARGS ?=

.PHONY: help install web-install demo demo-stop demo-status demo-clean test bootstrap seed

help:
	@sed -n 's/^#   //p' Makefile

install: $(VENV)/.installed

web-install: web/node_modules/.installed

$(VENV)/.installed: pyproject.toml
	@$(PYTHON) -c 'import sys; sys.exit(sys.version_info < (3, 12))' || { \
	  echo "make: $(PYTHON) is $$($(PYTHON) --version 2>&1); Python 3.12+ is required (try: make demo PYTHON=python3.12)"; exit 1; }
	@test -x $(PY) || $(PYTHON) -m venv $(VENV)
	$(PY) -m pip install --disable-pip-version-check -e '.[dev]'
	@touch $@

web/node_modules/.installed: web/package-lock.json
	@command -v npm >/dev/null || { echo "make: npm not found (install Node.js 20+)"; exit 1; }
	cd web && npm ci --no-audit --no-fund
	@touch $@

demo: install web-install
	$(PY) -m scripts.demo up $(DEMO_ARGS)

# stop/status/clean work before (or without) the venv: scripts/demo.py is stdlib-only for them
RUNNER = $(shell [ -x $(PY) ] && echo $(PY) || echo $(PYTHON))

demo-stop:
	@$(RUNNER) -m scripts.demo stop

demo-status:
	@$(RUNNER) -m scripts.demo status

demo-clean:
	@$(RUNNER) -m scripts.demo clean

test: install
	$(PY) -m scripts.demo test $(PYTEST_ARGS)

bootstrap: install
	$(PY) -m scripts.demo bootstrap

seed: install
	$(PY) -m scripts.seed_demo $(SEED_ARGS)
