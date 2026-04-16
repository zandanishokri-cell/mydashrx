export interface Organization {
  id: string;
  name: string;
  timezone: string;
  hipaaBaaStatus: 'pending' | 'signed';
  billingPlan: 'starter' | 'growth' | 'pro' | 'enterprise';
  createdAt: string;
}

export interface Depot {
  id: string;
  orgId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  operatingHours: { open: string; close: string };
}

export type DriverStatus = 'available' | 'on_route' | 'offline';

export interface Driver {
  id: string;
  orgId: string;
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  drugCapable: boolean;
  vehicleType: 'car' | 'van' | 'bicycle';
  status: DriverStatus;
  currentLat?: number;
  currentLng?: number;
  lastPingAt?: string;
  zoneIds: string[];
}

export type PlanStatus = 'draft' | 'optimized' | 'distributed' | 'completed';

export interface Plan {
  id: string;
  orgId: string;
  depotId: string;
  date: string;
  status: PlanStatus;
  totalStops: number;
  completedStops: number;
  createdAt: string;
}

export type RouteStatus = 'pending' | 'active' | 'completed';

export interface Route {
  id: string;
  planId: string;
  driverId: string;
  status: RouteStatus;
  stopOrder: string[];
  startedAt?: string;
  completedAt?: string;
  estimatedDuration: number;
  totalDistance: number;
}

export type StopStatus = 'pending' | 'en_route' | 'arrived' | 'completed' | 'failed' | 'rescheduled';

/** All statuses that represent a stop no longer requiring driver action. */
export const TERMINAL_STATUSES: StopStatus[] = ['completed', 'failed', 'rescheduled'];
export const isTerminalStatus = (status: string): boolean => (TERMINAL_STATUSES as string[]).includes(status);

export type FailureReason =
  | 'not_home'
  | 'refused'
  | 'wrong_address'
  | 'patient_hospitalized'
  | 'safety_concern'
  | 'inaccessible'
  | 'other';

export interface Stop {
  id: string;
  routeId: string;
  orgId: string;
  recipientName: string;
  recipientPhone: string;
  address: string;
  unit?: string;
  deliveryNotes?: string;
  lat: number;
  lng: number;
  rxNumbers: string[];
  packageCount: number;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  codAmount?: number;
  requiresSignature: boolean;
  requiresPhoto: boolean;
  requiresAgeVerification: boolean;
  windowStart?: string;
  windowEnd?: string;
  status: StopStatus;
  failureReason?: FailureReason;
  failureNote?: string;
  completedAt?: string;
  arrivedAt?: string;
  trackingToken: string;
  sequenceNumber: number;
}
