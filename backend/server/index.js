import 'dotenv/config'
import { createApp } from './app.js'
import { createMySqlDatabase } from './db-mysql.js'

const databaseDriver = (process.env.DB_DRIVER || 'sqlite').toLowerCase()
if (!['sqlite', 'mysql'].includes(databaseDriver)) {
  throw new Error('DB_DRIVER must be either sqlite or mysql')
}
const database = databaseDriver === 'mysql'
  ? await createMySqlDatabase()
  : (await import('./db.js')).createDatabase(process.env.DATABASE_PATH || 'data/storefront.sqlite')
const app = createApp({ database })
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
const server = app.listen(port, host, () => {
  console.log(`Dongo API listening on http://${host}:${port}`)
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production') {
    console.warn('SESSION_SECRET is unset; a temporary development-only key is being used.')
  }
  if (!process.env.VNPAY_TMN_CODE) {
    console.warn('VNPay is not configured. Copy .env.example to .env and add sandbox credentials to enable checkout.')
  }
})

function shutdown() {
  server.close(() => {
    Promise.resolve(database.close()).then(() => process.exit(0)).catch((error) => {
      console.error('Failed to close the database cleanly:', error)
      process.exitCode = 1
    })
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
