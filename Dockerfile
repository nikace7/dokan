# Backend image — Django 5 + Gunicorn on Python 3.12.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy source, then install the project and the production server.
# (Dependencies are declared in backend/pyproject.toml.)
COPY backend/ ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir . gunicorn

# Run as a non-root user.
RUN groupadd --system dokan && useradd --system --gid dokan dokan \
    && mkdir -p /app/staticfiles && chown -R dokan:dokan /app
USER dokan

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
