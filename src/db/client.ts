import { PrismaClient } from "@prisma/client";
import { readDatabaseUrl } from "../config/database.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Reuses Prisma Client during watch/test runs so repeated imports do not open extra clients.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: readDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
