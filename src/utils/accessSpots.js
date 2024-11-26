// Dans un nouveau fichier, par exemple accessUtils.js
const fs = require('fs');
const path = require('path');
const logger = require('./logger'); // Assurez-vous que le chemin est correct

const getAvailableSpots = () => {
  const accessFilePath = path.join(__dirname, '../config/access.json');
  let accessData;
  try {
    const rawData = fs.readFileSync(accessFilePath);
    accessData = JSON.parse(rawData);
    const totalAllowedUsers = accessData.allowedUsers.length;
    const maxUsers = 300;
    const availableSpots = maxUsers - totalAllowedUsers;
    return { availableSpots, maxUsers };
  } catch (error) {
    logger.error('Error reading access.json:', error);
    return null;
  }
};

module.exports = {
    getAvailableSpots
  };