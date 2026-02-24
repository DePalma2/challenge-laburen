const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const messages = await prisma.message.findMany({ where: { chatId: 'chat-default' } });
  console.log(JSON.stringify(messages, null, 2));
}
check();
