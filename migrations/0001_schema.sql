-- HelloBMG D1 Schema (SQLite)
-- Apply: wrangler d1 migrations apply hellobmg --local
--        wrangler d1 migrations apply hellobmg --remote

CREATE TABLE IF NOT EXISTS brands (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT    NOT NULL PRIMARY KEY,
  title        TEXT    NOT NULL,
  brand_id     TEXT,
  category_id  TEXT,
  price        INTEGER NOT NULL DEFAULT 0,
  mrp          INTEGER,
  rating       REAL,
  stock        INTEGER NOT NULL DEFAULT 0,
  popularity   INTEGER NOT NULL DEFAULT 0,
  specs        TEXT,
  tags         TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  stock_status TEXT    NOT NULL DEFAULT 'in_stock',
  created_at   TEXT    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id)    REFERENCES brands(id)     ON DELETE SET NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT    NOT NULL PRIMARY KEY,
  product_id  TEXT    NOT NULL,
  r2_key      TEXT,
  public_url  TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_brand    ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_images_product    ON product_images(product_id);

-- Sample data
INSERT OR IGNORE INTO brands (id, name) VALUES
  ('b1', 'Apple'),
  ('b2', 'Samsung');

INSERT OR IGNORE INTO categories (id, name) VALUES
  ('c1', 'Smartphones'),
  ('c2', 'Laptops'),
  ('c3', 'Tablets'),
  ('c4', 'Accessories');

INSERT OR IGNORE INTO products
  (id, title, brand_id, category_id, price, mrp, rating, stock, popularity, specs, tags, is_active, stock_status)
VALUES
  ('p1', 'iPhone 13 (Refurbished)', 'b1', 'c1', 45999, 69999, 4.7, 8, 95,
   '{"storage":"128 GB","ram":"4 GB","display":"6.1\" OLED","battery":"3227 mAh","camera":"12MP + 12MP","warranty":"12 months","model":"iPhone 13"}',
   '["featured","sale"]', 1, 'in_stock'),
  ('p2', 'Galaxy S21 (Renewed)', 'b2', 'c1', 34999, 54999, 4.5, 3, 89,
   '{"storage":"128 GB","ram":"8 GB","display":"6.2\" AMOLED","battery":"4000 mAh","camera":"12MP + 64MP + 12MP","warranty":"9 months","model":"Galaxy S21"}',
   '["featured"]', 1, 'in_stock'),
  ('p3', 'MacBook Air M1 (2020)', 'b1', 'c2', 63999, 89999, 4.8, 5, 92,
   '{"storage":"256 GB SSD","ram":"8 GB","display":"13.3\" Retina","battery":"All day","camera":"720p","warranty":"12 months","model":"MacBook Air M1"}',
   '["featured"]', 1, 'in_stock');
