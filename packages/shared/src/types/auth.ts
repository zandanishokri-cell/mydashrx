export type Role = 'super_admin' | 'pharmacy_admin' | 'dispatcher' | 'driver' | 'pharmacist';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string;
  depotIds: string[];
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: Role;
  orgId: string;
  depotIds: string[];
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}
