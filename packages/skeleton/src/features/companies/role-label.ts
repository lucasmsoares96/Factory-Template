import { useMessages } from "../../client/i18n.tsx";

/** A role's name on screen: the Skeleton's roles translated, a role the Product added as stored. */
export function useRoleLabel(): (role: string) => string {
  const { companies } = useMessages();
  return (role) => (Object.hasOwn(companies.roles, role) ? companies.roles[role as keyof typeof companies.roles] : role);
}
