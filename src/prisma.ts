import { PrismaClient } from "./generated/prisma";

declare global {
  var __prisma: PrismaClient | undefined;
}

// Singleton pattern for Prisma Client to prevent multiple instances
export const prisma = globalThis.__prisma || new PrismaClient({
  log: ['error', 'warn'],
  errorFormat: 'minimal',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
