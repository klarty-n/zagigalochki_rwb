export interface Filters { start: string; end: string; state: string }
export interface MonthPoint { month: string; orders: number; revenueCents: number }
export interface Seller { id: string; city: string; state: string; revenueCents: number; units: number; orders: number }
export interface Category { id: string | null; name: string; revenueCents: number; share: number }
export interface Overview {
  meta: { source: 'demo' | 'core' | 'team-snapshot'; loadedAt: string; currency: 'BRL'; filters: Filters; filtering?: boolean; categoryCount?: number; hasGroupedCategories?: boolean; provenance?: string };
  kpis: {
    revenueCents: number; averageOrderCents: number | null; customers: number; repeatBuyers: number;
    repeatPercent: number | null; deliveredOrders: number; allOrders: number | null;
    averageUnits: number | null; averageLines: number | null;
  };
  monthly: MonthPoint[]; sellers: Seller[]; categories: Category[]; regions: string[];
}
