CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT,
    source_label TEXT,
    code TEXT,
    name TEXT,
    price NUMERIC,
    color TEXT,
    size TEXT,
    details TEXT,
    page_number INTEGER,
    image TEXT,
    image_bbox JSONB,
    base_code TEXT,
    variant TEXT,
    is_cp BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for searching
CREATE INDEX IF NOT EXISTS products_code_idx ON public.products(code);
CREATE INDEX IF NOT EXISTS products_base_code_idx ON public.products(base_code);
CREATE INDEX IF NOT EXISTS products_name_idx ON public.products(name);

-- Enable Row Level Security (RLS)
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read the products
CREATE POLICY "Allow public read access" 
ON public.products 
FOR SELECT 
USING (true);

-- Storage bucket creation instructions (can also be done via Dashboard)
-- 1. Go to Storage
-- 2. Create new bucket named 'product-images'
-- 3. Set the bucket as "Public"
