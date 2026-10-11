'use client';

import { createContext, useContext } from 'react';

/**
 * Whether the person looking is an administrator, for drawing admin-only
 * controls (the "Remove from public viewing" item in a post's ••• menu).
 *
 * Only ever decides what is SHOWN. Every admin action re-checks the role and
 * the admin's second step on the server, so a forged flag here gets a refusal.
 */
const ViewerIsAdmin = createContext(false);

export function ViewerRoleProvider({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  return <ViewerIsAdmin.Provider value={isAdmin}>{children}</ViewerIsAdmin.Provider>;
}

export const useViewerIsAdmin = () => useContext(ViewerIsAdmin);
