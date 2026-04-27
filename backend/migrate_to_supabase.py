import json
import urllib.request
import urllib.error
import pathlib
import sys
import os

SUPABASE_URL = "https://zwbkzsskjyctffnasjea.supabase.co"
SUPABASE_KEY = sys.argv[1] if len(sys.argv) > 1 else ""

if not SUPABASE_KEY:
    print("Please provide the Supabase Service Role Key as an argument.")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def insert_batch(batch):
    url = f"{SUPABASE_URL}/rest/v1/products"
    data = json.dumps(batch).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=HEADERS, method='POST')
    try:
        urllib.request.urlopen(req)
        return True
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
        return False
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason}")
        return False

def load_file(filename):
    path = pathlib.Path(__file__).parent / filename
    if not path.exists():
        print(f"File {filename} not found.")
        return []
    with open(path, 'r', encoding='utf-8') as f:
        try:
            return json.load(f)
        except Exception as e:
            print(f"Failed to load {filename}: {e}")
            return []

def main():
    print("Loading datasets...")
    # Products complete has a mix. Kohler cache has Kohler.
    # It's safest to read both and deduplicate by (source, code).
    products_complete = load_file("products_complete.json")
    kohler_cache = load_file("kohler_cache.json")
    
    all_products = products_complete + kohler_cache
    unique_products = {}
    
    for p in all_products:
        if not isinstance(p, dict):
            continue
            
        code = str(p.get("code") or "").strip()
        source = str(p.get("source") or "aquant").strip().lower()
        if not code:
            continue
            
        key = f"{source}::{code}"
        
        # Determine price properly
        price_val = p.get("price", 0)
        try:
            if isinstance(price_val, str):
                price_val = float(price_val.replace(',', '').replace('₹', '').strip())
            else:
                price_val = float(price_val)
        except (ValueError, TypeError):
            price_val = 0
            
        # Ensure variants/base_code exist
        variant = str(p.get("variant") or "").strip().upper()
        base_code = str(p.get("base_code") or p.get("baseCode") or "").strip()
        
        image = p.get("image") or p.get("image_file")
        
        # Check if is_cp is truthful
        is_cp_val = p.get("is_cp") or p.get("isCp")
        is_cp = is_cp_val in {1, "1", "true", "True", True, "yes", "YES"} or variant == "CP"
        
        unique_products[key] = {
            "source": source,
            "source_label": p.get("source_label") or p.get("sourceLabel") or ("Aquant" if source == "aquant" else "Kohler"),
            "code": code,
            "name": p.get("name") or code,
            "price": price_val,
            "color": p.get("color") or p.get("finish"),
            "size": p.get("size"),
            "details": p.get("details") or p.get("name") or code,
            "page_number": p.get("page_number") or p.get("pageNumber") or 0,
            "image": image,
            "image_bbox": p.get("image_bbox") or p.get("imageBbox"),
            "base_code": base_code,
            "variant": variant,
            "is_cp": is_cp
        }
        
    products_list = list(unique_products.values())
    print(f"Found {len(products_list)} unique products to migrate.")
    
    # Batch insert (PostgREST limit is usually high, but let's do chunks of 500)
    batch_size = 500
    for i in range(0, len(products_list), batch_size):
        batch = products_list[i:i+batch_size]
        print(f"Inserting batch {i} to {i+len(batch)}...")
        if not insert_batch(batch):
            print("Migration aborted due to error.")
            sys.exit(1)
            
    print("Migration complete!")

if __name__ == "__main__":
    main()
