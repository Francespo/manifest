export interface KeyQuotaBucketStatus {
  provider: string;
  model: string;
  modelFamily: string;
  keyLabel: string;
  keyIdentity: string;
  rpmUsed: number;
  rpmLimit: number | null;
  tpmUsed: number;
  tpmLimit: number | null;
  rpdUsed: number;
  rpdLimit: number | null;
  frozenUntil: number | null;
  freezeReason: string | null;
  status: 'active' | 'cooldown' | 'exhausted';
  lastUsedAt: string | null;
}

export interface ModelQuotaStatusResponse {
  buckets: KeyQuotaBucketStatus[];
  timestamp: string;
}
