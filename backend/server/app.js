import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import prometheus from '@prometheus-io/client'
import pinoHttp from 'pino-http'
import { z } from 'zod'
import { logger } from './logger.js'

const sessionCookieName = 'dongo_session'
const sessionLifetimeSeconds = 7 * 24 * 60 * 60

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().pipe(z.email().max(254)).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(72),
})
const loginSchema = z.object({
  email: z.string().trim().pipe(z.email().max(254)).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(72),
})
const orderSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) })).min(1).max(20)
    .refine((items) => new Set(items.map(({ productId }) => productId)).size === items.length, 'Sản phẩm bị trùng.'),
  shipping: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().regex(/^\+?[\d\s().-]{8,20}$/).refine((phone) => {
      const digitCount = phone.replace(/\D/g, '').length
      return digitCount >= 8 && digitCount <= 15
    }, 'Số điện thoại không hợp lệ.'),
    address: z.string().trim().min(8).max(240),
  }),
})
const roleSchema = z.enum(['customer', 'admin'])
const newsletterSchema = z.object({
  email: z.string().trim().pipe(z.email().max(254)).transform((email) => email.toLowerCase()),
})
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  categoryKey: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/i),
  price: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  oldPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  badge: z.string().trim().max(40).nullable(),
  image: z.string().trim().min(1).max(2048)
    .refine(isProductImageReference, 'Hình ảnh phải là mã Unsplash hoặc URL HTTPS.'),
  color: z.string().regex(/^#[\da-f]{6}$/i),
}).refine((product) => product.oldPrice === null || product.oldPrice > product.price, {
  message: 'Giá gốc phải lớn hơn giá bán.',
  path: ['oldPrice'],
})
const fulfillmentStatusSchema = z.enum(['new', 'processing', 'shipped', 'delivered'])

function isProductImageReference(image) {
  if (/^photo-[\w-]+$/.test(image)) return true
  if (image.startsWith('/') && !image.startsWith('//') && !image.includes('\\')) {
    try {
      return new URL(image, 'https://dongo.local').origin === 'https://dongo.local'
    } catch {
      return false
    }
  }
  try {
    const url = new URL(image)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function safeUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role }
}

function publicError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  error.expose = true
  return error
}

function setSessionCookie(response, userId, secret, secure, sameSite) {
  const token = jwt.sign({ sub: String(userId) }, secret, { expiresIn: sessionLifetimeSeconds })
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api',
    maxAge: sessionLifetimeSeconds * 1000,
  })
}

function clearSessionCookie(response, secure, sameSite) {
  response.clearCookie(sessionCookieName, { httpOnly: true, secure, sameSite, path: '/api' })
}

export function createApp({ database, env = process.env }) {
  if (!database) throw new Error('createApp requires a database connection')
  if (env.NODE_ENV === 'production' &&
    (typeof env.SESSION_SECRET !== 'string' || Buffer.byteLength(env.SESSION_SECRET, 'utf8') < 32)) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes in production')
  }

  const app = express()
  const metricsRegistry = new prometheus.Registry()
  metricsRegistry.setDefaultLabels({ service: 'dongo-backend' })
  prometheus.collectDefaultMetrics({ register: metricsRegistry })
  const requestCounter = new prometheus.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests served by the Dongo backend.',
    labelNames: ['method', 'route', 'status'],
    registers: [metricsRegistry],
  })
  const requestDuration = new prometheus.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [metricsRegistry],
  })
  const databaseUp = new prometheus.Gauge({
    name: 'dongo_database_up',
    help: 'Whether the backend most recently completed a database health check.',
    registers: [metricsRegistry],
  })
  databaseUp.set(0)
  const sessionSecret = env.SESSION_SECRET || randomBytes(32).toString('hex')
  const secureCookie = env.NODE_ENV === 'production' || env.COOKIE_SECURE === 'true'
  const sameSite = (env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase()
  const allowedOrigins = (env.CORS_ORIGINS || env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('SESSION_COOKIE_SAME_SITE must be lax, strict or none')
  if (sameSite === 'none' && !secureCookie) throw new Error('SameSite=None cookies require COOKIE_SECURE=true or production HTTPS')

  if (env.TRUST_PROXY === '1') app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet({
    strictTransportSecurity: false,
    xContentTypeOptions: false,
    frameguard: false,
    referrerPolicy: false,
  }))
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin))
    },
    credentials: true,
  }))
  app.use(express.json({ limit: '32kb' }))
  app.use(cookieParser())
  app.use(pinoHttp({
    logger,
    autoLogging: env.NODE_ENV !== 'test',
    serializers: {
      req(request) {
        return { method: request.method, url: request.url.split('?')[0] }
      },
      res(response) {
        return { statusCode: response.statusCode }
      },
    },
  }))
  app.use((request, response, next) => {
    if (request.path === '/metrics') return next()
    const startedAt = process.hrtime.bigint()
    response.once('finish', () => {
      const route = request.route ? `${request.baseUrl}${request.route.path}` : 'unmatched'
      const labels = {
        method: request.method,
        route,
        status: String(response.statusCode),
      }
      requestCounter.labels(labels).inc()
      requestDuration.labels(labels).observe(Number(process.hrtime.bigint() - startedAt) / 1e9)
    })
    return next()
  })

  app.get('/metrics', async (_request, response, next) => {
    try {
      response.set('Content-Type', metricsRegistry.contentType)
      return response.end(await metricsRegistry.metrics())
    } catch (error) {
      return next(error)
    }
  })

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Bạn đã thử quá nhiều lần. Vui lòng chờ 15 phút rồi thử lại.' },
  })
  const newsletterLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Bạn đã đăng ký quá nhiều lần. Vui lòng thử lại sau.' },
  })

  async function authenticate(request, response, next) {
    const token = request.cookies[sessionCookieName]
    if (!token) return response.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' })

    let payload
    try {
      payload = jwt.verify(token, sessionSecret)
    } catch {
      clearSessionCookie(response, secureCookie, sameSite)
      return response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' })
    }

    try {
      const user = await database.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(Number(payload.sub))
      if (!user) {
        clearSessionCookie(response, secureCookie, sameSite)
        return response.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.' })
      }
      request.user = user
      return next()
    } catch (error) {
      return next(error)
    }
  }

  function requireAdmin(request, response, next) {
    if (request.user?.role !== 'admin') {
      return response.status(403).json({ error: 'Bạn không có quyền truy cập chức năng quản trị.' })
    }
    return next()
  }

  app.get('/api/health', async (_request, response, next) => {
    try {
      await database.prepare('SELECT 1').get()
      databaseUp.set(1)
      return response.json({ status: 'ok' })
    } catch (error) {
      databaseUp.set(0)
      return next(error)
    }
  })

  app.get('/api/auth/me', async (request, response, next) => {
    const token = request.cookies[sessionCookieName]
    if (!token) return response.json({ user: null })
    let payload
    try {
      payload = jwt.verify(token, sessionSecret)
    } catch {
      clearSessionCookie(response, secureCookie, sameSite)
      return response.json({ user: null })
    }
    try {
      const user = await database.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(Number(payload.sub))
      if (!user) clearSessionCookie(response, secureCookie, sameSite)
      return response.json({ user: user ? safeUser(user) : null })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/auth/register', authLimiter, async (request, response, next) => {
    try {
      const input = registerSchema.parse(request.body)
      if (Buffer.byteLength(input.password, 'utf8') > 72) throw publicError('Mật khẩu không được dài quá 72 byte.')
      const passwordHash = await bcrypt.hash(input.password, 12)
      const result = await database.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
        .run(input.name, input.email, passwordHash)
      const user = await database.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(Number(result.lastInsertRowid))
      setSessionCookie(response, user.id, sessionSecret, secureCookie, sameSite)
      return response.status(201).json({ user: safeUser(user) })
    } catch (error) {
      if ((error.code === 'ERR_SQLITE_ERROR' && error.errcode === 2067) || error.code === 'ER_DUP_ENTRY') {
        return response.status(409).json({ error: 'Email này đã được đăng ký.' })
      }
      return next(error)
    }
  })

  app.post('/api/auth/login', authLimiter, async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body)
      const user = await database.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?').get(input.email)
      const passwordMatches = user ? await bcrypt.compare(input.password, user.password_hash) : false
      if (!passwordMatches) return response.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' })
      setSessionCookie(response, user.id, sessionSecret, secureCookie, sameSite)
      return response.json({ user: safeUser(user) })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/auth/logout', (_request, response) => {
    clearSessionCookie(response, secureCookie, sameSite)
    return response.status(204).end()
  })

  app.post('/api/newsletter', newsletterLimiter, async (request, response, next) => {
    try {
      const { email } = newsletterSchema.parse(request.body)
      await database.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?)').run(email)
      return response.status(201).json({ subscribed: true })
    } catch (error) {
      if ((error.code === 'ERR_SQLITE_ERROR' && error.errcode === 2067) || error.code === 'ER_DUP_ENTRY') {
        return response.status(409).json({ error: 'Email này đã đăng ký nhận tin.' })
      }
      return next(error)
    }
  })

  app.get('/api/products', async (_request, response, next) => {
    try {
    const products = await database.prepare(`
      SELECT id, name, category, category_key AS categoryKey, price,
        old_price AS oldPrice, badge, rating, reviews, image, color
      FROM products WHERE active = 1 ORDER BY id
    `).all()
    return response.json({ products })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/products/:id', async (request, response, next) => {
    try {
      const productId = z.coerce.number().int().positive().parse(request.params.id)
      const product = await database.prepare(`
        SELECT id, name, category, category_key AS categoryKey, price,
          old_price AS oldPrice, badge, rating, reviews, image, color
        FROM products WHERE id = ? AND active = 1
      `).get(productId)
      if (!product) throw publicError('Không tìm thấy sản phẩm.', 404)
      return response.json({ product })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/overview', authenticate, requireAdmin, async (_request, response, next) => {
    try {
    const userCount = Number((await database.prepare('SELECT COUNT(*) AS count FROM users').get()).count)
    const orderStats = await database.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) AS pending,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS paid_revenue
      FROM orders
    `).get()
    return response.json({
      userCount,
      orderCount: Number(orderStats.total),
      pendingOrders: Number(orderStats.pending),
      paidRevenue: Number(orderStats.paid_revenue),
    })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/payment-reconciliations', authenticate, requireAdmin, async (_request, response, next) => {
    try {
    const reconciliations = await database.prepare(`
      SELECT payment_reconciliations.id,
        payment_reconciliations.order_id AS orderId,
        payment_reconciliations.payment_attempt_id AS paymentAttemptId,
        payment_reconciliations.transaction_no AS transactionNo,
        payment_reconciliations.amount,
        payment_reconciliations.reason,
        payment_reconciliations.status,
        payment_reconciliations.created_at AS createdAt,
        orders.payment_status AS orderPaymentStatus
      FROM payment_reconciliations
      JOIN orders ON orders.id = payment_reconciliations.order_id
      WHERE payment_reconciliations.status = 'needs_review'
      ORDER BY payment_reconciliations.created_at ASC, payment_reconciliations.id ASC
      LIMIT 100
    `).all()
    return response.json({ reconciliations })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/users', authenticate, requireAdmin, async (_request, response, next) => {
    try {
    const users = await database.prepare(`
      SELECT id, name, email, role, created_at AS createdAt
      FROM users ORDER BY created_at DESC LIMIT 200
    `).all()
    return response.json({ users })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/admin/users/:id/role', authenticate, requireAdmin, async (request, response, next) => {
    try {
      const userId = z.coerce.number().int().positive().parse(request.params.id)
      const role = roleSchema.parse(request.body?.role)
      const updatedUser = await database.transaction(async () => {
        const target = await database.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId)
        if (!target) throw publicError('Không tìm thấy tài khoản.', 404)
        if (target.id === request.user.id && role !== 'admin') {
          throw publicError('Bạn không thể tự hạ quyền tài khoản đang sử dụng.', 409)
        }
        if (target.role === 'admin' && role === 'customer') {
          const adminCount = (await database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()).count
          if (adminCount <= 1) throw publicError('Hệ thống cần duy trì ít nhất một tài khoản admin.', 409)
        }
        await database.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId)
        return database.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId)
      })
      return response.json({ user: safeUser(updatedUser) })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/orders', authenticate, requireAdmin, async (_request, response, next) => {
    try {
    const orders = await database.prepare(`
      SELECT orders.id, users.name AS customerName, users.email AS customerEmail,
        orders.status, orders.payment_method AS paymentMethod,
        orders.payment_status AS paymentStatus,
        orders.fulfillment_status AS fulfillmentStatus, orders.total_amount AS totalAmount,
        orders.created_at AS createdAt, orders.updated_at AS updatedAt
      FROM orders JOIN users ON users.id = orders.user_id
      ORDER BY orders.created_at DESC LIMIT 100
    `).all()
    return response.json({ orders })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/orders/:id', authenticate, requireAdmin, async (request, response, next) => {
    try {
      const orderId = z.uuid().parse(request.params.id)
      const order = await database.prepare(`
        SELECT orders.id, orders.status, orders.payment_method AS paymentMethod,
          orders.payment_status AS paymentStatus,
          orders.fulfillment_status AS fulfillmentStatus, orders.total_amount AS totalAmount,
          orders.shipping_name AS shippingName, orders.shipping_phone AS shippingPhone,
          orders.shipping_address AS shippingAddress, orders.created_at AS createdAt,
          orders.updated_at AS updatedAt, users.name AS customerName, users.email AS customerEmail
        FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?
      `).get(orderId)
      if (!order) throw publicError('Không tìm thấy đơn hàng.', 404)
      const items = await database.prepare(`
        SELECT product_id AS productId, product_name AS name, unit_price AS unitPrice, quantity
        FROM order_items WHERE order_id = ?
      `).all(orderId)
      return response.json({ order: { ...order, items } })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/admin/orders/:id/fulfillment', authenticate, requireAdmin, async (request, response, next) => {
    try {
      const orderId = z.uuid().parse(request.params.id)
      const nextStatus = fulfillmentStatusSchema.parse(request.body?.fulfillmentStatus)
      const nextStep = { new: 'processing', processing: 'shipped', shipped: 'delivered' }
      await database.transaction(async () => {
        const order = await database.prepare(`
          SELECT payment_method AS paymentMethod, payment_status AS paymentStatus,
            fulfillment_status AS fulfillmentStatus
          FROM orders WHERE id = ?
        `).get(orderId)
        if (!order) throw publicError('Không tìm thấy đơn hàng.', 404)
        if (order.paymentStatus !== 'paid' && order.paymentMethod !== 'COD') {
          throw publicError('Chỉ có thể xử lý đơn COD hoặc đơn hàng đã thanh toán.', 409)
        }
        if (nextStep[order.fulfillmentStatus] !== nextStatus) {
          throw publicError('Trạng thái giao hàng không hợp lệ hoặc không theo đúng quy trình.', 409)
        }
        await database.prepare(`
          UPDATE orders SET fulfillment_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND (payment_status = 'paid' OR payment_method = 'COD')
            AND fulfillment_status = ?
        `).run(nextStatus, orderId, order.fulfillmentStatus)
      })
      const order = await database.prepare(`
        SELECT id, fulfillment_status AS fulfillmentStatus, updated_at AS updatedAt
        FROM orders WHERE id = ?
      `).get(orderId)
      return response.json({ order })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/admin/products', authenticate, requireAdmin, async (_request, response, next) => {
    try {
    const products = await database.prepare(`
      SELECT id, name, category, category_key AS categoryKey, price,
        old_price AS oldPrice, badge, rating, reviews, image, color, active
      FROM products ORDER BY id
    `).all()
    return response.json({ products })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/admin/products', authenticate, requireAdmin, async (request, response, next) => {
    try {
      const product = productSchema.parse(request.body)
      const productId = await database.transaction(async () => {
        const nextId = (await database.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM products').get()).id
        await database.prepare(`
          INSERT INTO products (id, name, category, category_key, price, old_price, badge, rating, reviews, image, color)
          VALUES (?, ?, ?, ?, ?, ?, ?, '5.0', 0, ?, ?)
        `).run(nextId, product.name, product.category, product.categoryKey, product.price,
          product.oldPrice, product.badge || null, product.image, product.color)
        return nextId
      })
      const created = await database.prepare(`
        SELECT id, name, category, category_key AS categoryKey, price,
          old_price AS oldPrice, badge, rating, reviews, image, color, active
        FROM products WHERE id = ?
      `).get(productId)
      return response.status(201).json({ product: created })
    } catch (error) {
      return next(error)
    }
  })

  app.put('/api/admin/products/:id', authenticate, requireAdmin, async (request, response, next) => {
    try {
      const productId = z.coerce.number().int().positive().parse(request.params.id)
      const product = productSchema.parse(request.body)
      const result = await database.prepare(`
        UPDATE products SET name = ?, category = ?, category_key = ?, price = ?,
          old_price = ?, badge = ?, image = ?, color = ?
        WHERE id = ?
      `).run(product.name, product.category, product.categoryKey, product.price,
        product.oldPrice, product.badge || null, product.image, product.color, productId)
      if (result.changes === 0) throw publicError('Không tìm thấy sản phẩm.', 404)
      const updated = await database.prepare(`
        SELECT id, name, category, category_key AS categoryKey, price,
          old_price AS oldPrice, badge, rating, reviews, image, color, active
        FROM products WHERE id = ?
      `).get(productId)
      return response.json({ product: updated })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/admin/products/:id/active', authenticate, requireAdmin, async (request, response, next) => {
    try {
      const productId = z.coerce.number().int().positive().parse(request.params.id)
      const { active } = z.object({ active: z.boolean() }).parse(request.body)
      const result = await database.prepare('UPDATE products SET active = ? WHERE id = ?').run(Number(active), productId)
      if (result.changes === 0) throw publicError('Không tìm thấy sản phẩm.', 404)
      const product = await database.prepare(`
        SELECT id, name, category, category_key AS categoryKey, price,
          old_price AS oldPrice, badge, rating, reviews, image, color, active
        FROM products WHERE id = ?
      `).get(productId)
      return response.json({ product })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/orders', authenticate, async (request, response, next) => {
    try {
      const input = orderSchema.parse(request.body)
      const requestId = z.uuid().parse(request.get('Idempotency-Key'))
      const fingerprintInput = {
        items: [...input.items].sort((first, second) => first.productId - second.productId),
        shipping: input.shipping,
      }
      const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex')
      const order = await database.transaction(async () => {
        const existingOrder = await database.prepare(`
          SELECT id, status, payment_method AS paymentMethod,
            total_amount AS totalAmount, request_fingerprint AS requestFingerprint
          FROM orders WHERE user_id = ? AND client_request_id = ?
        `).get(request.user.id, requestId)
        if (existingOrder) {
          if (existingOrder.requestFingerprint !== fingerprint) {
            throw publicError('Mã yêu cầu này đã được dùng cho dữ liệu đơn hàng khác.', 409)
          }
          return {
            idempotent: true,
            orderId: existingOrder.id,
            totalAmount: existingOrder.totalAmount,
            status: existingOrder.status,
            paymentMethod: existingOrder.paymentMethod,
          }
        }

        const pricedItems = []
        for (const { productId, quantity } of input.items) {
          const product = await database.prepare(`
            SELECT id, name, price FROM products WHERE id = ? AND active = 1
          `).get(productId)
          if (!product) throw publicError('Có sản phẩm không còn tồn tại. Vui lòng tải lại trang.')
          pricedItems.push({ productId, quantity, ...product })
        }
        const totalAmount = pricedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
        if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
          throw publicError('Tổng giá trị đơn hàng không hợp lệ.')
        }
        const orderId = randomUUID()
        await database.prepare(`
          INSERT INTO orders (
            id, user_id, status, payment_method, payment_status, total_amount, shipping_name,
            shipping_phone, shipping_address, client_request_id, request_fingerprint
          ) VALUES (?, ?, 'PENDING', 'COD', 'pending', ?, ?, ?, ?, ?, ?)
        `).run(
          orderId,
          request.user.id,
          totalAmount,
          input.shipping.name,
          input.shipping.phone,
          input.shipping.address,
          requestId,
          fingerprint,
        )
        const addItem = database.prepare('INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)')
        for (const item of pricedItems) {
          await addItem.run(orderId, item.productId, item.name, item.price, item.quantity)
        }
        return { orderId, totalAmount, status: 'PENDING', paymentMethod: 'COD', idempotent: false }
      })

      const { idempotent, ...responseOrder } = order
      return response.status(idempotent ? 200 : 201).json({
        message: 'Đặt hàng thành công.',
        ...responseOrder,
      })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/orders', authenticate, async (request, response, next) => {
    try {
    const orders = await database.prepare(`
      SELECT id, status, payment_method AS paymentMethod,
        payment_status AS paymentStatus, total_amount AS totalAmount, created_at AS createdAt
      FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(request.user.id)
    return response.json({ orders })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/orders/:id', authenticate, async (request, response, next) => {
    try {
    const order = await database.prepare(`
      SELECT id, status, payment_method AS paymentMethod,
        payment_status AS paymentStatus, total_amount AS totalAmount, created_at AS createdAt
      FROM orders WHERE id = ? AND user_id = ?
    `).get(request.params.id, request.user.id)
    if (!order) return response.status(404).json({ error: 'Không tìm thấy đơn hàng.' })
    const items = await database.prepare(`
      SELECT product_id AS productId, product_name AS name, unit_price AS unitPrice, quantity
      FROM order_items WHERE order_id = ?
    `).all(order.id)
    return response.json({ order: { ...order, items } })
    } catch (error) {
      return next(error)
    }
  })

  app.use('/api', (_request, response) => response.status(404).json({ error: 'Không tìm thấy API.' }))


  app.use((error, _request, response, _next) => {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: error.issues[0]?.message || 'Dữ liệu gửi lên không hợp lệ.' })
    }
    const status = Number.isInteger(error.status) ? error.status : 500
    if (status >= 500 && !error.expose) logger.error({ code: error.code, status }, 'Request failed')
    return response.status(status).json({
      error: status >= 500 && !error.expose ? 'Đã có lỗi hệ thống. Vui lòng thử lại sau.' : error.message,
    })
  })

  return app
}
