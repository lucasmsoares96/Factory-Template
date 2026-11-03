import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Avatar, AvatarFallback } from "#ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "#ui/sidebar";
import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import { CompanySwitcher } from "../features/companies/switcher.tsx";
import { getMeQueryOptions, useGetMe } from "../gen/hooks/useGetMe.ts";
import { useGetNav } from "../gen/hooks/useGetNav.ts";
import { SIGN_IN_PATH, authClient, orThrow } from "./auth.ts";
import { navIcon } from "./nav-icons.ts";
import { errorCode, useErrorMessage, useMessages } from "./i18n.tsx";

/**
 * The layout of every page that needs a signed-in user (the home page, the
 * account page, and the Product's feature routes). Before any of them loads it
 * asks `GET /api/me`; without a session the visitor goes to the sign-in screen,
 * and comes back here after signing in. Its sidebar shows home and the
 * features' `nav` entries (`GET /api/nav`): the Skeleton's and the Product's,
 * and the Company switcher.
 */
export const Route = createFileRoute("/_signed-in")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(getMeQueryOptions());
    } catch (error) {
      if (errorCode(error) !== "UNAUTHENTICATED") throw error;
      throw redirect({ to: SIGN_IN_PATH, search: location.href === "/" ? {} : { redirect: location.href } });
    }
  },
  errorComponent: SignedInError,
  component: SignedIn,
});

function UserSummary({ name, email, testIds }: { name?: string; email?: string; testIds?: boolean }) {
  return (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg">{name?.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span data-testid={testIds ? "user-name" : undefined} className="truncate font-medium">
          {name}
        </span>
        <span data-testid={testIds ? "user-email" : undefined} className="truncate text-xs">
          {email}
        </span>
      </span>
    </>
  );
}

function SignedIn() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const nav = useGetNav();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => orThrow(authClient.signOut()),
    onSuccess: async () => {
      await navigate({ to: SIGN_IN_PATH, search: { signedOut: true } });
      queryClient.clear();
    },
  });
  const items = [{ label: t.nav.home, to: "/", icon: "House" }, ...(nav.data?.entries ?? [])];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <CompanySwitcher />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label={t.nav.label}>
                <SidebarMenu>
                  {items.map((entry) => (
                    <NavItem key={entry.to} entry={entry} />
                  ))}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <UserMenu signOut={signOut} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="font-semibold">{t.app.title}</span>
        </header>
        <div className="flex flex-col gap-6 p-4 md:p-8">
          {signOut.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(signOut.error)}</AlertDescription>
            </Alert>
          ) : null}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function UserMenu({ signOut }: { signOut: { isPending: boolean; mutate: () => void } }) {
  const t = useMessages();
  const me = useGetMe();
  const nav = useGetNav();
  const { isMobile } = useSidebar();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            aria-label={t.nav.userMenu}
            tooltip={me.data?.name}
            className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
          />
        }
      >
        <UserSummary name={me.data?.name} email={me.data?.email} testIds />
        <ChevronsUpDown className="ml-auto size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 min-w-56" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <UserSummary name={me.data?.name} email={me.data?.email} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/account" />}>
          <UserRound />
          {t.account.nav}
        </DropdownMenuItem>
        {(nav.data?.accountPage ?? []).map((entry) => {
          const Icon = navIcon(entry.icon);
          return (
            <DropdownMenuItem key={entry.to} render={<Link to={entry.to} />}>
              <Icon />
              {entry.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          <LogOut />
          {t.auth.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavItem({ entry }: { entry: { label: string; to: string; icon?: string } }) {
  const Icon = navIcon(entry.icon);
  const active = useMatchRoute()({ to: entry.to, fuzzy: entry.to !== "/" }) !== false;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} tooltip={entry.label} render={<Link to={entry.to} />}>
        <Icon />
        <span>{entry.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SignedInError({ error }: { error: unknown }) {
  const errorMessage = useErrorMessage();
  return (
    <Alert variant="destructive">
      <AlertDescription>{errorMessage(error)}</AlertDescription>
    </Alert>
  );
}
