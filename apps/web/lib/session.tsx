'use client';
import { useQuery } from '@tanstack/react-query';
import type { Permission, Role } from '@rupeemap/shared';
import { api } from './api';

export interface Me {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  role: Role;
  status: string;
  permissions: Permission[];
  dsaCode: string | null;
  dsa: { id: string; name: string; mobile: string } | null;
  kycStatus: string | null;
  lastLoginAt: string | null;
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 60_000, retry: false });
}

/** UI hint only; the API enforces every permission again. */
export function useCan() {
  const { data } = useMe();
  return (p: Permission) => !!data?.permissions.includes(p);
}
