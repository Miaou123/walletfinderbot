const validateAndParseTimeFrame = (timeFrame) => {
  if (!timeFrame) return 1;
  
  let value = parseFloat(timeFrame);
  let unit = timeFrame.replace(/[0-9.]/g, '').toLowerCase();

  // Convertir tout en heures
  switch (unit) {
    case 'm':
    case 'min':
      value /= 60;
      break;
    case 'd':
    case 'day':
    case 'days':
      value *= 24;
      break;
  }

  // Limites : 15 minutes (0.25h) à 7 jours (168h)
  if (isNaN(value) || value < 0.25 || value > 168) {
    throw new Error("Invalid time frame. Please enter:\n" +
                   "- Minutes: 15m to 300m\n" +
                   "- Hours: 0.25h to 168h\n" +
                   "- Days: 0.5d to 7d");
  }

  return Math.round(value * 100) / 100;
};

const validateAndParseMinAmountOrPercentage = (input, totalSupply, decimals) => {
  if (!input) {
    return { minAmount: BigInt(Math.floor((totalSupply * 0.01) * Math.pow(10, decimals))), minPercentage: 1 };
  }

  const value = parseFloat(input.replace('%', ''));

  if (isNaN(value) || value < 0.005 || value > 2) {
    throw new Error("Invalid input. Please enter a percentage between 0.005% and 2%.");
  }

  const minPercentage = value;
  const minAmount = BigInt(Math.floor((totalSupply * minPercentage / 100) * Math.pow(10, decimals)));

  return { minAmount, minPercentage };
};

module.exports = {
  validateAndParseTimeFrame,
  validateAndParseMinAmountOrPercentage
};