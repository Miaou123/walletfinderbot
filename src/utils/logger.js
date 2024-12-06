const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file');

const logDir = path.join(__dirname, '../logs');

// Fonction améliorée pour formater les données
const formatData = (data) => {
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';
  
  if (typeof data === 'object') {
    // Si c'est une erreur
    if (data instanceof Error) {
      return data.stack || data.message;
    }
    // Pour tous les autres objets
    try {
      return JSON.stringify(data, null, 2);
    } catch (err) {
      return '[Circular Object]';
    }
  }
  
  return data;
};

// Format personnalisé pour la console
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let output = `${timestamp} [${level}]: `;

  // Traiter le message principal
  if (typeof message === 'string' && metadata[Symbol.for('splat')]) {
    // Si on a des arguments supplémentaires (comme avec printf)
    const args = metadata[Symbol.for('splat')];
    const formattedArgs = args.map(arg => formatData(arg));
    output += message + ' ' + formattedArgs.join(' ');
  } else {
    output += formatData(message);
  }

  // Ajouter les métadonnées si présentes (en excluant les métadonnées système)
  const relevantMetadata = Object.entries(metadata)
    .filter(([key]) => !['service', Symbol.for('splat')].includes(key));
  
  if (relevantMetadata.length > 0) {
    output += ' ' + formatData(Object.fromEntries(relevantMetadata));
  }

  return output;
});

// Configuration du logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true })
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
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// Ajouter le transport console en développement
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      consoleFormat
    )
  }));
}

// Surcharger les méthodes de logging pour gérer automatiquement les objets
['error', 'warn', 'info', 'debug', 'verbose'].forEach(level => {
  const originalMethod = logger[level];
  logger[level] = (...args) => {
    if (args.length === 1 && typeof args[0] === 'object') {
      // Si on passe un seul argument qui est un objet
      return originalMethod.call(logger, '', { data: args[0] });
    }
    return originalMethod.call(logger, ...args);
  };
});

module.exports = logger;