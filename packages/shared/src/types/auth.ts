export type Role = 'super_admin' | 'pharmacy_admin' | 'dispatcher' | 'driver' | 'pharmacist';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string;
  depotIds: string[];
  mustChangePassword?: boolean;
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
  tenantId: string;  // P-RBAC21: explicit tenant claim — always equals orgId, closes cross-tenant isolation risk
  depotIds: string[];
  mustChangePw?: boolean;
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}
