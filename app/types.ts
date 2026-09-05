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
  naktaCoins?: number;
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

export type Customer = {
  id?: number | string;
  phone: string;
  name?: string | null;
};

export type CustomerSession = {
  customer: Customer;
  phone: string;
  expiresAt?: number;
};

export type RewardWithdrawalStatus =
  | "owned"
  | "pending"
  | "submitted"
  | "withdrawn"
  | "failed"
  | "cancelled";

export type NftNetwork = "polygon" | "ethereum" | "bsc" | "solana" | "ton";

export type NaktaCoinTransaction = {
  id: string;
  amount: number;
  description: string;
  createdAt?: string | null;
  orderId?: number | string | null;
  withdrawalId?: string | null;
  withdrawalStatus?: Exclude<RewardWithdrawalStatus, "owned">;
  withdrawalReason?: string | null;
};

export type CustomerNft = {
  id: string;
  name: string;
  image?: string | null;
  description?: string | null;
  network: NftNetwork;
  contractAddress?: string | null;
  tokenId?: string | null;
  status: Exclude<RewardWithdrawalStatus, "cancelled">;
  walletAddress?: string | null;
  txHash?: string | null;
  withdrawalError?: string | null;
  withdrawalRequestedAt?: string | null;
  createdAt: string;
  withdrawnAt?: string | null;
  orderId?: number | string | null;
};

export type NaktaCoinWithdrawal = {
  id: string;
  amount: number;
  walletAddress: string;
  network?: NftNetwork | string;
  status: Exclude<RewardWithdrawalStatus, "owned">;
  txHash?: string | null;
  error?: string | null;
  processedAt?: string | null;
  createdAt: string;
};

export type ProfileOrder = {
  id: number | string;
  orderNumber?: string | number;
  total: number;
  status: OrderStatus | string;
  createdAt: string;
  locationName?: string | null;
  locationAddress?: string | null;
  earnedNaktaCoins?: number;
  naktaCoins?: number;
};

export type CustomerProfile = {
  customer: Customer;
  naktaCoins: number;
  coinNetwork?: NftNetwork | string;
  naktaCoinHistory: NaktaCoinTransaction[];
  nfts: CustomerNft[];
  naktaCoinWithdrawals: NaktaCoinWithdrawal[];
  currentOrders: ProfileOrder[];
  orderHistory: ProfileOrder[];
};
