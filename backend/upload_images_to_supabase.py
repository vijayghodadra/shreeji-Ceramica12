import os
import sys
import mimetypes
import urllib.request
import urllib.error

SUPABASE_URL = "https://zwbkzsskjyctffnasjea.supabase.co"
SUPABASE_KEY = sys.argv[1] if len(sys.argv) > 1 else ""

if not SUPABASE_KEY:
    print("Please provide the Supabase Service Role Key as an argument.")
    sys.exit(1)

BUCKET_NAME = "product-images"
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "images")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

def upload_file(local_path, supabase_path):
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{urllib.parse.quote(supabase_path)}"
    content_type, _ = mimetypes.guess_type(local_path)
    if not content_type:
        content_type = "application/octet-stream"

    try:
        with open(local_path, "rb") as f:
            data = f.read()
    except Exception as e:
        print(f"Failed to read {local_path}: {e}")
        return False

    headers = HEADERS.copy()
    headers["Content-Type"] = content_type

    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        urllib.request.urlopen(req)
        print(f"Uploaded: {supabase_path}")
        return True
    except urllib.error.HTTPError as e:
        # 400 means it might already exist, try updating (PUT) instead or just skip
        if e.code == 400 or e.code == 409:
            # Let's skip existing files to speed up retries
            print(f"Skipped (already exists): {supabase_path}")
            return True
        print(f"HTTP Error {e.code} uploading {supabase_path}: {e.read().decode('utf-8')}")
        return False
    except Exception as e:
        print(f"Error uploading {supabase_path}: {e}")
        return False

def main():
    if not os.path.exists(IMAGES_DIR):
        print(f"Images directory not found: {IMAGES_DIR}")
        sys.exit(1)
        
    print(f"Starting upload to bucket '{BUCKET_NAME}'...")
    
    # Optional: We could try to create the bucket via REST, but the user is instructed to create it.
    
    total_files = 0
    for root, dirs, files in os.walk(IMAGES_DIR):
        for file in files:
            total_files += 1

    print(f"Found {total_files} files to upload.")
    
    uploaded = 0
    failed = 0
    for root, dirs, files in os.walk(IMAGES_DIR):
        for file in files:
            local_path = os.path.join(root, file)
            # Make path relative to IMAGES_DIR, replace backslash with forward slash for supabase
            rel_path = os.path.relpath(local_path, IMAGES_DIR).replace("\\", "/")
            
            if upload_file(local_path, rel_path):
                uploaded += 1
            else:
                failed += 1
                
    print(f"Upload complete! Successfully uploaded: {uploaded}, Failed: {failed}")

if __name__ == "__main__":
    import urllib.parse
    main()
