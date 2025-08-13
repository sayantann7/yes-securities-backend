import { prisma } from "./prisma";

export class DatabaseHelper {
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        console.error(`Database operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Check if it's a connection error that might benefit from retry
        if (this.isRetryableError(error)) {
          console.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
          delay *= 2; // Exponential backoff
        } else {
          // If it's not a retryable error, don't retry
          throw error;
        }
      }
    }
    
    throw new Error('Maximum retry attempts reached');
  }
  
  static isRetryableError(error: any): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'connection lost',
      'connection terminated',
      'server has gone away'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';
    
    return retryableErrors.some(retryableError => 
      errorMessage.includes(retryableError) || errorCode.includes(retryableError)
    );
  }
  
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  static async testConnection(): Promise<boolean> {
    try {
      await this.withRetry(async () => {
        await prisma.$queryRaw`SELECT 1`;
      });
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }
}
