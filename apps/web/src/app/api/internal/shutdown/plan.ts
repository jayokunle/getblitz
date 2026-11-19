/**
 * Pure selection logic for the Stage 4 purge (unit-tested).
 *
 * Kept: the operator's organizations (by slug) and every user who is a member
 * of at least one of them. Everything else is deleted.
 */
export interface OrgRow {
  id: string;
  slug: string;
  memberUserIds: string[];
}

export interface PurgeSelection {
  keepOrgIds: string[];
  deleteOrgIds: string[];
  deleteOrgSlugs: string[];
  keepUserIds: string[];
  deleteUserIds: string[];
  missingKeepSlugs: string[];
}

export function selectPurge(
  orgs: OrgRow[],
  allUserIds: string[],
  keepOrgSlugs: readonly string[],
): PurgeSelection {
  const keep = new Set(keepOrgSlugs);
  const keepOrgs = orgs.filter((o) => keep.has(o.slug));
  const deleteOrgs = orgs.filter((o) => !keep.has(o.slug));
  const keepUsers = new Set(keepOrgs.flatMap((o) => o.memberUserIds));
  const found = new Set(keepOrgs.map((o) => o.slug));
  return {
    keepOrgIds: keepOrgs.map((o) => o.id),
    deleteOrgIds: deleteOrgs.map((o) => o.id),
    deleteOrgSlugs: deleteOrgs.map((o) => o.slug).sort(),
    keepUserIds: [...keepUsers],
    deleteUserIds: allUserIds.filter((id) => !keepUsers.has(id)),
    missingKeepSlugs: keepOrgSlugs.filter((s) => !found.has(s)),
  };
}

/** Confirmation token the operator must send to execute a destructive mode. */
export function confirmToken(mode: string, count: number): string {
  return `${mode.toUpperCase()}-${count}`;
}
