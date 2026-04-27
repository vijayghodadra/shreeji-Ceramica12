
from __future__ import annotations

import hashlib
import importlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse
try:
    import fitz
except ImportError:
    fitz = None

from runtime_paths import get_backend_base_dir, get_images_dir

cv2 = None
np = None


def _ensure_opencv_stack() -> bool:
    global cv2, np
    if cv2 is not None and np is not None:
        return True
    try:
        cv2 = importlib.import_module("cv2")
        np = importlib.import_module("numpy")
        return True
    except ImportError:
        cv2 = None
        np = None
        return False

BASE_DIR = get_backend_base_dir()
DEFAULT_PDF_PATH = BASE_DIR / "catalog.pdf"
DEFAULT_KOHLER_PDF_PATH = BASE_DIR / "Kohler.pdf"
DEFAULT_PRODUCTS_PATH = BASE_DIR / "products.json"
DEFAULT_CACHE_PATH = BASE_DIR / "catalog_cache.json"
DEFAULT_KOHLER_CACHE_PATH = BASE_DIR / "kohler_cache.json"
DEFAULT_IMAGES_DIR = get_images_dir()
PREVIEW_VERSION = "v2"
IMAGE_BBOX_TOLERANCE = 1.5

START_CODE_PATTERN = re.compile(
    r"^\s*((?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)(?:\s*\+\s*(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?))+|\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)\b(?:\s*[-:])?",
    re.I,
)
INLINE_VARIANT_PATTERN = re.compile(
    r"((?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)(?:\s*\+\s*(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?))+|\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)\s*-",
    re.I,
)
CODE_TOKEN_PATTERN = re.compile(
    r"\b(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)(?:\s*\+\s*(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?))*\b",
    re.I,
)
PRICE_PATTERN = re.compile(
    r"(?:₹|Rs\.?|INR|MRP)[^0-9]*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,}|[0-9]{1,3})(?:\.\d{1,2})?",
    re.I,
)
COLOR_TAIL_PATTERN = re.compile(r"(?:/-\s*)?([A-Za-z][A-Za-z &()+/\-]{2,})$")
DIMENSION_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*){1,3}(?:mm|cm)|\d+(?:\.\d+)?\s*mtr)",
    re.I,
)

EXPLICIT_CODE_PRICE_PATTERN = re.compile(
    r"((?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)(?:\s*\+\s*(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?))*)\s*MRP[^0-9]*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,}|[0-9]{1,3})(?:\.\d{1,2})?",
    re.I,
)

KOHLER_CODE_PATTERN = re.compile(
    r"\b((?:K-\s*[A-Z0-9-]+|EX[0-9][A-Z0-9-]*))\b",
    re.I,
)
SKU_CODE_PATTERN = re.compile(r"\bSKU\s*Code:\s*([A-Z0-9][A-Z0-9-]*)\b", re.I)


def _kohler_codes_from_text(text: str) -> list[str]:
    codes = [match.group(1) for match in KOHLER_CODE_PATTERN.finditer(text)]
    codes.extend(match.group(1) for match in SKU_CODE_PATTERN.finditer(text))
    return codes

AQUANT_VARIANT_COLOR_MAP = {
    "CP": "Chrome",
    "BG": "Brushed Gold",
    "BRG": "Brushed Rose Gold",
    "GG": "Graphite Grey",
    "MB": "Matt Black",
    "RG": "Rose Gold",
    "AB": "Antique Bronze",
    "G": "Gold",
}

STONE_KNOB_VARIANT_ORDER = [
    ("1333 CM", "Carrara Marble"),
    ("1333 BM", "Marquina Marble"),
    ("1333 LM", "Lavender Marble (Chevron Amethyst)"),
    ("1333 PP", "Pink Paradise (Pink Onyx)"),
    ("1333 RB", "Royal Blue (Sodalite)"),
]


def normalize_text(value: str) -> str:
    return " ".join(str(value).lower().split())


def normalize_code(value: str) -> str:
    return "".join(character.lower() for character in str(value) if character.isalnum())


def image_relative_path(image_path: str | Path | None) -> str:
    raw_value = str(image_path or "").strip()
    if not raw_value:
        return ""

    raw_value = raw_value.replace("\\", "/").split("?", 1)[0].strip()
    parsed = urlparse(raw_value)
    if parsed.scheme and parsed.path:
        raw_value = parsed.path

    if "/images/" in raw_value:
        raw_value = raw_value.split("/images/", 1)[1]
    else:
        raw_value = raw_value.lstrip("/")
        if raw_value.lower().startswith("images/"):
            raw_value = raw_value[7:]

    safe_parts = [part for part in Path(raw_value).parts if part not in {"", ".", ".."}]
    return "/".join(safe_parts)


def image_storage_path(image_path: str | Path | None, images_dir: Path | str = DEFAULT_IMAGES_DIR) -> Path:
    relative_path = image_relative_path(image_path)
    if not relative_path:
        return Path(images_dir)
    return Path(images_dir) / Path(relative_path)


def _clean_text(value: str) -> str:
    if value is None:
        return ""

    text = str(value).replace(chr(3), " ")
    text = text.replace("`", " ")
    text = text.replace("â€¢", " ")
    text = text.replace("?", " ")
    text = re.sub(r"[â€¢â—Â·ï‚§•●·]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _clean_code(value: str) -> str:
    code = _clean_text(value)
    code = re.sub(r"\s*([\-+/])\s*", r"\1", code)
    code = re.sub(r"\s+", " ", code)
    return code.strip().upper()


def _parse_price(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", value)
    if not digits:
        return None
    return int(digits)


def _parse_kohler_price(value: str) -> int | None:
    cleaned = str(value or "").replace(",", "").strip()
    match = re.search(r"\d+(?:\.\d{1,2})?", cleaned)
    if not match:
        return None

    try:
        amount = float(match.group(0))
    except ValueError:
        return None

    if amount <= 0:
        return None
    return int(round(amount))


def _code_variant_suffix(code: str) -> str:
    cleaned = _clean_code(code)
    match = re.search(r"([A-Z]{1,5})$", cleaned)
    return (match.group(1) if match else "").upper()


def _default_color_from_code(code: str) -> str | None:
    return AQUANT_VARIANT_COLOR_MAP.get(_code_variant_suffix(code))


def _extract_explicit_code_prices(text: str) -> list[tuple[str, int]]:
    matches: list[tuple[str, int]] = []
    seen_codes: set[str] = set()
    cleaned = _clean_text(text)

    for match in EXPLICIT_CODE_PRICE_PATTERN.finditer(cleaned):
        code = _clean_code(match.group(1))
        price = _parse_price(match.group(2))
        if not code or not price or price <= 0 or code in seen_codes:
            continue
        seen_codes.add(code)
        matches.append((code, price))

    return matches


def _strip_explicit_code_prices(text: str) -> str:
    return EXPLICIT_CODE_PRICE_PATTERN.sub(" ", _clean_text(text))


def _cache_is_fresh(cache_path: Path, dependencies: list[Path]) -> bool:
    if not cache_path.exists():
        return False

    cache_mtime = cache_path.stat().st_mtime
    for dependency in dependencies:
        if dependency.exists() and dependency.stat().st_mtime > cache_mtime:
            return False
    return True


def _load_cached_catalog(cache_path: Path) -> list[dict]:
    if not cache_path.exists():
        return []

    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if not isinstance(data, list):
        return []

    catalog = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            continue

        code = _clean_code(item.get("code", ""))
        name = _clean_text(item.get("name", ""))

        try:
            price = int(item.get("price", 0))
        except (TypeError, ValueError):
            continue

        if not code or not name or price <= 0:
            continue

        key = (normalize_code(code), item.get("source") or "")
        if key in seen:
            continue

        seen.add(key)
        catalog.append(
            {
                "code": code,
                "name": name,
                "price": price,
                "color": _clean_text(item.get("color", "")) or None,
                "details": _clean_text(item.get("details", "")) or None,
                "size": _clean_text(item.get("size", "")) or None,
                "image": item.get("image"),
                "page_number": item.get("page_number"),
                "image_bbox": item.get("image_bbox"),
                "source": item.get("source"),
                "source_label": item.get("source_label"),
            }
        )

    return catalog


def _extract_codes_from_text(text: str) -> list[str]:
    cleaned = _clean_text(text)
    codes: list[str] = []

    def _push_code(raw: str) -> None:
        token = _clean_code(raw)
        if not token:
            return
        if "+" in token:
            if token not in codes:
                codes.append(token)
            for part in token.split("+"):
                part = _clean_code(part)
                if part and part not in codes:
                    codes.append(part)
            return
        if token not in codes:
            codes.append(token)

    start_match = START_CODE_PATTERN.match(cleaned)
    if start_match:
        _push_code(start_match.group(1))

    for match in EXPLICIT_CODE_PRICE_PATTERN.finditer(cleaned):
        _push_code(match.group(1))

    for match in INLINE_VARIANT_PATTERN.finditer(cleaned):
        _push_code(match.group(1))

    if not PRICE_PATTERN.search(cleaned):
        tokens = [_clean_code(token) for token in CODE_TOKEN_PATTERN.findall(cleaned)]
        words = cleaned.split()
        if len(tokens) >= 2 and len(words) <= max(18, len(tokens) * 4):
            for token in tokens:
                _push_code(token)

    plus_matches = re.findall(r"\b(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?)(?:\s*\+\s*(?:\d{3,5}(?:\s*[/-]\s*\d{2,5})?(?:\s*[A-Z]{1,4})?))+\b", cleaned, re.I)
    for match in plus_matches:
        _push_code(match)

    return codes


def _extract_size(text: str) -> str | None:
    size_match = re.search(r"Size\s*:?\s*(.*?)(?=\s+MRP|$)", text, re.I)
    if size_match:
        size_text = _clean_text(size_match.group(1))
        if size_text:
            return size_text

    dimension_match = DIMENSION_PATTERN.search(text)
    if dimension_match:
        return _clean_text(dimension_match.group(1))

    return None


def _extract_color(text: str, fallback_color: str | None = None) -> str | None:
    price_match = PRICE_PATTERN.search(text)
    tail = text[price_match.end() :] if price_match else text
    tail = tail.replace("/-", " ").strip()
    color_match = COLOR_TAIL_PATTERN.search(tail)
    if color_match:
        color = _clean_text(color_match.group(1))
        if color:
            return color

    fallback = _clean_text(fallback_color or "")
    return fallback or None


def _extract_name_and_details(text: str) -> tuple[str, str]:
    working_text = _clean_text(text)
    code_match = START_CODE_PATTERN.match(working_text)
    if code_match:
        working_text = working_text[code_match.end() :].strip(" -:")

    price_match = PRICE_PATTERN.search(working_text)
    details = working_text[: price_match.start()].strip() if price_match else working_text
    details = re.sub(r"\s{2,}", " ", details).strip(" -:")

    name = details
    for marker in (" E-Functions:", " Complete Set Including:", " Flows :", " Size :"):
        marker_index = name.find(marker)
        if marker_index > 0:
            name = name[:marker_index].strip()
            break

    if not name:
        name = "Product"

    return _clean_text(name), _clean_text(details)


def _overlap_ratio(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    overlap = max(0.0, min(end_a, end_b) - max(start_a, start_b))
    span = max(1.0, min(end_a - start_a, end_b - start_b))
    return overlap / span


def _is_color_hint(text: str) -> bool:
    cleaned = _clean_text(text)
    if not cleaned or any(character.isdigit() for character in cleaned):
        return False
    if len(cleaned.split()) > 6:
        return False
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z &()+/\-]{2,}", cleaned))


def _find_aquant_inline_variant_blocks(descriptor: dict, text_blocks: list[dict]) -> list[dict]:
    descriptor_rect = fitz.Rect(descriptor["rect"])
    candidates: list[tuple[float, dict]] = []

    for block in text_blocks:
        if block is descriptor:
            continue

        block_rect = fitz.Rect(block["rect"])
        gap_above = max(0.0, descriptor_rect.y0 - block_rect.y1)
        if gap_above > 40:
            continue
        if block_rect.y0 - descriptor_rect.y0 > 10:
            continue
        if block_rect.x1 < descriptor_rect.x0 - 40 or block_rect.x0 > descriptor_rect.x0 + 420:
            continue

        block_text = block["text"]
        if not _extract_explicit_code_prices(block_text) and not _extract_codes_from_text(_strip_explicit_code_prices(block_text)):
            continue

        candidates.append((gap_above, block))

    if not candidates:
        return []

    nearest_gap = min(gap for gap, _ in candidates)
    anchor_y = min(block["rect"][1] for gap, block in candidates if gap <= nearest_gap + 6)

    inline_blocks = [
        block
        for gap, block in candidates
        if gap <= nearest_gap + 12 and abs(block["rect"][1] - anchor_y) <= 20
    ]
    inline_blocks.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
    return inline_blocks


def _extract_aquant_grouped_price_items(
    descriptor: dict,
    text_blocks: list[dict],
    image_blocks: list[dict],
    page_rect: fitz.Rect,
    page_number: int,
    source_key: str,
    source_label: str,
) -> list[dict]:
    if _extract_codes_from_text(descriptor["text"]):
        return []

    descriptor_price = PRICE_PATTERN.search(descriptor["text"])
    common_price = _parse_price(descriptor_price.group(1)) if descriptor_price else None
    if not common_price or common_price <= 0:
        return []

    inline_blocks = _find_aquant_inline_variant_blocks(descriptor, text_blocks)
    if not inline_blocks:
        return []

    explicit_prices: dict[str, int] = {}
    common_codes: list[str] = []
    for block in inline_blocks:
        for code, price in _extract_explicit_code_prices(block["text"]):
            explicit_prices.setdefault(code, price)

        for code in _extract_codes_from_text(_strip_explicit_code_prices(block["text"])):
            if code not in explicit_prices and code not in common_codes:
                common_codes.append(code)

    if not explicit_prices and len(common_codes) < 2:
        return []

    name, details = _extract_name_and_details(descriptor["text"])
    size = _extract_size(descriptor["text"])
    image_rect = _find_aquant_image(
        fitz.Rect(descriptor["rect"]),
        image_blocks,
        page_rect,
    )
    image_bbox = _image_bbox_from_rect(image_rect)

    items: list[dict] = []
    for code, price in explicit_prices.items():
        items.append(
            _make_catalog_item(
                code=code,
                name=name,
                price=price,
                color=_default_color_from_code(code),
                details=details,
                size=size,
                page_number=page_number,
                image_bbox=image_bbox,
                source_key=source_key,
                source_label=source_label,
            )
        )

    for code in common_codes:
        items.append(
            _make_catalog_item(
                code=code,
                name=name,
                price=common_price,
                color=_default_color_from_code(code),
                details=details,
                size=size,
                page_number=page_number,
                image_bbox=image_bbox,
                source_key=source_key,
                source_label=source_label,
            )
        )

    return items


def _extract_aquant_stone_knob_variants(
    page: fitz.Page,
    text_blocks: list[dict],
    image_blocks: list[dict],
    page_number: int,
    source_key: str,
    source_label: str,
) -> list[dict]:
    page_text = _clean_text(page.get_text("text"))
    if "Stone Knobs (Set of 2)" not in page_text:
        return []

    section_start = page_text.find("Stone Knobs (Set of 2)")
    section_end = page_text.find("1336 BG + 1333", section_start + 1)
    if section_start == -1:
        return []

    section_text = page_text[section_start:section_end if section_end != -1 else len(page_text)]
    variant_pattern = re.compile(
        r"(\d{4,5}\s+[A-Z]{1,3})\s*-\s*(.+?)(?=(?:\s+\d{4,5}\s+[A-Z]{1,3}\s*-)|$)",
        re.S,
    )

    extracted: dict[str, str] = {}
    for match in variant_pattern.finditer(section_text):
        code = _clean_code(match.group(1))
        description = _clean_text(match.group(2))
        if not code or not description:
            continue
        extracted[code] = description

    if not extracted:
        return []

    swatch_images = [
        fitz.Rect(block["rect"])
        for block in image_blocks
        if 40 <= fitz.Rect(block["rect"]).width <= 120
        and 40 <= fitz.Rect(block["rect"]).height <= 120
        and 430 <= fitz.Rect(block["rect"]).y0 <= 560
    ]
    swatch_images.sort(key=lambda rect: rect.x0)

    ordered_items: list[dict] = []
    for index, (code, color_name) in enumerate(STONE_KNOB_VARIANT_ORDER):
        if code not in extracted:
            continue

        image_rect = swatch_images[index] if index < len(swatch_images) else None
        ordered_items.append(
            _make_catalog_item(
                code=code,
                name="Stone Knobs (Set of 2)",
                price=0,
                color=color_name,
                details=f"Stone Knobs (Set of 2) - {color_name}",
                size=None,
                page_number=page_number,
                image_bbox=_image_bbox_from_rect(image_rect) if image_rect else None,
                source_key=source_key,
                source_label=source_label,
            )
        )

    return ordered_items


def _find_related_blocks(descriptor: dict, text_blocks: list[dict]) -> tuple[list[dict], str | None]:
    descriptor_rect = fitz.Rect(descriptor["rect"])
    related_code_blocks = []
    color_blocks = []

    for block in text_blocks:
        if block is descriptor:
            continue

        block_text = block["text"]
        if PRICE_PATTERN.search(block_text):
            continue
        block_rect = fitz.Rect(block["rect"])
        x_overlap = _overlap_ratio(descriptor_rect.x0, descriptor_rect.x1, block_rect.x0, block_rect.x1)
        y_overlap = _overlap_ratio(descriptor_rect.y0, descriptor_rect.y1, block_rect.y0, block_rect.y1)

        if _extract_codes_from_text(block_text):
            if block_rect.y1 <= descriptor_rect.y0 + 35 and descriptor_rect.y0 - block_rect.y1 <= 60 and x_overlap > 0.22:
                related_code_blocks.append(block)
            elif block_rect.x1 <= descriptor_rect.x0 + 35 and descriptor_rect.x0 - block_rect.x1 <= 220 and y_overlap > 0.2:
                related_code_blocks.append(block)
        elif _is_color_hint(block_text):
            if block_rect.y0 >= descriptor_rect.y1 - 10 and block_rect.y0 - descriptor_rect.y1 <= 32 and x_overlap > 0.22:
                color_blocks.append(block)

    related_code_blocks.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
    color_blocks.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
    fallback_color = color_blocks[0]["text"] if color_blocks else None
    return related_code_blocks, fallback_color


def _find_nearest_image(text_rect: fitz.Rect, image_blocks: list[dict]) -> fitz.Rect | None:
    best_rect: fitz.Rect | None = None
    best_cost = float("inf")

    for block in image_blocks:
        image_rect = fitz.Rect(block["rect"])
        x_overlap = _overlap_ratio(text_rect.x0, text_rect.x1, image_rect.x0, image_rect.x1)
        y_overlap = _overlap_ratio(text_rect.y0, text_rect.y1, image_rect.y0, image_rect.y1)

        text_center_x = (text_rect.x0 + text_rect.x1) / 2
        text_center_y = (text_rect.y0 + text_rect.y1) / 2
        image_center_x = (image_rect.x0 + image_rect.x1) / 2
        image_center_y = (image_rect.y0 + image_rect.y1) / 2

        if image_rect.x1 <= text_rect.x0 + 30 and y_overlap > 0.2:
            cost = (text_rect.x0 - image_rect.x1) + abs(text_center_y - image_center_y) * 0.65
        elif x_overlap > 0.5 and image_rect.y0 <= text_rect.y0 + 40:
            vertical_gap = max(0.0, text_rect.y0 - image_rect.y1)
            cost = vertical_gap * 0.35 + abs(text_center_x - image_center_x) * 0.25
        elif image_rect.y1 <= text_rect.y0 + 30 and x_overlap > 0.24:
            cost = (text_rect.y0 - image_rect.y1) + abs(text_center_x - image_center_x) * 0.65
        else:
            cost = abs(text_center_x - image_center_x) + abs(text_center_y - image_center_y) * 1.4
            if x_overlap == 0 and y_overlap == 0:
                cost += 120

        # Penalize tiny decorative thumbnails so the main product cutout wins.
        cost += max(0.0, 34 - image_rect.width) * 1.2
        cost += max(0.0, 34 - image_rect.height) * 1.2

        if cost < best_cost:
            best_cost = cost
            best_rect = image_rect

    return best_rect


def _image_bbox_from_rect(image_rect: fitz.Rect | None) -> list[float] | None:
    if image_rect is None:
        return None

    return [
        round(image_rect.x0, 2),
        round(image_rect.y0, 2),
        round(image_rect.x1, 2),
        round(image_rect.y1, 2),
    ]


def _bbox_matches(
    expected_bbox: list[float] | tuple[float, float, float, float],
    actual_bbox: list[float] | tuple[float, float, float, float],
    tolerance: float = IMAGE_BBOX_TOLERANCE,
) -> bool:
    return all(abs(float(expected) - float(actual)) <= tolerance for expected, actual in zip(expected_bbox, actual_bbox))


def _find_aquant_image(
    descriptor_rect: fitz.Rect,
    image_blocks: list[dict],
    page_rect: fitz.Rect,
) -> fitz.Rect | None:
    best_rect: fitz.Rect | None = None
    best_cost = float("inf")

    focus_left = max(page_rect.x0, descriptor_rect.x0 - descriptor_rect.width * 0.75)
    focus_right = min(page_rect.x1, descriptor_rect.x1 + descriptor_rect.width * 0.75)

    for block in image_blocks:
        image_rect = fitz.Rect(block["rect"])
        if image_rect.width < 22 or image_rect.height < 22:
            continue
        image_center_x = (image_rect.x0 + image_rect.x1) / 2
        image_center_y = (image_rect.y0 + image_rect.y1) / 2
        descriptor_center_x = (descriptor_rect.x0 + descriptor_rect.x1) / 2
        descriptor_center_y = (descriptor_rect.y0 + descriptor_rect.y1) / 2

        x_overlap = _overlap_ratio(focus_left, focus_right, image_rect.x0, image_rect.x1)
        y_overlap = _overlap_ratio(descriptor_rect.y0, descriptor_rect.y1, image_rect.y0, image_rect.y1)
        center_gap_x = abs(descriptor_center_x - image_center_x)
        center_gap_y = abs(descriptor_center_y - image_center_y)
        vertical_gap = max(0.0, descriptor_rect.y0 - image_rect.y1)
        horizontal_gap = max(0.0, descriptor_rect.x0 - image_rect.x1)

        if image_rect.y1 <= descriptor_rect.y0 + 40 and x_overlap > 0.18:
            cost = vertical_gap * 1.5 + center_gap_x * 0.32
        elif image_rect.x1 <= descriptor_rect.x0 + 32 and y_overlap > 0.18:
            cost = horizontal_gap * 1.2 + center_gap_y * 0.55
        else:
            continue

        if image_rect.width > max(320, descriptor_rect.width * 2.9):
            cost += 90
        if image_rect.width <= 36 and image_rect.height <= 36:
            cost += 260
        if image_rect.width <= 42 and image_rect.height <= 42:
            cost += 90
        if image_rect.width > page_rect.width * 0.78:
            cost += 180
        if image_rect.height > page_rect.height * 0.42:
            cost += 45
        if center_gap_x > descriptor_rect.width * 1.35:
            cost += 90

        if cost < best_cost:
            best_cost = cost
            best_rect = image_rect

    return best_rect or _find_nearest_image(descriptor_rect, image_blocks)


def _find_kohler_image(
    model_rect: fitz.Rect,
    image_blocks: list[dict],
    band_top: float,
    band_bottom: float,
) -> fitz.Rect | None:
    best_rect: fitz.Rect | None = None
    best_cost = float("inf")

    for block in image_blocks:
        image_rect = fitz.Rect(block["rect"])
        if image_rect.width < 32 or image_rect.height < 32:
            continue

        within_band = image_rect.y0 < band_bottom + 16 and image_rect.y1 > band_top - 24
        if not within_band:
            continue

        y_distance = 0.0
        if image_rect.y1 < band_top:
            y_distance = band_top - image_rect.y1
        elif image_rect.y0 > band_bottom:
            y_distance = image_rect.y0 - band_bottom

        center_gap_y = abs(((model_rect.y0 + model_rect.y1) / 2) - ((image_rect.y0 + image_rect.y1) / 2))
        left_bias = 0 if image_rect.x1 <= model_rect.x0 + 56 else 35
        same_lane = _overlap_ratio(band_top, band_bottom, image_rect.y0, image_rect.y1)
        cost = y_distance * 1.2 + center_gap_y * 0.35 + left_bias - same_lane * 24

        # Ignore decorative banners/background strips and tiny icons.
        if image_rect.width > model_rect.width * 4.2:
            cost += 200
        if image_rect.height > max(260.0, (band_bottom - band_top) * 2.5):
            cost += 120
        if image_rect.width * image_rect.height < 1600:
            cost += 220

        if cost < best_cost:
            best_cost = cost
            best_rect = image_rect

    return best_rect or _find_nearest_image(model_rect, image_blocks)


def _quality_score(item: dict) -> float:
    score = 0.0
    score += 90 if item.get("image_bbox") else 0
    score += 18 if item.get("color") else 0
    score += 15 if item.get("size") else 0
    name_str = item.get("name") or ""
    details_str = item.get("details") or ""
    score += min(len(name_str), 90) / 7
    score += min(len(details_str), 220) / 10
    if not any(character.isalpha() for character in name_str):
        score -= 20
    if len(details_str) > 420:
        score -= 15
    return score


def _iter_document_pages(
    document: fitz.Document,
    page_range: tuple[int, int] | None,
):
    if page_range is None:
        for page_number, page in enumerate(document):
            yield page_number, page
        return

    start_page, end_page = page_range
    start_index = max(start_page - 1, 0)
    end_index = min(end_page - 1, len(document) - 1)
    for page_number in range(start_index, end_index + 1):
        yield page_number, document[page_number]


def _make_catalog_item(
    *,
    code: str,
    name: str,
    price: int,
    color: str | None,
    details: str | None,
    size: str | None,
    page_number: int,
    image_bbox: list[float] | None,
    source_key: str,
    source_label: str,
) -> dict:
    item = {
        "code": _clean_code(code),
        "name": _clean_text(name),
        "price": int(price),
        "color": _clean_text(color) or None,
        "details": _clean_text(details) or None,
        "size": _clean_text(size) or None,
        "page_number": page_number,
        "image_bbox": image_bbox,
        "source": source_key,
        "source_label": source_label,
    }
    if image_bbox:
        if str(source_key).lower() == "kohler":
            preview_name = _kohler_preview_filename(item)
            item["image"] = f"/images/Kohler/{preview_name}"
        else:
            preview_name = _preview_filename(item)
            item["image"] = f"/images/{preview_name}"
    else:
        item["image"] = None
    return item


def _extract_aquant_catalog(
    pdf_path: Path,
    page_range: tuple[int, int] | None,
    source_key: str,
    source_label: str,
) -> list[dict]:
    catalog_by_code: dict[str, dict] = {}

    with fitz.open(pdf_path) as document:
        for page_number, page in _iter_document_pages(document, page_range):
            blocks = page.get_text("dict")["blocks"]
            text_blocks = []
            image_blocks = []

            for block in blocks:
                rect = tuple(block["bbox"])
                if block["type"] == 1:
                    image_blocks.append({"rect": rect})
                    continue
                if block["type"] != 0:
                    continue

                text = _clean_text(
                    " ".join(
                        span["text"]
                        for line in block.get("lines", [])
                        for span in line.get("spans", [])
                    )
                )
                if text:
                    text_blocks.append({"rect": rect, "text": text})

            for descriptor in text_blocks:
                if not PRICE_PATTERN.search(descriptor["text"]):
                    continue

                grouped_items = _extract_aquant_grouped_price_items(
                    descriptor,
                    text_blocks,
                    image_blocks,
                    page.rect,
                    page_number,
                    source_key,
                    source_label,
                )
                for candidate in grouped_items:
                    normalized = normalize_code(candidate["code"])
                    existing = catalog_by_code.get(normalized)
                    if existing is None or _quality_score(candidate) > _quality_score(existing):
                        catalog_by_code[normalized] = candidate

            for candidate in _extract_aquant_stone_knob_variants(
                page=page,
                text_blocks=text_blocks,
                image_blocks=image_blocks,
                page_number=page_number,
                source_key=source_key,
                source_label=source_label,
            ):
                normalized = normalize_code(candidate["code"])
                existing = catalog_by_code.get(normalized)
                if existing is None or _quality_score(candidate) > _quality_score(existing):
                    catalog_by_code[normalized] = candidate

            for descriptor in text_blocks:
                if not PRICE_PATTERN.search(descriptor["text"]):
                    continue

                related_code_blocks, fallback_color = _find_related_blocks(descriptor, text_blocks)
                combined_blocks = related_code_blocks + [descriptor]
                combined_blocks.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
                combined_text = " ".join(block["text"] for block in combined_blocks)
                codes = _extract_codes_from_text(combined_text)
                if not codes:
                    continue

                source_text = descriptor["text"]
                if not START_CODE_PATTERN.match(source_text) and len(codes) == 1:
                    short_prefixes = [
                        block["text"]
                        for block in related_code_blocks
                        if START_CODE_PATTERN.match(block["text"]) and len(block["text"].split()) <= 18
                    ]
                    if short_prefixes:
                        source_text = f"{short_prefixes[0]} {source_text}"

                price_match = PRICE_PATTERN.search(source_text) or PRICE_PATTERN.search(combined_text)
                parsed_price = _parse_price(price_match.group(1)) if price_match else None
                if not parsed_price or parsed_price <= 0:
                    continue

                name, details = _extract_name_and_details(source_text)
                size = _extract_size(source_text)
                color = _extract_color(source_text, fallback_color=fallback_color)
                image_rect = _find_aquant_image(
                    fitz.Rect(descriptor["rect"]),
                    image_blocks,
                    page.rect,
                )
                image_bbox = _image_bbox_from_rect(image_rect)

                for code in codes:
                    candidate = _make_catalog_item(
                        code=code,
                        name=name,
                        price=parsed_price,
                        color=color,
                        details=details,
                        size=size,
                        page_number=page_number,
                        image_bbox=image_bbox,
                        source_key=source_key,
                        source_label=source_label,
                    )

                    normalized = normalize_code(code)
                    existing = catalog_by_code.get(normalized)
                    if existing is None or _quality_score(candidate) > _quality_score(existing):
                        catalog_by_code[normalized] = candidate

    catalog = list(catalog_by_code.values())
    catalog.sort(key=lambda item: (item["code"], item["name"]))
    return catalog


def _page_layout_blocks(page: fitz.Page) -> tuple[list[dict], list[dict]]:
    text_blocks = []
    image_blocks = []

    for block in page.get_text("dict")["blocks"]:
        rect = tuple(block["bbox"])
        if block["type"] == 1:
            image_blocks.append({"rect": rect})
            continue
        if block["type"] != 0:
            continue

        text = _clean_text(
            " ".join(
                span["text"]
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            )
        )
        if text:
            text_blocks.append({"rect": rect, "text": text})

    text_blocks.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
    image_blocks.sort(key=lambda item: (item["rect"][1], item["rect"][0]))
    return text_blocks, image_blocks


def _page_text_blocks(page: fitz.Page) -> list[dict]:
    text_blocks, _ = _page_layout_blocks(page)
    return text_blocks


def _is_kohler_category_block(block: dict) -> bool:
    text = block["text"]
    x0, _, x1, _ = block["rect"]
    if x0 < 180 or x1 > 380:
        return False
    if KOHLER_CODE_PATTERN.search(text) or SKU_CODE_PATTERN.search(text) or PRICE_PATTERN.search(text):
        return False
    if text.isdigit() or text == "MODEL DESCRIPTION CODE MRP":
        return False
    return len(text.split()) <= 4


def _extract_kohler_color(text: str) -> str | None:
    color_match = re.search(r"\bin\s+([A-Za-z][A-Za-z ]+)", text, re.I)
    if color_match:
        return _clean_text(color_match.group(1))
    return None

def _extract_kohler_size(text: str) -> str | None:
    for label in ("Trap type", "Rough-in", "Compatible with", "Compatible toilets"):
        match = re.search(rf"{label}\s*:\s*([^.]{{4,120}})", text, re.I)
        if match:
            return _clean_text(f"{label}: {match.group(1)}")
    return None

def _extract_kohler_catalog(
    pdf_path: Path,
    page_range: tuple[int, int] | None,
    source_key: str,
    source_label: str,
) -> list[dict]:
    catalog_by_code: dict[str, dict] = {}
    
    def _is_pure_code(text: str) -> bool:
        return bool(re.fullmatch(r"\s*K-[A-Z0-9-]+\s*", text, re.I))

    with fitz.open(pdf_path) as document:
        for page_number, page in _iter_document_pages(document, page_range):
            blocks, image_blocks = _page_layout_blocks(page)
            
            category_blocks = [b for b in blocks if _is_kohler_category_block(b)]
            model_name_blocks = [
                b for b in blocks
                if not b["text"].isdigit()
                and b["text"] != "MODEL DESCRIPTION CODE MRP"
                and not re.match(r"^(Qty|Format|Usage Area|SKU Code|MRP)\b", b["text"], re.I)
                and not KOHLER_CODE_PATTERN.search(b["text"])
                and not SKU_CODE_PATTERN.search(b["text"])
                and not PRICE_PATTERN.search(b["text"])
            ]
            
            price_blocks = []
            for b in blocks:
                match = PRICE_PATTERN.search(b["text"])
                if match:
                    p = _parse_kohler_price(match.group(1))
                    if p and p > 0:
                        price_blocks.append({"block": b, "price": p, "center_y": (b["rect"][1] + b["rect"][3])/2})
            price_blocks.sort(key=lambda item: item["center_y"])
            
            all_codes = []
            for b in blocks:
                if b["text"].lower().startswith(("must order", "order with")):
                    continue
                for code in _kohler_codes_from_text(b["text"]):
                    all_codes.append({
                        "code": code,
                        "block": b,
                        "rect": b["rect"],
                        "center_y": (b["rect"][1] + b["rect"][3]) / 2,
                        "center_x": (b["rect"][0] + b["rect"][2]) / 2,
                    })
                    
            for i, p_info in enumerate(price_blocks):
                price_y = p_info["center_y"]
                prev_p_y = price_blocks[i-1]["center_y"] if i > 0 else 0
                
                # 1) Prefer explicit codes in the same price block text.
                same_block_codes = _kohler_codes_from_text(p_info["block"]["text"])

                # 2) Otherwise collect nearby code group (supports multi-code per image).
                nearby_codes = [
                    c for c in all_codes if prev_p_y - 10 <= c["center_y"] <= price_y + 15
                ]
                price_center_x = (p_info["block"]["rect"][0] + p_info["block"]["rect"][2]) / 2
                nearby_codes.sort(key=lambda c: (abs(c["center_x"] - price_center_x), abs(c["center_y"] - price_y)))

                selected_entries = []
                if same_block_codes:
                    seen = set()
                    for code in same_block_codes:
                        key = normalize_code(code)
                        if key in seen:
                            continue
                        seen.add(key)
                        selected_entries.append({
                            "code": code,
                            "rect": p_info["block"]["rect"],
                            "center_y": price_y,
                            "center_x": (p_info["block"]["rect"][0] + p_info["block"]["rect"][2]) / 2,
                        })
                elif nearby_codes:
                    anchor = nearby_codes[0]
                    anchor_block_codes = _kohler_codes_from_text(anchor["block"]["text"])
                    if anchor_block_codes:
                        seen = set()
                        for code in anchor_block_codes:
                            key = normalize_code(code)
                            if key in seen:
                                continue
                            seen.add(key)
                            selected_entries.append({
                                "code": code,
                                "rect": anchor["rect"],
                                "center_y": anchor["center_y"],
                                "center_x": anchor["center_x"],
                            })
                    else:
                        selected_entries.append(anchor)

                    # Add neighbor codes on the same visual line (e.g., variants listed together).
                    for candidate in nearby_codes[1:]:
                        if abs(candidate["center_y"] - anchor["center_y"]) <= 7 and abs(candidate["center_x"] - anchor["center_x"]) <= 320:
                            if normalize_code(candidate["code"]) not in {normalize_code(item["code"]) for item in selected_entries}:
                                selected_entries.append(candidate)

                if not selected_entries:
                    continue
                    
                current_category = None
                for cb in category_blocks:
                    if cb["rect"][1] < price_y:
                        current_category = cb["text"]
                        
                model_name = None
                model_name_y = 0
                model_name_score = None
                for mb in model_name_blocks:
                    if mb["rect"][3] > price_y + 5:
                        continue
                    passed_cat = False
                    for cb in category_blocks:
                        if mb["rect"][1] < cb["rect"][1] < price_y:
                            passed_cat = True
                    if passed_cat:
                        continue
                    score = (abs(mb["rect"][0] - price_center_x), price_y - mb["rect"][3])
                    if model_name_score is None or score < model_name_score:
                        model_name = mb["text"]
                        model_name_y = mb["rect"][1]
                        model_name_score = score
                            
                start_y = prev_p_y
                for cb in category_blocks:
                    if start_y < cb["rect"][1] < price_y:
                        start_y = cb["rect"][1]
                        
                if model_name_y and model_name_y > start_y:
                    start_y = model_name_y
                    
                desc_blocks = []
                for b in blocks:
                    cy = (b["rect"][1] + b["rect"][3])/2
                    if start_y + 5 < cy <= price_y + 15:
                        if b in category_blocks or b in model_name_blocks:
                            continue
                        if b["text"].lower().startswith(("must order", "order with")):
                            continue
                        if PRICE_PATTERN.search(b["text"]):
                            pre_price = b["text"][:PRICE_PATTERN.search(b["text"]).start()].strip()
                            pre_price = re.sub(KOHLER_CODE_PATTERN, " ", pre_price)
                            pre_price = re.sub(SKU_CODE_PATTERN, " ", pre_price).strip()
                            if pre_price: desc_blocks.append(pre_price)
                            continue
                        if _is_pure_code(b["text"]) or SKU_CODE_PATTERN.search(b["text"]):
                            continue
                        desc_blocks.append(b["text"])
                        
                combined_details = " ".join(desc_blocks)
                combined_details = re.sub(KOHLER_CODE_PATTERN, " ", combined_details)
                combined_details = re.sub(SKU_CODE_PATTERN, " ", combined_details)
                combined_details = re.sub(r"\s{2,}", " ", combined_details).strip(" -:")
                
                if model_name:
                    if current_category and not combined_details.lower().startswith(current_category.lower()):
                        final_details = f"{model_name} {combined_details}".strip()
                    elif not combined_details.lower().startswith(model_name.lower()):
                        final_details = f"{model_name} {combined_details}".strip()
                    else:
                        final_details = combined_details
                else:
                    final_details = combined_details
                    
                name = final_details
                for marker in (" Compatible", " Trap type", " Conversion Kits", " Must order", " Order with", " Rough-in"):
                    idx = name.lower().find(marker.lower())
                    if idx > 0:
                        name = name[:idx].strip()
                        break
                        
                size = _extract_kohler_size(combined_details)
                color = _extract_kohler_color(combined_details)
                
                large_images = [
                    b for b in image_blocks
                    if fitz.Rect(b["rect"]).width >= 36 and fitz.Rect(b["rect"]).height >= 36
                ]
                rects = [fitz.Rect(entry["rect"]) for entry in selected_entries if entry.get("rect")]
                if rects:
                    min_x = min(rect.x0 for rect in rects)
                    min_y = min(rect.y0 for rect in rects)
                    max_x = max(rect.x1 for rect in rects)
                    max_y = max(rect.y1 for rect in rects)
                    dummy_rect = fitz.Rect(min_x, min_y, max_x, max_y)
                else:
                    dummy_rect = fitz.Rect(60, model_name_y or (price_y - 20), 120, (model_name_y or price_y) + 20)
                band_top = (model_name_y or price_y) - 20
                band_bottom = price_y + 40
                
                image_rect = _find_kohler_image(
                    dummy_rect,
                    large_images or image_blocks,
                    band_top=band_top,
                    band_bottom=band_bottom,
                )
                image_bbox = _image_bbox_from_rect(image_rect)
                
                for selected in selected_entries:
                    candidate = _make_catalog_item(
                        code=selected["code"],
                        name=name,
                        price=p_info["price"],
                        color=color,
                        details=final_details,
                        size=size,
                        page_number=page_number,
                        image_bbox=image_bbox,
                        source_key=source_key,
                        source_label=source_label,
                    )

                    normalized = normalize_code(candidate["code"])
                    existing = catalog_by_code.get(normalized)
                    if existing is None or _quality_score(candidate) > _quality_score(existing):
                        catalog_by_code[normalized] = candidate
                    
    catalog = list(catalog_by_code.values())
    catalog.sort(key=lambda item: (item["code"], item["name"]))
    return catalog


def extract_products_from_pdf(
    pdf_path: Path | str = DEFAULT_PDF_PATH,
    page_range: tuple[int, int] | None = None,
    source_key: str = "aquant",
    source_label: str = "Aquant",
) -> list[dict]:
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        return []

    if source_key.lower() == "kohler":
        return _extract_kohler_catalog(pdf_path, page_range, source_key, source_label)
    return _extract_aquant_catalog(pdf_path, page_range, source_key, source_label)


def _load_products_fallback(products_path: Path, source_key: str, source_label: str) -> list[dict]:
    if not products_path.exists():
        return []

    try:
        data = json.loads(products_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if not isinstance(data, list):
        return []

    products = []
    seen = set()
    for item in data:
        if not isinstance(item, dict):
            continue

        code = _clean_code(item.get("code", ""))
        name = _clean_text(item.get("name", ""))

        try:
            price = int(item.get("price", 0))
        except (TypeError, ValueError):
            continue

        if not code or not name or price <= 0:
            continue

        key = normalize_code(code)
        if key in seen:
            continue

        seen.add(key)
        products.append(
            _make_catalog_item(
                code=code,
                name=name,
                price=price,
                color=item.get("color"),
                details=item.get("details", name),
                size=item.get("size"),
                page_number=0,
                image_bbox=item.get("image_bbox"),
                source_key=source_key,
                source_label=source_label,
            )
        )

    return products


def _preview_filename(product: dict) -> str:
    page_number = product.get("page_number")
    image_bbox = product.get("image_bbox") or []
    source_key = product.get("source") or "catalog"
    page_slug = int(page_number) + 1 if isinstance(page_number, int) else 0
    slug = f"{str(source_key).lower()}-p{page_slug}"
    bbox_digest = ",".join(f"{float(value):.2f}" for value in image_bbox) if image_bbox else ""
    digest = hashlib.sha1(
        f"{PREVIEW_VERSION}|{source_key}|{page_number}|{bbox_digest}".encode(
            "utf-8"
        )
    ).hexdigest()[:10]
    return f"{slug}-{digest}.png"


def _kohler_preview_filename(product: dict) -> str:
    code = _clean_code(product.get("code", ""))
    return f"{code}.png" if code else _preview_filename(product)


def _save_embedded_image_preview(
    page: fitz.Page,
    image_bbox: list[float] | tuple[float, float, float, float],
    destination: Path,
) -> bool:
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 1:
            continue
        if not _bbox_matches(image_bbox, block.get("bbox", ())):
            continue

        try:
            pixmap = fitz.Pixmap(block["image"])
            if pixmap.alpha:
                pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
            destination.parent.mkdir(parents=True, exist_ok=True)
            pixmap.save(destination)
            return True
        except RuntimeError:
            return False

    return False


def _render_preview(
    document: fitz.Document,
    page_number: int,
    image_bbox: list[float] | tuple[float, float, float, float],
    destination: Path,
) -> None:
    def _smart_crop_and_enhance(image_bgr):
        if not _ensure_opencv_stack():
            return image_bgr

        height, width = image_bgr.shape[:2]
        focus_height = max(1, int(height * 0.78))
        focus = image_bgr[:focus_height, :]

        gray = cv2.cvtColor(focus, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, threshold = cv2.threshold(blur, 245, 255, cv2.THRESH_BINARY_INV)

        kernel = np.ones((3, 3), np.uint8)
        threshold = cv2.morphologyEx(threshold, cv2.MORPH_OPEN, kernel, iterations=1)
        threshold = cv2.dilate(threshold, kernel, iterations=1)

        contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            areas = [cv2.contourArea(contour) for contour in contours]
            max_area = max(areas)
            selected = [contour for contour, area in zip(contours, areas) if area >= max_area * 0.18]
            if selected:
                min_x = width
                min_y = focus_height
                max_x = 0
                max_y = 0
                for contour in selected:
                    x, y, w, h = cv2.boundingRect(contour)
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x + w)
                    max_y = max(max_y, y + h)

                if max_x > min_x and max_y > min_y:
                    pad_x = max(2, int((max_x - min_x) * 0.03))
                    pad_y = max(2, int((max_y - min_y) * 0.03))
                    min_x = max(0, min_x - pad_x)
                    min_y = max(0, min_y - pad_y)
                    max_x = min(width, max_x + pad_x)
                    max_y = min(height, max_y + pad_y)
                    image_bgr = image_bgr[min_y:max_y, min_x:max_x]

        # Edge-to-edge cleanup: trim near-white empty borders after object localization.
        gray_full = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        non_white = cv2.threshold(gray_full, 245, 255, cv2.THRESH_BINARY_INV)[1]
        points = cv2.findNonZero(non_white)
        if points is not None:
            x, y, w, h = cv2.boundingRect(points)
            if w > 8 and h > 8:
                pad_x = max(2, int(w * 0.015))
                pad_y = max(2, int(h * 0.015))
                x0 = max(0, x - pad_x)
                y0 = max(0, y - pad_y)
                x1 = min(image_bgr.shape[1], x + w + pad_x)
                y1 = min(image_bgr.shape[0], y + h + pad_y)
                image_bgr = image_bgr[y0:y1, x0:x1]

        denoised = cv2.fastNlMeansDenoisingColored(image_bgr, None, 3, 3, 7, 21)
        sharpened = cv2.addWeighted(denoised, 1.25, cv2.GaussianBlur(denoised, (0, 0), 1.2), -0.25, 0)
        upscaled = cv2.resize(
            sharpened,
            (max(1, int(sharpened.shape[1] * 1.2)), max(1, int(sharpened.shape[0] * 1.2))),
            interpolation=cv2.INTER_LANCZOS4,
        )
        return upscaled

    page = document.load_page(page_number)
    page_rect = page.rect
    clip = fitz.Rect(image_bbox)

    # Keep clipping tight to avoid large blank backgrounds, while adding a
    # small safety margin so product edges are not cut.
    min_w = max(72.0, page_rect.width * 0.08)
    min_h = max(90.0, page_rect.height * 0.10)
    center_x = (clip.x0 + clip.x1) / 2.0
    center_y = (clip.y0 + clip.y1) / 2.0

    width = max(clip.width, min_w)
    height = max(clip.height, min_h)

    ratio = height / max(width, 1.0)
    if ratio > 3.4:
        width = max(width, height / 2.8)
    elif ratio < 0.30:
        height = max(height, width * 0.36)

    pad_x = max(2.0, min(6.0, width * 0.02))
    pad_y = max(2.0, min(6.0, height * 0.02))

    clip = fitz.Rect(
        max(page_rect.x0, center_x - (width / 2.0) - pad_x),
        max(page_rect.y0, center_y - (height / 2.0) - pad_y),
        min(page_rect.x1, center_x + (width / 2.0) + pad_x),
        min(page_rect.y1, center_y + (height / 2.0) + pad_y),
    )

    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.6, 2.6), clip=clip, alpha=False)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if _ensure_opencv_stack():
        array = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
        if pixmap.n == 4:
            image_bgr = cv2.cvtColor(array, cv2.COLOR_RGBA2BGR)
        else:
            image_bgr = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
        processed = _smart_crop_and_enhance(image_bgr)
        cv2.imwrite(str(destination), processed, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    else:
        pixmap.save(destination)


def ensure_product_preview(
    product: dict,
    pdf_path: Path | str = DEFAULT_PDF_PATH,
    images_dir: Path | str = DEFAULT_IMAGES_DIR,
    force: bool = False,
) -> str | None:
    image_path = product.get("image")
    page_number = product.get("page_number")
    image_bbox = product.get("image_bbox")

    if not image_path or page_number is None or not image_bbox:
        return image_path

    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    preview_file = image_storage_path(image_path, images_dir=images_dir)
    preview_file.parent.mkdir(parents=True, exist_ok=True)
    if preview_file.exists() and not force:
        return image_path

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        return image_path

    with fitz.open(pdf_path) as document:
        _render_preview(
            document=document,
            page_number=int(page_number),
            image_bbox=image_bbox,
            destination=preview_file,
        )

    return image_path


def build_catalog_index(
    pdf_path: Path | str = DEFAULT_PDF_PATH,
    products_path: Path | str = DEFAULT_PRODUCTS_PATH,
    cache_path: Path | str = DEFAULT_CACHE_PATH,
    images_dir: Path | str = DEFAULT_IMAGES_DIR,
    force: bool = False,
    page_range: tuple[int, int] | None = None,
    source_key: str = "aquant",
    source_label: str = "Aquant",
) -> list[dict]:
    pdf_path = Path(pdf_path)
    products_path = Path(products_path)
    cache_path = Path(cache_path)
    images_dir = Path(images_dir)
    images_dir.mkdir(parents=True, exist_ok=True)

    extractor_path = Path(__file__).resolve()

    if not force and _cache_is_fresh(cache_path, [pdf_path, products_path, extractor_path]):
        cached_catalog = _load_cached_catalog(cache_path)
        if cached_catalog:
            return cached_catalog

    if pdf_path.exists():
        catalog = extract_products_from_pdf(
            pdf_path=pdf_path,
            page_range=page_range,
            source_key=source_key,
            source_label=source_label,
        )
    else:
        catalog = _load_products_fallback(products_path, source_key, source_label)

    if not catalog:
        cache_path.write_text("[]", encoding="utf-8")
        return []

    cache_path.write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return catalog


if __name__ == "__main__":
    catalog = build_catalog_index(force=True)
    print(f"Built catalog cache with {len(catalog)} products.")
