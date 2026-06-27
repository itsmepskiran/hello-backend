-- HelloBMG MySQL Schema
-- Run this in phpMyAdmin: New Query → paste → Execute

CREATE DATABASE IF NOT EXISTS hellobmg CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hellobmg;

CREATE TABLE IF NOT EXISTS brands (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_brand_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cat_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  title        VARCHAR(500)  NOT NULL,
  brand_id     CHAR(36)      NULL,
  category_id  CHAR(36)      NULL,
  price        INT           NOT NULL DEFAULT 0,
  mrp          INT           NULL,
  rating       DECIMAL(3,1)  NULL,
  stock        INT           NOT NULL DEFAULT 0,
  popularity   INT           NOT NULL DEFAULT 0,
  specs        JSON          NULL,
  tags         JSON          NULL,
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  stock_status VARCHAR(20)   NOT NULL DEFAULT 'in_stock',
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_brand    FOREIGN KEY (brand_id)    REFERENCES brands(id)     ON DELETE SET NULL,
  CONSTRAINT fk_prod_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_images (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  product_id   CHAR(36)      NOT NULL,
  storage_path VARCHAR(1000) NULL,
  local_url    VARCHAR(1000) NULL,
  is_primary   TINYINT(1)    NOT NULL DEFAULT 0,
  sort_order   INT           NOT NULL DEFAULT 0,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_img_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Sample data (optional — remove if you want a clean start)
INSERT IGNORE INTO brands (id, name) VALUES
  ('b1', 'Apple'),
  ('b2', 'Samsung');

INSERT IGNORE INTO categories (id, name) VALUES
  ('c1', 'Smartphones'),
  ('c2', 'Laptops'),
  ('c3', 'Tablets'),
  ('c4', 'Accessories');

INSERT IGNORE INTO products (id, title, brand_id, category_id, price, mrp, rating, stock, popularity, specs, tags, is_active, stock_status) VALUES
  ('p1', 'iPhone 13 (Refurbished)', 'b1', 'c1', 45999, 69999, 4.7, 8, 95,
   '{"storage":"128 GB","ram":"4 GB","display":"6.1\" OLED","battery":"3227 mAh","camera":"12MP + 12MP","warranty":"12 months","model":"iPhone 13"}',
   '["featured","sale"]', 1, 'in_stock'),
  ('p2', 'Galaxy S21 (Renewed)', 'b2', 'c1', 34999, 54999, 4.5, 3, 89,
   '{"storage":"128 GB","ram":"8 GB","display":"6.2\" AMOLED","battery":"4000 mAh","camera":"12MP + 64MP + 12MP","warranty":"9 months","model":"Galaxy S21"}',
   '["featured"]', 1, 'in_stock'),
  ('p3', 'MacBook Air M1 (2020)', 'b1', 'c2', 63999, 89999, 4.8, 5, 92,
   '{"storage":"256 GB SSD","ram":"8 GB","display":"13.3\" Retina","battery":"All day","camera":"720p","warranty":"12 months","model":"MacBook Air M1"}',
   '["featured"]', 1, 'in_stock');
