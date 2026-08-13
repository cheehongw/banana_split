"""Pure receipt line-item extraction from OCR words.

Kept dependency-free (no Tesseract/PIL) so it can be unit-tested directly. The
server (server.py) feeds it Tesseract word boxes; this module groups them into
lines by geometry, picks the rightmost money token on each line as the price,
and classifies lines into items vs tax/tip/discount (totals/payment lines are
dropped). Amounts are returned in MAJOR units — the app's SidecarParser converts
to integer minor units using the expense currency.
"""
import re

# A word box: {"text": str, "left": int, "top": int, "line_key": hashable}
# line_key groups words on the same physical line (block/paragraph/line indices).

_SYMBOLS = {"$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR"}
_MONEY_TOKEN = re.compile(r"[-−]?[$£€¥₹]?\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?$")

_SKIP = ("subtotal", "sub total", "total", "amount due", "balance", "change",
         "cash", "credit", "debit", "visa", "master", "amex", "rounding")
_TAX = ("tax", "gst", "vat", "hst", "pst", "sales tax")
_TIP = ("tip", "gratuity", "service charge", "service chg")
_DISCOUNT = ("discount", "coupon", "promo", "voucher", "off ")


def parse_amount(token: str):
    """Parse a money-ish token into a float in major units, or None."""
    t = re.sub(r"[^\d.,\-−]", "", token).replace("−", "-")
    if not re.search(r"\d", t):
        return None
    if "," in t and "." in t:                 # 1,234.56 → thousands=',' decimal='.'
        t = t.replace(",", "")
    elif "," in t:                            # ambiguous: ',' is decimal iff 2 trailing digits
        t = t.replace(",", ".") if re.search(r",\d{1,2}$", token) else t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def _is_money(token: str) -> bool:
    return bool(_MONEY_TOKEN.match(token.strip())) and parse_amount(token) is not None


def _group_lines(words):
    """Group words by line_key (preserving first-seen order), each sorted L→R."""
    order, lines = [], {}
    for w in words:
        if not w.get("text", "").strip():
            continue
        k = w["line_key"]
        if k not in lines:
            lines[k] = []
            order.append(k)
        lines[k].append(w)
    return [sorted(lines[k], key=lambda w: w["left"]) for k in order]


def _detect_currency(words):
    blob = " ".join(w.get("text", "") for w in words)
    if "S$" in blob:
        return "SGD"
    for sym, code in _SYMBOLS.items():
        if sym in blob:
            return code
    return None


def parse_receipt(words, currency=None):
    """Extract {currency, items[], tax, tip, discount} (major units) from words."""
    result = {"currency": currency or _detect_currency(words), "items": []}
    tax = tip = discount = 0.0

    for line in _group_lines(words):
        # The price is the rightmost money token on the line.
        price_idx = next((i for i in range(len(line) - 1, -1, -1) if _is_money(line[i]["text"])), None)
        if price_idx is None:
            continue
        amount = parse_amount(line[price_idx]["text"])
        if amount is None or amount <= 0:
            continue
        desc = " ".join(w["text"] for i, w in enumerate(line) if i != price_idx).strip(" .:-\t")
        low = desc.lower()

        if any(k in low for k in _SKIP):
            continue
        if any(k in low for k in _TAX):
            tax += amount
        elif any(k in low for k in _TIP):
            tip += amount
        elif any(k in low for k in _DISCOUNT):
            discount += amount
        elif desc:  # a described line with a price → a claimable item
            result["items"].append({"description": desc, "amount": round(amount, 2)})

    if tax:
        result["tax"] = round(tax, 2)
    if tip:
        result["tip"] = round(tip, 2)
    if discount:
        result["discount"] = round(discount, 2)
    return result
