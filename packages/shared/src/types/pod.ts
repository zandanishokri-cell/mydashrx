export interface Signature {
  svgData: string;
  signerName: string;
  capturedAt: string;
  lat: number;
  lng: number;
}

export interface Photo {
  url: string;
  key: string;
  capturedAt: string;
  lat: number;
  lng: number;
}

export interface AgeVerification {
  verified: boolean;
  idType?: 'drivers_license' | 'passport' | 'state_id' | 'other';
  idLastFour?: string;
  dobConfirmed: boolean;
  refusedNote?: string;
}

export interface ProofOfDelivery {
  id: string;
  stopId: string;
  driverId: string;
  packageCount: number;
  signature?: Signature;
  photos: Photo[];
  ageVerification?: AgeVerification;
  codCollected?: { amount: number; method: 'cash' | 'card' | 'waived'; note?: string };
  driverNote?: string;
  customerNote?: string;
  capturedAt: string;
}
