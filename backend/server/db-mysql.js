import { AsyncLocalStorage } from 'node:async_hooks'
import mysql from 'mysql2/promise'
import { initialProducts, legacySeedImages } from './product-seeds.js'

const transactionConnection = new AsyncLocalStorage()

function requiredEnvironment(env, key) {
  const value = env[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required when DB_DRIVER=mysql`)
  }
  return value
}

export async function createMySqlDatabase(env = process.env) {
  const pool = mysql.createPool({
    host: requiredEnvironment(env, 'DB_HOST'),
    port: Number(env.DB_PORT || 3306),
    user: requiredEnvironment(env, 'DB_USER'),
    password: requiredEnvironment(env, 'DB_PASSWORD'),
    database: requiredEnvironment(env, 'DB_NAME'),
    waitForConnections: true,
    connectionLimit: Number(env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true,
    timezone: 'Z',
    charset: 'utf8mb4',
  })

  async function execute(sql, values = []) {
    const connection = transactionConnection.getStore() || pool
    const compatibleSql = sql.replace(/datetime\('now',\s*'-15 minutes'\)/gi, 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)')
    const [result] = await connection.execute(compatibleSql, values)
    return result
  }

  const database = {
    lockingClause: ' FOR UPDATE',
    prepare(sql) {
      return {
        get: async (...values) => {
          const [row] = await execute(sql, values)
          return row
        },
        all: (...values) => execute(sql, values),
        run: async (...values) => {
          const result = await execute(sql, values)
          return { changes: result.affectedRows, lastInsertRowid: result.insertId }
        },
      }
    },
    async exec(sql) {
      const connection = transactionConnection.getStore() || pool
      await connection.query(sql)
    },
    async transaction(callback) {
      if (transactionConnection.getStore()) return callback()
      const connection = await pool.getConnection()
      try {
        await connection.beginTransaction()
        const result = await transactionConnection.run(connection, callback)
        await connection.commit()
        return result
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    },
    close: () => pool.end(),
  }

  try {
    await initializeMySql(database)
  } catch (error) {
    await database.close()
    throw error
  }
  return database
}

async function initializeMySql(database) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT UNSIGNED NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL,
      password_hash VARCHAR(100) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'customer',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email),
      CONSTRAINT chk_users_role CHECK (role IN ('customer', 'admin'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      status VARCHAR(24) NOT NULL,
      payment_method VARCHAR(16) NOT NULL DEFAULT 'COD',
      payment_status VARCHAR(16) NOT NULL,
      total_amount BIGINT UNSIGNED NOT NULL,
      shipping_name VARCHAR(80) NOT NULL,
      shipping_phone VARCHAR(20) NOT NULL,
      shipping_address VARCHAR(240) NOT NULL,
      client_request_id CHAR(36) NULL,
      request_fingerprint CHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfillment_status VARCHAR(16) NOT NULL DEFAULT 'new',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT chk_orders_status CHECK (status IN ('PENDING', 'awaiting_payment', 'paid', 'payment_failed')),
      CONSTRAINT chk_orders_payment_method CHECK (payment_method IN ('COD', 'VNPAY')),
      CONSTRAINT chk_orders_payment CHECK (payment_status IN ('pending', 'paid', 'failed')),
      CONSTRAINT chk_orders_fulfillment CHECK (fulfillment_status IN ('new', 'processing', 'shipped', 'delivered')),
      CONSTRAINT chk_orders_total CHECK (total_amount > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id CHAR(36) NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      product_name VARCHAR(120) NOT NULL,
      unit_price BIGINT UNSIGNED NOT NULL,
      quantity INT UNSIGNED NOT NULL,
      CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT chk_order_items_quantity CHECK (quantity > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id CHAR(36) NOT NULL,
      txn_ref VARCHAR(64) NOT NULL,
      amount BIGINT UNSIGNED NOT NULL,
      status VARCHAR(16) NOT NULL,
      transaction_no VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payment_attempts_txn_ref (txn_ref),
      CONSTRAINT fk_payment_attempts_order FOREIGN KEY (order_id) REFERENCES orders(id),
      CONSTRAINT chk_payment_attempt_status CHECK (status IN ('pending', 'paid', 'failed'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS payment_reconciliations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      payment_attempt_id BIGINT UNSIGNED NOT NULL,
      order_id CHAR(36) NOT NULL,
      transaction_no VARCHAR(64) NULL,
      amount BIGINT UNSIGNED NOT NULL,
      reason VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'needs_review',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_reconciliation_attempt (payment_attempt_id),
      CONSTRAINT fk_reconciliation_attempt FOREIGN KEY (payment_attempt_id) REFERENCES payment_attempts(id),
      CONSTRAINT fk_reconciliation_order FOREIGN KEY (order_id) REFERENCES orders(id),
      CONSTRAINT chk_reconciliation_reason CHECK (reason IN ('superseded_attempt', 'order_already_paid')),
      CONSTRAINT chk_reconciliation_status CHECK (status IN ('needs_review', 'resolved')),
      CONSTRAINT chk_reconciliation_amount CHECK (amount > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INT UNSIGNED NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      category VARCHAR(60) NOT NULL,
      category_key VARCHAR(40) NOT NULL,
      price BIGINT UNSIGNED NOT NULL,
      old_price BIGINT UNSIGNED NULL,
      badge VARCHAR(40) NULL,
      rating VARCHAR(8) NOT NULL,
      reviews INT UNSIGNED NOT NULL DEFAULT 0,
      image VARCHAR(2048) NOT NULL,
      color CHAR(7) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      CONSTRAINT chk_products_price CHECK (price > 0),
      CONSTRAINT chk_products_old_price CHECK (old_price IS NULL OR old_price > price)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await database.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(254) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_newsletter_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)

  await ensureColumn(database, 'users', 'role', "VARCHAR(16) NOT NULL DEFAULT 'customer'")
  await ensureColumn(database, 'orders', 'client_request_id', 'CHAR(36) NULL')
  await ensureColumn(database, 'orders', 'request_fingerprint', 'CHAR(64) NULL')
  await ensureColumn(database, 'orders', 'payment_method', "VARCHAR(16) NOT NULL DEFAULT 'VNPAY'")
  await ensureColumn(database, 'orders', 'fulfillment_status', "VARCHAR(16) NOT NULL DEFAULT 'new'")
  await ensureColumn(database, 'orders', 'updated_at', 'DATETIME NULL')
  const codMigration = await database.prepare('SELECT version FROM schema_migrations WHERE version = 2').get()
  if (!codMigration) {
    await ensureCheckConstraint(
      database,
      'orders',
      'chk_orders_status',
      "CHECK (status IN ('PENDING', 'awaiting_payment', 'paid', 'payment_failed'))",
    )
    await ensureCheckConstraint(
      database,
      'orders',
      'chk_orders_payment_method',
      "CHECK (payment_method IN ('COD', 'VNPAY'))",
    )
    await database.prepare('INSERT IGNORE INTO schema_migrations (version) VALUES (2)').run()
  }
  await database.exec('UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL')
  await ensureIndex(database, 'orders', 'idx_orders_user_created', '(user_id, created_at DESC)')
  await ensureIndex(database, 'orders', 'idx_orders_user_request', '(user_id, client_request_id)', true)
  await ensureIndex(database, 'payment_attempts', 'idx_payment_attempts_order', '(order_id)')
  await ensureIndex(database, 'payment_reconciliations', 'idx_payment_reconciliations_status', '(status, created_at)')

  for (const product of initialProducts) {
    await database.prepare(`
      INSERT INTO products (
        id, name, category, category_key, price, old_price, badge, rating, reviews, image, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE id = VALUES(id)
    `).run(...product)
  }
  for (const [id, legacyImage, localImage] of legacySeedImages) {
    await database.prepare('UPDATE products SET image = ? WHERE id = ? AND image = ?')
      .run(localImage, id, legacyImage)
  }
  await database.prepare('INSERT IGNORE INTO schema_migrations (version) VALUES (1)').run()
}

async function ensureColumn(database, table, column, definition) {
  const result = await database.prepare(`
    SELECT COUNT(*) AS count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `).get(table, column)
  if (Number(result.count) === 0) {
    await database.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
  }
}

async function ensureIndex(database, table, index, columns, unique = false) {
  const result = await database.prepare(`
    SELECT COUNT(*) AS count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
  `).get(table, index)
  if (Number(result.count) === 0) {
    await database.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX \`${index}\` ON \`${table}\` ${columns}`)
  }
}

async function ensureCheckConstraint(database, table, constraint, definition) {
  const result = await database.prepare(`
    SELECT COUNT(*) AS count FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?
      AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'CHECK'
  `).get(table, constraint)
  if (Number(result.count) > 0) {
    await database.exec(`ALTER TABLE \`${table}\` DROP CHECK \`${constraint}\``)
  }
  await database.exec(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` ${definition}`)
}
