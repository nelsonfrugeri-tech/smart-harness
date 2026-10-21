// Who is calling and which tenants (squads) they may see.

export type Role = "ADMIN" | "DEV";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

export interface Membership {
  tenant: Tenant;
  role: Role;
}

// Passed to every repository function that reads tenant data.
// An empty tenantIds list means the user sees nothing.
export interface Scope {
  userId: string;
  tenantIds: readonly string[];
}

// The authenticated user, rebuilt from the database on every request.
export interface Principal {
  user: User;
  memberships: Membership[];
  scope: Scope;
}

export function buildPrincipal(user: User, memberships: Membership[]): Principal {
  return {
    user,
    memberships,
    scope: { userId: user.id, tenantIds: memberships.map((membership) => membership.tenant.id) },
  };
}

// True when the caller is an ADMIN of this tenant. Publishing, approving and pinning a
// baseline all use this one rule.
export function isAdminOf(principal: Principal, tenantId: string): boolean {
  return principal.memberships.some((membership) => membership.tenant.id === tenantId && membership.role === "ADMIN");
}

// Serializes the scope for SQL as `tenant_id IN (SELECT value FROM json_each(?))`.
// Throws when a caller passes no scope, so an unscoped query never runs.
export function scopeTenantIdsJson(scope: Scope): string {
  if (!scope || !Array.isArray(scope.tenantIds)) {
    throw new Error("a tenant scope is required");
  }
  return JSON.stringify(scope.tenantIds);
}
