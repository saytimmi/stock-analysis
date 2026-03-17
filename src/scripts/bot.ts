import { createBot } from '../bot/index.js';

const bot = createBot();
const MINI_APP_URL = process.env.MINI_APP_URL || '';

async function setup() {
  // Register bot commands shown in Telegram menu
  await bot.api.setMyCommands([
    { command: 'start',   description: 'Открыть Mini App' },
    { command: 'patterns', description: 'Паттерны по тикеру (ALAB)' },
    { command: 'pattern', description: 'Создать свой паттерн' },
    { command: 'help',    description: 'Справка' },
  ]);

  // Set menu button (left side of text input) to open Mini App
  if (MINI_APP_URL) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: '📊 Приложение',
        web_app: { url: MINI_APP_URL },
      },
    });
    console.log('✅ Menu button set →', MINI_APP_URL);
  } else {
    // Fall back to commands button if no URL
    await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
    console.warn('⚠️  MINI_APP_URL not set — menu button is commands list');
  }
}

console.log('🤖 Stock Pattern Analyzer bot starting...');
bot.start({
  onStart: async (info) => {
    console.log(`✅ Bot @${info.username} is running`);
    await setup().catch(err => console.error('Setup error:', err));
  },
});
