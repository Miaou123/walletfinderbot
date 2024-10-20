const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file');

const logDir = path.join(__dirname, '../logs');

// Fonction pour nettoyer et simplifier les données
const simplifyData = (data) => {
  if (typeof data === 'object' && data !== null) {
    // Si c'est un objet, on extrait seulement les données pertinentes
    if (data.data) {
      return JSON.stringify(data.data);
    }
    // Sinon, on supprime les propriétés numériques et 'service'
    const simplified = Object.fromEntries(
      Object.entries(data).filter(([key]) => isNaN(key) && key !== 'service')
    );
    return JSON.stringify(simplified);
  }
  return data;
};

// Format personnalisé pour la console
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: `;
  msg += simplifyData(message);
  
  if (Object.keys(metadata).length > 0 && !metadata.service) {
    msg += ' ' + simplifyData(metadata);
  }

  return msg;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  defaultMeta: { service: 'telegram-bot' },
  transports: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'error',
      format: winston.format.json()
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.json()
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      consoleFormat
    )
  }));
}

module.exports = logger;