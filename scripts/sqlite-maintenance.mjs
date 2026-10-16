import { access, open, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

async function assertReadableDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const result = database.prepare('PRAGMA quick_check').get()
    const tables = database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).get().count
    if (result?.quick_check !== 'ok' || tables < 1) {
      throw new Error('SQLite integrity check failed or no application tables were found.')
    }
    return Number(tables)
  } finally {
    database.close()
  }
}

async function main() {
  const [action, sourceArgument, targetArgument] = process.argv.slice(2)
  const sourcePath = resolve(sourceArgument || '')
  if (!action || !sourceArgument) {
    throw new Error('Usage: node sqlite-maintenance.mjs <backup|verify|restore-stage> <source> [target]')
  }

  if (action === 'verify') {
    const tables = await assertReadableDatabase(sourcePath)
    console.log(`SQLite integrity check passed; application tables: ${tables}`)
    return
  }

  if (action !== 'backup' && action !== 'restore-stage') {
    throw new Error(`Unsupported action: ${action}`)
  }
  if (!targetArgument) throw new Error(`${action} requires a destination path.`)

  const targetPath = resolve(targetArgument)
  if (sourcePath.toLowerCase() === targetPath.toLowerCase()) {
    throw new Error('Source and destination must be different files.')
  }
  try {
    await access(targetPath)
    throw new Error('Destination already exists; refusing to overwrite it.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const sourceTables = await assertReadableDatabase(sourcePath)
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  let createdDestination = false
  try {
    const snapshot = source.serialize()
    const destination = await open(targetPath, 'wx')
    createdDestination = true
    try {
      await destination.writeFile(snapshot)
    } finally {
      await destination.close()
    }
    const targetTables = await assertReadableDatabase(targetPath)
    if (sourceTables !== targetTables) {
      throw new Error('Backup verification found a different number of application tables.')
    }
    console.log(`SQLite ${action} completed and verified; application tables: ${targetTables}`)
  } catch (error) {
    if (createdDestination) await rm(targetPath, { force: true })
    throw error
  } finally {
    source.close()
  }
}

main().catch((error) => {
  console.error(`SQLite maintenance failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  process.exitCode = 1
})
