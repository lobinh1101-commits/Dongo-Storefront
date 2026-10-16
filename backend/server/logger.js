import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import pino from 'pino'

const logFile = process.env.LOG_FILE
const streams = []

if (logFile) {
  mkdirSync(dirname(logFile), { recursive: true })
  streams.push({ stream: pino.destination({ dest: logFile, sync: false }) })
}
streams.push({ stream: process.stdout })

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'dongo-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
    censor: '[REDACTED]',
  },
}, pino.multistream(streams))
