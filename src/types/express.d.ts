// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Request } from 'express';

declare global {
  namespace Express {
    export interface User {
      id: string;
      // Add other user properties if your JWT/auth setup includes them
      // email?: string;
      // role?: string; 
    }
    export interface Request {
      user?: User;
    }
  }
}
