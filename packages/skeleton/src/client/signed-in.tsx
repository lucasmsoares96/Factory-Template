import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Avatar, AvatarFallback } from "#ui/avatar";
import { Button } from "#ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "#ui/dropdown-menu";
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
} from "#ui/sidebar";
import { ChevronsUpDown, LogOut } from "lucide-react";
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

function SignedIn() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const me = useGetMe();
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
        <SidebarHeader className="group-data-[collapsible=icon]:hidden">
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<SidebarMenuButton size="lg" aria-label={t.nav.userMenu} tooltip={me.data?.name} />}
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{me.data?.name?.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span data-testid="user-name" className="truncate font-medium">
                    {me.data?.name}
                  </span>
                  <ChevronsUpDown className="ml-auto size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="min-w-48">
                  <Button variant="ghost" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                    <LogOut />
                    {t.auth.signOut}
                  </Button>
                </DropdownMenuContent>
              </DropdownMenu>
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
