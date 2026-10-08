# syntax=docker/dockerfile:1
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY ksfp ./ksfp
RUN useradd --system --uid 10001 ksfp && mkdir -p /app/data && chown ksfp /app/data
USER ksfp
EXPOSE 8000
HEALTHCHECK --interval=15s --start-period=10s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
# single worker: the runtime loop (ingest → detect → forecast → decide → act) is a stateful singleton
CMD ["uvicorn", "ksfp.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers"]
