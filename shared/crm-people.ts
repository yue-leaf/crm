import type { CrmSession } from './api.interface';

// Names are display text, never identity keys. A person may have both an
// external-contact account and an employee account with the same name.
export function employeeOptions<T extends { userType?: string; userID?: string }>(users: T[]): T[] {
  const seen = new Set<string>();
  return users.filter(user => {
    if (user.userType !== '_employee' || !user.userID || !/^[1-9]\d*$/.test(user.userID) || seen.has(user.userID)) return false;
    seen.add(user.userID);
    return true;
  });
}

export function defaultEmployeeSelection(session: CrmSession | null): string[] {
  return session?.isEmployee === true ? [session.userId] : [];
}
