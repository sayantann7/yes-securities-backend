import { PrismaClient } from "@prisma/client";

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

// Graceful shutdown - only disconnect here; do not exit the process from this module
process.on('beforeExit', async () => {
  try {
    await prisma.$disconnect();
  } catch (e) {
    console.error('Error disconnecting Prisma on beforeExit:', e);
  }
});

process.on('SIGINT', async () => {
  try {
    await prisma.$disconnect();
  } catch (e) {
    console.error('Error disconnecting Prisma on SIGINT:', e);
  }
  // Let the main server file decide when to exit
});

process.on('SIGTERM', async () => {
  try {
    await prisma.$disconnect();
  } catch (e) {
    console.error('Error disconnecting Prisma on SIGTERM:', e);
  }
  // Let the main server file decide when to exit
});
