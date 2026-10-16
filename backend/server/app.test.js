import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { createApp } from './app.js'
import { createDatabase } from './db.js'
import { createVnpaySignature } from './vnpay.js'

const hashSecret = 'sandbox-test-secret-do-not-use-in-production'
const testEnvironment = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
  VNPAY_TMN_CODE: 'TESTCODE',
  VNPAY_HASH_SECRET: hashSecret,
  VNPAY_RETURN_URL: 'https://shop.example.test/api/payments/vnpay/return',
  VNPAY_IPN_URL: 'https://shop.example.test/api/payments/vnpay/ipn',
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

test('registration, private orders and signed VNPay callbacks', async () => {
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
  const { orderId, totalAmount } = await orderResponse.json()
  assert.equal(totalAmount, 1800000)
  const unpaidFulfillmentUpdate = await fetch(`${baseUrl}/api/admin/orders/${orderId}/fulfillment`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ fulfillmentStatus: 'processing' }),
  })
  assert.equal(unpaidFulfillmentUpdate.status, 409)
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
  assert.equal((await ownOrder.json()).order.paymentStatus, 'pending')
  const foreignOrder = await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie: secondCookie } })
  assert.equal(foreignOrder.status, 404)

  const paymentResponse = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId }),
  })
  assert.equal(paymentResponse.status, 200)
  const paymentUrl = new URL((await paymentResponse.json()).paymentUrl)
  assert.equal(paymentUrl.searchParams.get('vnp_Amount'), '180000000')
  assert.equal(paymentUrl.searchParams.get('vnp_TmnCode'), testEnvironment.VNPAY_TMN_CODE)
  const duplicatePayment = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId }),
  })
  assert.equal(duplicatePayment.status, 409)

  const callback = Object.fromEntries(paymentUrl.searchParams.entries())
  delete callback.vnp_SecureHash
  callback.vnp_ResponseCode = '00'
  callback.vnp_TransactionStatus = '00'
  callback.vnp_TransactionNo = '123456'
  callback.vnp_SecureHash = createVnpaySignature(callback, hashSecret)

  const invalidCallback = { ...callback, vnp_ResponseCode: '24' }
  const invalidIpnUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(invalidCallback)) invalidIpnUrl.searchParams.set(key, value)
  assert.equal((await (await fetch(invalidIpnUrl)).json()).RspCode, '97')
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'pending')
  const invalidAmountCallback = { ...callback, vnp_Amount: '100' }
  delete invalidAmountCallback.vnp_SecureHash
  invalidAmountCallback.vnp_SecureHash = createVnpaySignature(invalidAmountCallback, hashSecret)
  const invalidAmountUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(invalidAmountCallback)) invalidAmountUrl.searchParams.set(key, value)
  assert.equal((await (await fetch(invalidAmountUrl)).json()).RspCode, '04')
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'pending')

  const returnUrl = new URL(`${baseUrl}/api/payments/vnpay/return`)
  for (const [key, value] of Object.entries(callback)) returnUrl.searchParams.set(key, value)
  const browserReturn = await fetch(returnUrl, { redirect: 'manual' })
  assert.equal(browserReturn.status, 303)
  assert.match(browserReturn.headers.get('location'), /payment=returned/)
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'pending')

  const ipnUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(callback)) ipnUrl.searchParams.set(key, value)
  const concurrentIpns = await Promise.all([fetch(ipnUrl), fetch(ipnUrl)])
  const concurrentResponses = await Promise.all(concurrentIpns.map(async (response) => (await response.json()).RspCode))
  assert.deepEqual(concurrentResponses.sort(), ['00', '02'])

  const paidOrder = await fetch(`${baseUrl}/api/orders/${orderId}`, { headers: { cookie } })
  assert.equal((await paidOrder.json()).order.paymentStatus, 'paid')
  const adminOrderDetails = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, { headers: { cookie } })
  assert.equal(adminOrderDetails.status, 200)
  const orderDetails = (await adminOrderDetails.json()).order
  assert.equal(orderDetails.shippingAddress, '12 Test Street, Hanoi')
  assert.equal(orderDetails.items[0].unitPrice, 900000)
  assert.equal(orderDetails.fulfillmentStatus, 'new')
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

  const repeatedIpn = await fetch(ipnUrl)
  assert.equal((await repeatedIpn.json()).RspCode, '02')

  const failedOrderResponse = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '44444444-4444-4444-8444-444444444444' },
    body: JSON.stringify({ items: [{ productId: 2, quantity: 1 }], shipping: { name: 'Test Buyer', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  const failedOrder = await failedOrderResponse.json()
  const failedPaymentResponse = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: failedOrder.orderId }),
  })
  const failedPaymentUrl = new URL((await failedPaymentResponse.json()).paymentUrl)
  const failedCallback = Object.fromEntries(failedPaymentUrl.searchParams.entries())
  delete failedCallback.vnp_SecureHash
  failedCallback.vnp_ResponseCode = '24'
  failedCallback.vnp_TransactionStatus = '02'
  failedCallback.vnp_TransactionNo = '123457'
  failedCallback.vnp_SecureHash = createVnpaySignature(failedCallback, hashSecret)
  const failedIpnUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(failedCallback)) failedIpnUrl.searchParams.set(key, value)
  assert.equal((await (await fetch(failedIpnUrl)).json()).RspCode, '00')
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${failedOrder.orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'failed')
  const retryPayment = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: failedOrder.orderId }),
  })
  assert.equal(retryPayment.status, 200)
  const retryPaymentUrl = new URL((await retryPayment.json()).paymentUrl)
  const lateSuccessCallback = Object.fromEntries(failedPaymentUrl.searchParams.entries())
  delete lateSuccessCallback.vnp_SecureHash
  lateSuccessCallback.vnp_ResponseCode = '00'
  lateSuccessCallback.vnp_TransactionStatus = '00'
  lateSuccessCallback.vnp_TransactionNo = '123458'
  lateSuccessCallback.vnp_SecureHash = createVnpaySignature(lateSuccessCallback, hashSecret)
  const lateSuccessUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(lateSuccessCallback)) lateSuccessUrl.searchParams.set(key, value)
  assert.equal((await (await fetch(lateSuccessUrl)).json()).RspCode, '00')
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${failedOrder.orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'pending')
  assert.equal(database.prepare('SELECT status FROM payment_attempts WHERE txn_ref = ?').get(failedPaymentUrl.searchParams.get('vnp_TxnRef')).status, 'failed')
  assert.equal(database.prepare('SELECT reason FROM payment_reconciliations WHERE payment_attempt_id = (SELECT id FROM payment_attempts WHERE txn_ref = ?)').get(failedPaymentUrl.searchParams.get('vnp_TxnRef')).reason, 'superseded_attempt')
  assert.equal((await (await fetch(lateSuccessUrl)).json()).RspCode, '00')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM payment_reconciliations WHERE payment_attempt_id = (SELECT id FROM payment_attempts WHERE txn_ref = ?)').get(failedPaymentUrl.searchParams.get('vnp_TxnRef')).count, 1)

  const duplicateRetry = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: failedOrder.orderId }),
  })
  assert.equal(duplicateRetry.status, 409)
  database.prepare(`
    UPDATE payment_attempts SET created_at = datetime('now', '-16 minutes')
    WHERE order_id = ? AND status = 'pending'
  `).run(failedOrder.orderId)
  const expiredRetry = await fetch(`${baseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: failedOrder.orderId }),
  })
  assert.equal(expiredRetry.status, 200)
  const expiredRetryUrl = new URL((await expiredRetry.json()).paymentUrl)
  assert.equal((await (await fetch(failedIpnUrl)).json()).RspCode, '02')
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${failedOrder.orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'pending')
  const expiredSuccessCallback = Object.fromEntries(retryPaymentUrl.searchParams.entries())
  delete expiredSuccessCallback.vnp_SecureHash
  expiredSuccessCallback.vnp_ResponseCode = '00'
  expiredSuccessCallback.vnp_TransactionStatus = '00'
  expiredSuccessCallback.vnp_TransactionNo = '123459'
  expiredSuccessCallback.vnp_SecureHash = createVnpaySignature(expiredSuccessCallback, hashSecret)
  const expiredSuccessUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(expiredSuccessCallback)) expiredSuccessUrl.searchParams.set(key, value)
  assert.equal((await (await fetch(expiredSuccessUrl)).json()).RspCode, '00')
  assert.equal((await (await fetch(`${baseUrl}/api/orders/${failedOrder.orderId}`, { headers: { cookie } })).json()).order.paymentStatus, 'pending')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM payment_reconciliations WHERE order_id = ?').get(failedOrder.orderId).count, 2)
  assert.equal(database.prepare('SELECT status FROM payment_attempts WHERE txn_ref = ?').get(retryPaymentUrl.searchParams.get('vnp_TxnRef')).status, 'failed')
  assert.equal(database.prepare('SELECT reason FROM payment_reconciliations WHERE payment_attempt_id = (SELECT id FROM payment_attempts WHERE txn_ref = ?)').get(retryPaymentUrl.searchParams.get('vnp_TxnRef')).reason, 'superseded_attempt')
  assert.equal(database.prepare('SELECT status FROM payment_attempts WHERE txn_ref = ?').get(expiredRetryUrl.searchParams.get('vnp_TxnRef')).status, 'pending')
  assert.equal((await (await fetch(expiredSuccessUrl)).json()).RspCode, '00')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM payment_reconciliations WHERE order_id = ?').get(failedOrder.orderId).count, 2)
  const reconciliationsResponse = await fetch(`${baseUrl}/api/admin/payment-reconciliations`, { headers: { cookie } })
  assert.equal(reconciliationsResponse.status, 200)
  const { reconciliations } = await reconciliationsResponse.json()
  assert.equal(reconciliations.length, 2)
  assert.ok(reconciliations.every(({ status }) => status === 'needs_review'))

  callback.vnp_ResponseCode = '24'
  const tamperedUrl = new URL(`${baseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(callback)) tamperedUrl.searchParams.set(key, value)
  assert.equal((await (await fetch(tamperedUrl)).json()).RspCode, '97')

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie } })
  assert.equal(logout.status, 204)
  assert.match(logout.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/i)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/auth/me`)).json(), { user: null })
})

test('checkout stays pending when VNPay merchant credentials are missing', async (context) => {
  const missingConfigDatabase = createDatabase(':memory:')
  const missingConfigEnvironment = { ...testEnvironment, VNPAY_HASH_SECRET: '' }
  const missingConfigServer = createApp({ database: missingConfigDatabase, env: missingConfigEnvironment })
    .listen(0, '127.0.0.1')
  context.after(async () => {
    await new Promise((resolve, reject) => missingConfigServer.close((error) => error ? reject(error) : resolve()))
    missingConfigDatabase.close()
  })
  await new Promise((resolve, reject) => {
    missingConfigServer.once('listening', resolve)
    missingConfigServer.once('error', reject)
  })
  const missingConfigUrl = `http://127.0.0.1:${missingConfigServer.address().port}`

  const registerResponse = await fetch(`${missingConfigUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Payment Test', email: 'payment@example.test', password: 'strong-pass-123' }),
  })
  const cookie = registerResponse.headers.getSetCookie()[0].split(';')[0]
  const orderResponse = await fetch(`${missingConfigUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '55555555-5555-4555-8555-555555555555' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }], shipping: { name: 'Payment Test', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  const { orderId } = await orderResponse.json()
  const paymentResponse = await fetch(`${missingConfigUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId }),
  })
  assert.equal(paymentResponse.status, 503)
  assert.match((await paymentResponse.json()).error, /VNPay chưa được cấu hình/)
  const order = await missingConfigDatabase.prepare('SELECT status, payment_status FROM orders WHERE id = ?').get(orderId)
  assert.equal(order.status, 'awaiting_payment')
  assert.equal(order.payment_status, 'pending')
})

test('VNPay callback rolls back database failures without marking an order paid', async (context) => {
  const paymentDatabase = createDatabase(':memory:')
  const paymentServer = createApp({ database: paymentDatabase, env: testEnvironment }).listen(0, '127.0.0.1')
  context.after(async () => {
    await new Promise((resolve, reject) => paymentServer.close((error) => error ? reject(error) : resolve()))
    paymentDatabase.close()
  })
  await new Promise((resolve, reject) => {
    paymentServer.once('listening', resolve)
    paymentServer.once('error', reject)
  })
  const paymentBaseUrl = `http://127.0.0.1:${paymentServer.address().port}`
  const registration = await fetch(`${paymentBaseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Callback Test', email: 'callback@example.test', password: 'strong-pass-123' }),
  })
  const cookie = registration.headers.getSetCookie()[0].split(';')[0]
  const createdOrder = await fetch(`${paymentBaseUrl}/api/orders`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': '66666666-6666-4666-8666-666666666666' },
    body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }], shipping: { name: 'Callback Test', phone: '0912345678', address: '12 Test Street, Hanoi' } }),
  })
  const { orderId } = await createdOrder.json()
  const payment = await fetch(`${paymentBaseUrl}/api/payments/vnpay/create`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ orderId }),
  })
  const paymentUrl = new URL((await payment.json()).paymentUrl)
  const callback = Object.fromEntries(paymentUrl.searchParams.entries())
  delete callback.vnp_SecureHash
  callback.vnp_ResponseCode = '00'
  callback.vnp_TransactionStatus = '00'
  callback.vnp_TransactionNo = '7654321'
  callback.vnp_SecureHash = createVnpaySignature(callback, hashSecret)
  paymentDatabase.exec(`
    CREATE TRIGGER reject_order_payment_update
    BEFORE UPDATE OF status, payment_status ON orders
    BEGIN SELECT RAISE(ABORT, 'simulated payment database failure'); END
  `)
  const ipnUrl = new URL(`${paymentBaseUrl}/api/payments/vnpay/ipn`)
  for (const [key, value] of Object.entries(callback)) ipnUrl.searchParams.set(key, value)
  const ipn = await fetch(ipnUrl)
  assert.equal((await ipn.json()).RspCode, '99')
  assert.equal(paymentDatabase.prepare('SELECT payment_status FROM orders WHERE id = ?').get(orderId).payment_status, 'pending')
  assert.equal(paymentDatabase.prepare('SELECT status FROM payment_attempts WHERE order_id = ?').get(orderId).status, 'pending')
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
    const migratedOrder = migratedDatabase.prepare('SELECT fulfillment_status, updated_at, created_at FROM orders WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000001')
    assert.equal(migratedOrder.fulfillment_status, 'new')
    assert.equal(migratedOrder.updated_at, migratedOrder.created_at)
    assert.equal(migratedDatabase.prepare('SELECT COUNT(*) AS count FROM order_items').get().count, 1)
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
