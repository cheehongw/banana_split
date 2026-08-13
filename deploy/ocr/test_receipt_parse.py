"""Unit tests for the pure receipt parser. Run: python3 test_receipt_parse.py"""
from receipt_parse import parse_amount, parse_receipt


def _w(text, left, line):
    return {"text": text, "left": left, "top": line * 20, "line_key": line}


def line(texts, ln):
    """Build word boxes for one line from left→right token strings."""
    return [_w(t, i * 50, ln) for i, t in enumerate(texts)]


def test_parse_amount():
    assert parse_amount("3.50") == 3.5
    assert parse_amount("$1,234.56") == 1234.56
    assert parse_amount("2,50") == 2.5          # euro-style decimal comma
    assert parse_amount("900") == 900.0          # zero-decimal (JPY)
    assert parse_amount("n/a") is None
    assert parse_amount("qty") is None


def test_items_tax_tip_and_skips():
    words = []
    words += line(["Steak", "20.00"], 0)
    words += line(["Caesar", "Salad", "10.50"], 1)
    words += line(["Subtotal", "30.50"], 2)      # skipped
    words += line(["Tax", "2.44"], 3)
    words += line(["Tip", "5.00"], 4)
    words += line(["Total", "37.94"], 5)         # skipped
    words += line(["VISA", "37.94"], 6)          # skipped (payment)
    r = parse_receipt(words, currency="USD")

    assert r["items"] == [
        {"description": "Steak", "amount": 20.0},
        {"description": "Caesar Salad", "amount": 10.5},
    ], r["items"]
    assert r["tax"] == 2.44
    assert r["tip"] == 5.0
    assert "discount" not in r


def test_discount_and_currency_detection():
    words = line(["Latte", "£3.20"], 0) + line(["Loyalty", "discount", "£1.00"], 1)
    r = parse_receipt(words)  # no currency passed → detect from symbol
    assert r["currency"] == "GBP"
    assert r["items"] == [{"description": "Latte", "amount": 3.2}]
    assert r["discount"] == 1.0


def test_lines_without_prices_are_ignored():
    words = line(["Thank", "you", "for", "dining"], 0) + line(["Nasi", "Lemak", "6.00"], 1)
    r = parse_receipt(words, currency="SGD")
    assert r["items"] == [{"description": "Nasi Lemak", "amount": 6.0}]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all passed")
