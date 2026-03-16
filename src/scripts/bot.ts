import { createBot } from '../bot/index.js';

const bot = createBot();

console.log('🤖 Stock Pattern Analyzer bot starting...');
bot.start({
  onStart: (info) => {
    console.log(`✅ Bot @${info.username} is running`);
  },
});
