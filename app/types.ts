export type Category = {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
};

export type Product = {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  image: string;
  active: boolean;
  sortOrder: number;
};

export type PickupLocation = {
  id: number;
  name: string;
  address: string;
  phone: string;
  hours: string;
  opensAt: string;
  latitude: number;
  longitude: number;
  active: boolean;
};

export type Promotion = {
  id: number;
  title: string;
  description: string;
  image: string;
  active: boolean;
  sortOrder: number;
};

export type CartLine = Product & { quantity: number };

export type OrderStatus =
  | "new"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

