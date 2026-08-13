"""Receipt-parser sidecar: Tesseract OCR → geometry line-item extraction.

Internal HTTP service (never exposed publicly). The app posts an image to
POST /parse and gets back {currency, items[], tax, tip, discount} with MAJOR-unit
amounts; the app converts to minor units. Swap Tesseract for PaddleOCR / an LLM
behind this same endpoint without touching the app.
"""
import os
from io import BytesIO

import pytesseract
from flask import Flask, jsonify, request
from PIL import Image

from receipt_parse import parse_receipt

app = Flask(__name__)
MIN_CONF = int(os.environ.get("OCR_MIN_CONF", "30"))  # drop low-confidence word boxes


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/parse")
def parse():
    f = request.files.get("image")
    if f is None:
        return jsonify(error='multipart field "image" is required'), 400
    currency = request.form.get("currency") or None

    try:
        image = Image.open(BytesIO(f.read()))
    except Exception as exc:  # noqa: BLE001 — report any decode failure to the caller
        return jsonify(error=f"could not read image: {exc}"), 400

    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    words = []
    for i in range(len(data["text"])):
        text = data["text"][i]
        if not text or not text.strip():
            continue
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1.0
        if conf < MIN_CONF:
            continue
        words.append({
            "text": text,
            "left": int(data["left"][i]),
            "top": int(data["top"][i]),
            "line_key": (data["block_num"][i], data["par_num"][i], data["line_num"][i]),
        })

    return jsonify(parse_receipt(words, currency))


if __name__ == "__main__":
    from waitress import serve

    serve(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
