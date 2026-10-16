import 'dotenv/config'
import { z } from 'zod'
import { createMySqlDatabase } from './db-mysql.js'

const parsedEmail = z.email().safeParse(process.argv[2]?.trim().toLowerCase())
if (!parsedEmail.success) {
  console.error('Usage: npm run admin:promote --workspace=backend -- <registered-email>')
  process.exitCode = 1
} else {
  try {
    const databaseDriver = (process.env.DB_DRIVER || 'sqlite').toLowerCase()
    if (!['sqlite', 'mysql'].includes(databaseDriver)) {
      throw new Error('DB_DRIVER must be either sqlite or mysql')
    }
    const database = databaseDriver === 'mysql'
      ? await createMySqlDatabase()
      : (await import('./db.js')).createDatabase(process.env.DATABASE_PATH || 'data/storefront.sqlite')
    try {
      const result = await database.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(parsedEmail.data)
      if (result.changes === 0) {
        console.error(`No registered account found for ${parsedEmail.data}. Create the account first.`)
        process.exitCode = 1
      } else {
        console.log(`Admin role granted to ${parsedEmail.data}. Sign in again to refresh the account view.`)
      }
    } finally {
      await database.close()
    }
  } catch (error) {
    console.error('Unable to promote admin:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
