import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "#ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "#ui/sidebar";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useListCompanies } from "../../gen/hooks/useListCompanies.ts";
import { useMessages } from "../../client/i18n.tsx";
import { useRoleLabel } from "./role-label.ts";

/** Height of the page header (`h-14`): the menu opens to the right, below it, so it never covers the header. */
const PAGE_HEADER_HEIGHT = 56;

/**
 * The signed-in shell's Company switcher: the user's Companies (the first page
 * of `GET /api/companies`), the active one being the Company of the URL.
 * Choosing another opens its page; New Company opens the creation form. With no
 * Company at all, the button itself leads to the creation form.
 */
export function CompanySwitcher() {
  const t = useMessages();
  const roleLabel = useRoleLabel();
  const navigate = useNavigate();
  const { isMobile } = useSidebar();
  const { companyId } = useParams({ strict: false }) as { companyId?: string };
  const companies = useListCompanies();
  const items = companies.data?.items ?? [];
  const active = items.find((company) => company.id === companyId);

  if (companies.isSuccess && items.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip={t.companies.switcher.new} render={<Link to="/c/new" />}>
            <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Plus className="size-4" />
            </span>
            <span className="truncate font-medium">{t.companies.switcher.new}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                aria-label={t.companies.switcher.label}
                tooltip={active?.name ?? t.companies.switcher.choose}
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <span aria-hidden className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              {active ? active.name.slice(0, 1).toUpperCase() : <Plus className="size-4" />}
            </span>
            <span className="grid flex-1 text-left text-sm leading-tight">
              <span data-testid="company-name" className="truncate font-medium">
                {active?.name ?? t.companies.switcher.choose}
              </span>
              {active ? (
                <span data-testid="company-role-label" className="truncate text-xs">
                  {roleLabel(active.role)}
                </span>
              ) : null}
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 min-w-56" side={isMobile ? "bottom" : "right"} align="start" alignOffset={isMobile ? 0 : PAGE_HEADER_HEIGHT} sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t.companies.switcher.title}</DropdownMenuLabel>
              {items.map((company) => (
                <DropdownMenuItem
                  key={company.id}
                  onClick={() => void navigate({ to: "/c/$companyId", params: { companyId: company.id } })}
                >
                  <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md border text-xs">
                    {company.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{company.name}</span>
                  {company.id === companyId ? <Check data-testid="company-active" className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/c/new" />}>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </span>
              {t.companies.switcher.new}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
