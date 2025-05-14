import { Product } from './productTypes'; // Assuming you have a Product type

export type OrderStatus =
  | 'awaiting_payment'
  | 'payment_failed'
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export interface OrderItemInput {
  product_id: string;
  quantity: number;
  // price_at_purchase will be determined at backend
}

export interface OrderItem extends OrderItemInput {
  id: string;
  order_id: string;
  price_at_purchase: number;
  created_at: string;
  updated_at: string;
  products?: Pick<Product, 'id' | 'name' | 'image_url' | 'description'>; // Optional: for joining
}

export interface OrderInput {
  user_id: string; // Should be derived from authenticated user server-side
  items: OrderItemInput[];
  shipping_address: any; // JSONB
  billing_address?: any; // JSONB
  // total_amount, status, payment details will be handled server-side
}

export interface Order {
  id: string;
  user_id: string;
  total_amount: number;
  status: OrderStatus;
  shipping_address: any; // JSONB
  billing_address: any; // JSONB
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[]; // Optional: for joining
  payment_provider?: string;
  payment_intent_id?: string | null;
  payment_client_secret?: string | null; // For frontend payment processing
}
