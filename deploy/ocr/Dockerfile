# Receipt-parser sidecar — Tesseract OCR + geometry line-item extraction.
# Internal only (no published ports); the app reaches it on the compose network.
FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY receipt_parse.py server.py ./

ENV PORT=8000
EXPOSE 8000
CMD ["python", "server.py"]
