import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { createApp } from './app.js'
import { createDatabase } from './db.js'

const testEnvironment = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
  FRONTEND_ORIGIN: 'https://shop.example.test',
}

let database
let server
let baseUrl

before(async () => {
  database = createDatabase(':memory:')
  server = createApp({ database, env: testEnvironment }).listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  database.close()
})

test('production refuses weak session secrets', () => {
  const productionDatabase = createDatabase(':memory:')
  try {
    assert.throws(
      () => createApp({
        database: productionDatabase,
        env: { ...testEnvironment, NODE_ENV: 'production', SESSION_SECRET: 'too-short' },
      }),
      /SESSION_SECRET must contain at least 32 bytes/,
    )
  } finally {
    productionDatabase.close()
  }
})

test('registration, COD orders and private order access', async () => {
  const health = await fetch(`${baseUrl}/api/health`)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const metrics = await fetch(`${baseUrl}/metrics`)
  const metricsText = await metrics.text()
  assert.equal(metrics.status, 200)
  assert.match(metrics.headers.get('content-type'), /text\/plain/)
  assert.match(metricsText, /http_requests_total\{[^}]*service="dongo-backend"/)
  assert.match(metricsText, /http_request_duration_seconds_bucket/)
  assert.match(metricsText, /dongo_database_up\{service="dongo-backend"\} 1/)

  const anonymousSession = await fetch(`${baseUrl}/api/auth/me`)
  assert.deepEqual(await anonymousSession.json(), { user: null })
  assert.equal((await fetch(`${baseUrl}/api/admin/overview`)).status, 401)

  const invalidEmail = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Invalid Email', email: 'not-an-email', password: 'strong-pass-123' }),
  })
  assert.equal(invalidEmail.status, 400)
  const invalidPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Invalid Password', email: 'password@example.test', password: '' }),
  })
  assert.equal(invalidPassword.status, 400)
  const shortPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Short Password', email: 'short@example.test', password: 'short' }),
  })
  assert.equal(shortPassword.status, 400)

  const invalidNewsletterEmail = await fetch(`${baseUrl}/api/newsletter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  })
  assert.equal(invalidNewsletterEmail.status, 400)
  const newsletterSignup = await fetch(`${baseUrl}/api/newsletter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ' News@example.test ' }),
  })
  assert.equal(newsletterSignup.status, 201)
  assert.equal((await newsletterSignup.json()).subscribed, true)
  assert.equal(database.prepare('SELECT email FROM newsletter_subscribers').get().email, 'news@example.test')
  const duplicateNewsletterSignup = await fetch(`${baseUrl}/api/newsletter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'NEWS@example.test' }),
  })
  assert.equal(duplicateNewsletterSignup.status, 409)

  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test Buyer', email: ' buyer@example.test ', password: 'strong-pass-123', role: 'admin' }),
  })
  assert.equal(registerResponse.status, 201)
  const user = (await registerResponse.json()).user
  assert.equal(user.email, 'buyer@example.test')
  assert.equal(user.role, 'customer')
  const cookie = registerResponse.headers.getSetCookie()[0].split(';')[0]
  assert.match(database.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash, /^\$2[aby]\$/)

  const session = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } })
  assert.equal((await session.json()).user.id, user.id)
  const successfulLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ' BUYER@example.test ', password: 'strong-pass-123' }),
  })
  assert.equal(successfulLogin.status, 200)
  assert.equal((await successfulLogin.json()).user.id, user.id)

  const productsResponse = await fetch(`${baseUrl}/api/products`)
  const products = (await productsResponse.json()).products
  assert.equal(products.length, 8)
  assert.deepEqual(products.map(({ image }) => image), [
    '/images/products/den-ban-mellow.jpg',
    '/images/products/tai-nghe-studio-one.jpg',
    '/images/products/dong-ho-form-02.jpg',
    '/images/products/may-anh-film-sunday.jpg',
    '/images/products/binh-giu-nhiet-day-off.jpg',
    '/images/products/tui-deo-cheo-field.jpg',
    '/images/products/loa-bluetooth-pebble.jpg',
    '/images/products/giay-chay-bo-pace.jpg',
  ])
  assert.equal(products.find(({ id }) => id === 1).price, 890000)
  assert.equal((await (await fetch(`${baseUrl}/api/products/1`)).json()).product.name, 'Đèn bàn Mellow')
  assert.equal((await fetch(`${baseUrl}/api/products/999`)).status, 404)

  const customerAdminAccess = await fetch(`${baseUrl}/api/admin/users`, { headers: { cookie } })
  assert.equal(customerAdminAccess.status, 403)
  assert.equal((await fetch(`${baseUrl}/api/admin/products`, { headers: { cookie } })).status, 403)
  assert.equal((await fetch(`${baseUrl}/api/admin/orders`, { headers: { cookie } })).status, 403)
  assert.equal((await fetch(`${baseUrl}/api/admin/payment-reconciliations`, { headers: { cookie } })).status, 403)

  const secondRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Second Buyer', email: 'second@example.test', password: 'strong-pass-123' }),
  })
  const secondUser = (await secondRegistration.json()).user
  const secondCookie = secondRegistration.headers.getSetCookie()[0].split(';')[0]
  database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id)

  const adminOverview = await fetch(`${baseUrl}/api/admin/overview`, { headers: { cookie } })
  assert.equal(adminOverview.status, 200)
  assert.equal((await adminOverview.json()).userCount, 2)

  const invalidProduct = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Invalid Product', category: 'Home', categoryKey: 'home', price: 1000,
      oldPrice: 500, badge: null, image: 'javascript:alert(1)', color: '#ffffff',
    }),
  })
  assert.equal(invalidProduct.status, 400)
  const createProduct = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Admin Test Product', category: 'Nhà cửa', categoryKey: 'home',
      price: 125000, oldPrice: null, badge: null, image: '/images/products/admin-test.webp', color: '#e8e2d5',
    }),
  })
  assert.equal(createProduct.status, 201)
  const createdProduct = (await createProduct.json()).product
  assert.equal(createdProduct.id, 9)
  assert.equal(createdProduct.image, '/images/products/admin-test.webp')
  const customImageUrl = 'https://cdn.example.test/products/admin-test.webp?variant=front&token=kept'
  const updateProduct = await fetch(`${baseUrl}/api/admin/products/${createdProduct.id}`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Updated Admin Product', category: 'Nhà cửa', categoryKey: 'home',
      price: 130000, oldPrice: null, badge: null, image: customImageUrl, color: '#e8e2d5',
    }),
  })
  const updatedProduct = (await updateProduct.json()).product
  assert.equal(updatedProduct.name, 'Updated Admin Product')
  assert.equal(updatedProduct.image, customImageUrl)
  const deactivateProduct = await fetch(`${baseUrl}/api/admin/products/${createdProduct.id}/active`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ active: false }),
  })
  assert.equal((await deactivateProduct.json()).product.active, 0)
  assert.equal((await fetch(`${baseUrl}/api/products/${createdProduct.id}`)).status, 404)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM products WHERE id = ?').get(createdProduct.id).count, 1)

  const promoteSecondUser = await fetch(`${baseUrl}/api/admin/users/${secondUser.id}/role`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  })
  assert.equal((await promoteSecondUser.json()).user.role, 'admin')

  const selfDemotion = await fetch(`${baseUrl}/api/admin/users/${user.id}/role`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'customer' }),
  })
  assert.equal(selfDemotion.status, 409)

  const demoteSecondUser = await fetch(`${baseUrl}/api/admin/users/${secondUser.id}/role`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'customer' }),
  })
  assert.equal((await demoteSecondUser.json()).user.role, 'customer')

  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other Buyer', email: 'BUYER@example.test', password: 'strong-pass-123' }),
  })
  assert.equal(duplicate.status, 409)

  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'buyer@example.test', password: 'wrong-password' }),
  })
  assert.equal(badLogin.status, 401)
  const anonymousOrder = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 2 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(anonymousOrder.status, 401)

  const emptyOrder = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    body: JSON.stringify({ items: [], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(emptyOrder.status, 400)
  const invalidQuantity = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '22222222-2222-4222-8222-222222222222' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 0 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(invalidQuantity.status, 400)
  const excessiveQuantity = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '22222222-2222-4222-8222-222222222224' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 21 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(excessiveQuantity.status, 400)
  const missingProduct = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '22222222-2222-4222-8222-222222222225' },
    body: JSON.stringify({ items: [{ productId: 999, quantity: 1 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(missingProduct.status, 400)
  const invalidShipping = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '22222222-2222-4222-8222-222222222223' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }], shipping: { name: 'Test Buyer', phone: 'not-a-phone', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(invalidShipping.status, 400)

  database.prepare('UPDATE products SET price = ? WHERE id = ?').run(900000, 1)
  const orderResponse = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '33333333-3333-4333-8333-333333333333' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 2, price: 1 }], totalAmount: 1, shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(orderResponse.status, 201)
  const order = await orderResponse.json()
  const { orderId, totalAmount } = order
  assert.equal(totalAmount, 1800000)
  const invalidFulfillmentStep = await fetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'shipped' }),
  })
  assert.equal(invalidFulfillmentStep.status, 409)
  const repeatedOrder = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '33333333-3333-4333-8333-333333333333' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 2 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(repeatedOrder.status, 200)
  assert.equal((await repeatedOrder.json()).orderId, orderId)
  const reusedKey = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '33333333-3333-4333-8333-333333333333' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  assert.equal(reusedKey.status, 409)

  const ownOrder = await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie } })
  const ownOrderBody = await ownOrder.json()
  assert.equal(ownOrderBody.order.paymentStatus, 'pending')
  assert.equal(ownOrderBody.order.paymentMethod, 'COD')
  const foreignOrder = await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie: secondCookie } })
  assert.equal(foreignOrder.status, 404)

  assert.equal(order.status, 'PENDING')
  assert.equal(order.paymentMethod, 'COD')
  assert.equal(order.message, 'Đặt hàng thành công.')
  assert.equal(database.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'PENDING')
  assert.equal(database.prepare('SELECT payment_method FROM orders WHERE id = ?').get(orderId).payment_method, 'COD')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?').get(orderId).count, 1)
  const removedVnpayRoute = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId }),
  })
  assert.equal(removedVnpayRoute.status, 404)

  const pendingOrder = await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie } })
  assert.equal((await pendingOrder.json()).order.paymentStatus, 'pending')
  const adminOrderDetails = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, { headers: { cookie } })
  assert.equal(adminOrderDetails.status, 200)
  const orderDetails = (await adminOrderDetails.json()).order
  assert.equal(orderDetails.shippingAddress, '12 Test Street, Hanoi')
  assert.equal(orderDetails.items[0].unitPrice, 900000)
  assert.equal(orderDetails.fulfillmentStatus, 'new')
  assert.equal(orderDetails.paymentMethod, 'COD')
  assert.equal((await fetch(`${baseUrl}/api/admin/orders/${orderId}`, { headers: { cookie: secondCookie } })).status, 403)
  const skippedFulfillmentStep = await fetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'shipped' }),
  })
  assert.equal(skippedFulfillmentStep.status, 409)
  const processingOrder = await fetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'processing' }),
  })
  assert.equal((await processingOrder.json()).order.fulfillmentStatus, 'processing')
  const shippedOrder = await fetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'shipped' }),
  })
  assert.equal((await shippedOrder.json()).order.fulfillmentStatus, 'shipped')

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie } })
  assert.equal(logout.status, 204)
  assert.match(logout.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/i)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/auth/me`)).json(), { user: null })
})

test('COD checkout does not require payment-gateway configuration', async () => {
  const codDatabase = createDatabase(':memory:')
  const codServer = createApp({ database: codDatabase, env: testEnvironment }).listen(0, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => {
      codServer.once('listening', resolve)
      codServer.once('error', reject)
    })
    const codBaseUrl = `http://127.0.0.1:${codServer.address().port}`
    const registration = await fetch(`${codBaseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'COD Buyer', email: 'cod@example.test', password: 'strong-pass-123' }),
    })
    const cookie = registration.headers.getSetCookie()[0].split(';')[0]
    const orderResponse = await fetch(`${codBaseUrl}/api/orders`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '55555555-5555-4555-8555-555555555555' },
      body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }], shipping: { name: 'COD Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
    })
    assert.equal(orderResponse.status, 201)
    const order = await orderResponse.json()
    assert.equal(order.status, 'PENDING')
    assert.equal(order.paymentMethod, 'COD')
    assert.equal(codDatabase.prepare('SELECT payment_method FROM orders WHERE id = ?').get(order.orderId).payment_method, 'COD')
  } finally {
    await new Promise((resolve, reject) => codServer.close((error) => error ? reject(error) : resolve()))
    codDatabase.close()
  }
})

test('login rejects malformed email input', async (context) => {
  const loginDatabase = createDatabase(':memory:')
  const loginServer = createApp({ database: loginDatabase, env: testEnvironment }).listen(0, '127.0.0.1')
  context.after(async () => {
    await new Promise((resolve, reject) => loginServer.close((error) => error ? reject(error) : resolve()))
    loginDatabase.close()
  })
  await new Promise((resolve, reject) => {
    loginServer.once('listening', resolve)
    loginServer.once('error', reject)
  })
  const response = await fetch(`http://127.0.0.1:${loginServer.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'strong-pass-123' }),
  })
  assert.equal(response.status, 400)
})

test('database outages are returned as server errors rather than invalid sessions', async (context) => {
  const unavailableDatabase = createDatabase(':memory:')
  const unavailableServer = createApp({ database: unavailableDatabase, env: testEnvironment }).listen(0, '127.0.0.1')
  context.after(async () => {
    await new Promise((resolve, reject) => unavailableServer.close((error) => error ? reject(error) : resolve()))
  })
  await new Promise((resolve, reject) => {
    unavailableServer.once('listening', resolve)
    unavailableServer.once('error', reject)
  })
  const unavailableUrl = `http://127.0.0.1:${unavailableServer.address().port}`
  const registerResponse = await fetch(`${unavailableUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Database Test', email: 'database@example.test', password: 'strong-pass-123' }),
  })
  const cookie = registerResponse.headers.getSetCookie()[0].split(';')[0]
  unavailableDatabase.close()
  const response = await fetch(`${unavailableUrl}/api/auth/me`, { headers: { cookie } })
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /lỗi hệ thống/i)
})

test('legacy database data and custom images are preserved while catalog images are migrated', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'dongo-role-migration-'))
  const databasePath = join(temporaryDirectory, 'legacy.sqlite')
  const legacyDatabase = new DatabaseSync(databasePath)
  legacyDatabase.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (name, email, password_hash) VALUES ('Existing Buyer', 'existing@example.test', 'hash');
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'paid', 'payment_failed')),
      payment_status TEXT NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed')),
      total_amount INTEGER NOT NULL CHECK (total_amount > 0),
      shipping_name TEXT NOT NULL,
      shipping_phone TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO orders (id, user_id, status, payment_status, total_amount, shipping_name, shipping_phone, shipping_address)
    VALUES ('00000000-0000-4000-8000-000000000001', 1, 'awaiting_payment', 'pending', 890000, 'Existing Buyer', '0912345678', '12 Test Street, Hanoi');
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
    VALUES ('00000000-0000-4000-8000-000000000001', 1, 'Đèn bàn Mellow', 890000, 1);
  `)
  legacyDatabase.close()

  const migratedDatabase = createDatabase(databasePath)
  try {
    const existingUser = migratedDatabase.prepare('SELECT role FROM users WHERE email = ?').get('existing@example.test')
    assert.equal(existingUser.role, 'customer')
    const existingOrder = migratedDatabase.prepare('SELECT total_amount, client_request_id FROM orders WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000001')
    assert.equal(existingOrder.total_amount, 890000)
    assert.equal(existingOrder.client_request_id, null)
    const migratedOrder = migratedDatabase.prepare('SELECT status, payment_method, fulfillment_status, updated_at, created_at FROM orders WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000001')
    assert.equal(migratedOrder.status, 'awaiting_payment')
    assert.equal(migratedOrder.payment_method, 'VNPAY')
    assert.equal(migratedOrder.fulfillment_status, 'new')
    assert.equal(migratedOrder.updated_at, migratedOrder.created_at)
    assert.equal(migratedDatabase.prepare('SELECT COUNT(*) AS count FROM order_items').get().count, 1)
    migratedDatabase.prepare(`
      INSERT INTO orders (
        id, user_id, status, payment_method, payment_status, total_amount,
        shipping_name, shipping_phone, shipping_address
      ) VALUES (?, ?, 'PENDING', 'COD', 'pending', ?, ?, ?, ?)
    `).run('00000000-0000-4000-8000-000000000002', 1, 890000, 'COD Buyer', '0912345678', '12 Test Street, Hanoi')
    migratedDatabase.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `).run('00000000-0000-4000-8000-000000000002', 1, 'COD Product', 890000, 1)
    assert.equal(migratedDatabase.prepare('PRAGMA foreign_key_check').all().length, 0)
    assert.equal(migratedDatabase.prepare('SELECT COUNT(*) AS count FROM products').get().count, 8)
    assert.equal(
      migratedDatabase.prepare('SELECT image FROM products WHERE id = ?').get(3).image,
      '/images/products/dong-ho-form-02.jpg',
    )
    migratedDatabase.prepare('UPDATE products SET name = ? WHERE id = ?').run('Existing Catalog Item', 1)
    migratedDatabase.prepare('UPDATE products SET image = ? WHERE id = ?')
      .run('photo-1507473885765-e6ed057f782c', 1)
    const customImageUrl = 'https://cdn.example.test/custom-item.jpg?token=keep-me'
    migratedDatabase.prepare('UPDATE products SET image = ? WHERE id = ?').run(customImageUrl, 2)
    const rerunDatabase = createDatabase(databasePath)
    try {
      assert.equal(
        rerunDatabase.prepare('SELECT name FROM products WHERE id = ?').get(1).name,
        'Existing Catalog Item',
      )
      assert.ok(rerunDatabase.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'payment_reconciliations'
      `).get())
      assert.equal(
        rerunDatabase.prepare('SELECT image FROM products WHERE id = ?').get(1).image,
        '/images/products/den-ban-mellow.jpg',
      )
      assert.equal(
        rerunDatabase.prepare('SELECT image FROM products WHERE id = ?').get(2).image,
        customImageUrl,
      )
      assert.equal(rerunDatabase.prepare('SELECT total_amount FROM orders WHERE id = ?')
        .get('00000000-0000-4000-8000-000000000001').total_amount, 890000)
    } finally {
      rerunDatabase.close()
    }
  } finally {
    migratedDatabase.close()
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})
