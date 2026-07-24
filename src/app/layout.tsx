import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { koKR } from "@clerk/localizations";
import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { NotebookPen } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavLink } from "@/lib/components/NavLink";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DankangNote",
  description: "노션·슬랙·지라를 잇는 협업 워크스페이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* attribute="class"로 .dark 토글, defaultTheme=system. disableTransitionOnChange로 전환 깜빡임 방지. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/* Clerk UI(로그인·조직·유저 메뉴)를 한국어로 — localization={koKR} */}
          <ClerkProvider localization={koKR}>
            <header className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b bg-background/70 px-6 py-3 backdrop-blur-md">
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <NotebookPen className="size-3.5" />
                  </span>
                  DankangNote
                </span>
                <Show when="signed-in">
                  <nav className="flex items-center gap-5">
                    <NavLink href="/notes">노트</NavLink>
                    <NavLink href="/chat">채팅</NavLink>
                    <NavLink href="/board">보드</NavLink>
                    <NavLink href="/members">멤버</NavLink>
                  </nav>
                </Show>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Show when="signed-out">
                  <SignInButton />
                  <SignUpButton />
                </Show>
                <Show when="signed-in">
                  <OrganizationSwitcher />
                  <UserButton />
                </Show>
              </div>
            </header>
            {children}
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
