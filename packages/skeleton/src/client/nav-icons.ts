import { Circle, House, UserRound, type LucideIcon } from "lucide-react";

/**
 * The `lucide-react` icons a `nav` entry may name (`GET /api/nav` serves the
 * name, PascalCase). An explicit map keeps the bundle from carrying the whole
 * icon set; a Product that declares another icon adds it here. An unknown name
 * shows `Circle`, the default.
 */
const icons: Record<string, LucideIcon> = { Circle, House, UserRound };

export function navIcon(name: string | undefined): LucideIcon {
  return (name !== undefined && Object.hasOwn(icons, name) ? icons[name] : undefined) ?? Circle;
}
