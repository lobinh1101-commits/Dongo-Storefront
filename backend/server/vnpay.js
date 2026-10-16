import { createHmac, timingSafeEqual } from 'node:crypto'
import { stringify } from 'node:querystring'

const SANDBOX_PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'

function formatVietnamTime(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`
}

function sortedQuery(values) {
  return stringify(Object.fromEntries(
    Object.entries(values).sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0)),
  ))
}

export function createVnpaySignature(values, secret) {
  return createHmac('sha512', secret).update(sortedQuery(values), 'utf8').digest('hex')
}

export function verifyVnpaySignature(query, secret) {
  const supplied = query.vnp_SecureHash
  if (typeof supplied !== 'string' || !/^[a-f\d]{128}$/i.test(supplied)) return false

  const values = {}
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('vnp_') || key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue
    if (typeof value !== 'string') return false
    values[key] = value
  }

  const expected = Buffer.from(createVnpaySignature(values, secret), 'hex')
  const actual = Buffer.from(supplied, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function createVnpayPaymentUrl({ order, attempt, customerIp, env, now = new Date() }) {
  const required = ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET', 'VNPAY_RETURN_URL', 'VNPAY_IPN_URL']
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    const error = new Error(`Thiếu cấu hình VNPay: ${missing.join(', ')}`)
    error.status = 503
    throw error
  }

  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
  const parameters = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: env.VNPAY_TMN_CODE,
    vnp_Amount: String(order.total_amount * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: attempt.txn_ref,
    vnp_OrderInfo: `Thanh toan don hang ${attempt.txn_ref}`,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: env.VNPAY_RETURN_URL,
    vnp_IpAddr: customerIp === '::1' ? '127.0.0.1' : customerIp,
    vnp_CreateDate: formatVietnamTime(now),
    vnp_ExpireDate: formatVietnamTime(expiresAt),
  }
  const query = sortedQuery(parameters)
  const signature = createVnpaySignature(parameters, env.VNPAY_HASH_SECRET)
  return `${SANDBOX_PAYMENT_URL}?${query}&vnp_SecureHash=${signature}`
}
