How does the bot work:

Telegram bot initializes the bot correctly with users and handlers etc

When user type a command: it goes to telegram.js bot.on(message) then it goes to commandhandlers  then it's parsed correctly then it goes to the actual command to be exectued then back to the handler and finally sent to the formatter