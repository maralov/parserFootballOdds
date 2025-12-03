const axios = require('axios')
const token = process.env.TELEGRAM_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID

async function sendTelegramMessage(messageText = '') {
  const telegramApiUrl = `https://api.telegram.org/bot${token}/sendMessage`

  try {
    await axios.post(telegramApiUrl, {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'Markdown',
    })
    console.log('Message sent to Telegram')
  } catch (error) {
    console.error('Error sending message to Telegram:', error)
  }
}

module.exports = sendTelegramMessage
