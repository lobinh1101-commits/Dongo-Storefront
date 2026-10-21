import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initialProducts, legacySeedImages } from './product-seeds.js'

export { initialProducts, legacySeedImages }

export function createDatabase(filename = 'data/storefront.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })

  const database = new DatabaseSync(filename)
  database.lockingClause = ''
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'awaiting_payment', 'paid', 'payment_failed')),
      payment_method TEXT NOT NULL DEFAULT 'COD',
      payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed')),
      total_amount INTEGER NOT NULL CHECK (total_amount > 0),
      shipping_name TEXT NOT NULL,
      shipping_phone TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      client_request_id TEXT,
      request_fingerprint TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfillment_status TEXT NOT NULL DEFAULT 'new' CHECK (fulfillment_status IN ('new', 'processing', 'shipped', 'delivered')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id),
      txn_ref TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
      transaction_no TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payment_reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_attempt_id INTEGER NOT NULL UNIQUE REFERENCES payment_attempts(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      transaction_no TEXT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL CHECK (reason IN ('superseded_attempt', 'order_already_paid')),
      status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      category_key TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price > 0),
      old_price INTEGER CHECK (old_price IS NULL OR old_price > price),
      badge TEXT,
      rating TEXT NOT NULL,
      reviews INTEGER NOT NULL CHECK (reviews >= 0),
      image TEXT NOT NULL,
      color TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON payment_attempts(order_id);
    CREATE INDEX IF NOT EXISTS idx_payment_reconciliations_status ON payment_reconciliations(status, created_at);
  `)
  const userColumns = database.prepare('PRAGMA table_info(users)').all()
  if (!userColumns.some((column) => column.name === 'role')) {
    database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin'))")
  }
  const orderColumns = database.prepare('PRAGMA table_info(orders)').all()
  if (!orderColumns.some((column) => column.name === 'client_request_id')) {
    database.exec('ALTER TABLE orders ADD COLUMN client_request_id TEXT')
  }
  if (!orderColumns.some((column) => column.name === 'request_fingerprint')) {
    database.exec('ALTER TABLE orders ADD COLUMN request_fingerprint TEXT')
  }
  if (!orderColumns.some((column) => column.name === 'fulfillment_status')) {
    database.exec("ALTER TABLE orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'new' CHECK (fulfillment_status IN ('new', 'processing', 'shipped', 'delivered'))")
  }
  if (!orderColumns.some((column) => column.name === 'updated_at')) {
    database.exec('ALTER TABLE orders ADD COLUMN updated_at TEXT')
    database.exec('UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL')
  }
  if (!orderColumns.some((column) => column.name === 'payment_method')) {
    database.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'VNPAY'")
  }
  const orderDefinition = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'
  `).get().sql
  if (!orderDefinition.includes("'PENDING'")) {
    database.exec('PRAGMA foreign_keys = OFF')
    try {
      database.exec('BEGIN IMMEDIATE')
      database.exec(`
        CREATE TABLE orders_cod_migration (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          status TEXT NOT NULL CHECK (status IN ('PENDING', 'awaiting_payment', 'paid', 'payment_failed')),
          payment_method TEXT NOT NULL DEFAULT 'COD',
          payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed')),
          total_amount INTEGER NOT NULL CHECK (total_amount > 0),
          shipping_name TEXT NOT NULL,
          shipping_phone TEXT NOT NULL,
          shipping_address TEXT NOT NULL,
          client_request_id TEXT,
          request_fingerprint TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          fulfillment_status TEXT NOT NULL DEFAULT 'new' CHECK (fulfillment_status IN ('new', 'processing', 'shipped', 'delivered')),
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO orders_cod_migration (
          id, user_id, status, payment_method, payment_status, total_amount,
          shipping_name, shipping_phone, shipping_address, client_request_id,
          request_fingerprint, created_at, fulfillment_status, updated_at
        )
        SELECT id, user_id, status, payment_method, payment_status, total_amount,
          shipping_name, shipping_phone, shipping_address, client_request_id,
          request_fingerprint, created_at, fulfillment_status, updated_at
        FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_cod_migration RENAME TO orders;
      `)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    } finally {
      database.exec('PRAGMA foreign_keys = ON')
    }
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_request ON orders(user_id, client_request_id)')
  const insertProduct = database.prepare(`
    INSERT OR IGNORE INTO products (
      id, name, category, category_key, price, old_price, badge, rating, reviews, image, color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const product of initialProducts) insertProduct.run(...product)
  const migrateSeedImage = database.prepare('UPDATE products SET image = ? WHERE id = ? AND image = ?')
  for (const [id, legacyImage, localImage] of legacySeedImages) {
    migrateSeedImage.run(localImage, id, legacyImage)
  }
  database.transaction = async (callback) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = await callback()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  return database
}
