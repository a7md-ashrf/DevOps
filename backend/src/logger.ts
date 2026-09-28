import pino from 'pino';
import type { Config } from './config.js';

export type Logger = pino.Logger;

/**
 * JSON to stdout in production, human-readable when developing.
 *
 * WHY stdout: containers should never write log files themselves — Docker's
 * json-file driver handles rotation (see infra/setup/vps-bootstrap.sh), and a
 * single stdout stream is what `docker logs`, CI, and any future log shipper
 * all expect.
 */
export function createLogger(config: Pick<Config, 'logLevel' | 'logFormat'>): Logger {
  if (config.logFormat === 'pretty') {
    return pino(
      { level: config.logLevel },
      pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      }),
    );
  }
  return pino({ level: config.logLevel });
}
