# ==== FRONTEND ====
FROM node:19-alpine AS builder

WORKDIR /frontend

# Copy the package.json and install dependencies
COPY app/package*.json ./
RUN npm install

# Copy rest of the files
COPY app/src ./src/
COPY app/* ./

# Build the project
RUN npx parcel build src/index.html --no-cache --no-source-maps

# ==== BACKEND ====
FROM pytorch/pytorch:2.0.0-cuda11.7-cudnn8-runtime

WORKDIR /web/

# set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV XDG_CONFIG_HOME=/web/config

ARG POETRY_VERSION=1.4.1

RUN pip install --no-cache-dir --upgrade pip

# install poetry
RUN pip install poetry==${POETRY_VERSION}
RUN poetry config virtualenvs.create false

COPY server/ ./server/
COPY README.md .
COPY --from=builder /frontend/dist ./server/static/

# install python dependencies
COPY pyproject.toml .
COPY poetry.lock .
RUN poetry install --without=dev --no-interaction --no-ansi

ENTRYPOINT ["sleep", "360000"]
#ENTRYPOINT ["openplayground", "run", "--host", "0.0.0.0", "--env", "/web/config/.env"]