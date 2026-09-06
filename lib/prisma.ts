import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  const client = new PrismaClient();
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          let retries = 3;
          let delay = 1500;
          while (retries > 0) {
            try {
              return await query(args);
            } catch (error: any) {
              retries--;
              const isConnectionError = 
                error.name === 'PrismaClientInitializationError' || 
                (error.message && error.message.includes("Can't reach database server"));
                
              if (retries === 0 || !isConnectionError) throw error;
              
              console.log(`[Database] Neon pooler retry: Retrying ${model}.${operation} in ${delay}ms (${retries} attempts left)`);
              await new Promise((res) => setTimeout(res, delay));
              delay += 500;
            }
          }
        },
      },
    },
  });
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
