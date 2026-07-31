import type { Metadata } from "next";
import NextLink from "next/link";
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
import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { AppSidebar } from "@/lib/components/AppSidebar";
import { ThemeProvider } from "@/lib/components/ThemeProvider";
import { ThemeToggle } from "@/lib/components/ThemeToggle";
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
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* .dark 클래스 토글 + 저장(localStorage 'theme'), 기본은 OS 설정.
            하이드레이션 전에 next-themes가 스크립트를 주입해 FOUC를 막는다 —
            그래서 <html>에 suppressHydrationWarning이 필요하다.
            disableTransitionOnChange로 전환 순간의 색 애니메이션 깜빡임을 없앤다. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/* Clerk UI(로그인·조직·유저 메뉴)를 한국어로 — localization={koKR} */}
          <ClerkProvider localization={koKR}>
            {/* 로그인 시: 슬랙형 셸(딥바이올렛 사이드바 + 상단바 + 스크롤 메인).
                h-svh + overflow-hidden으로 셸이 뷰포트를 채우고, 스크롤은 main·채팅이 각자 관리. */}
            <Show when="signed-in">
              <div className="flex h-svh overflow-hidden">
                <AppSidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                  <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
                    <OrganizationSwitcher />
                    <div className="flex items-center gap-2">
                      <NotificationBell />
                      <ThemeToggle />
                      <UserButton />
                    </div>
                  </header>
                  <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
                </div>
              </div>
            </Show>

            {/* 로그아웃 시: 사이드바 없이 브랜드 헤더 + 콘텐츠(대개 sign-in으로 redirect됨). */}
            <Show when="signed-out">
              <div className="flex min-h-svh flex-col">
                <header className="flex h-14 items-center justify-between border-b px-6">
                  <NextLink href="/" className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
                    >
                      D
                    </span>
                    <span className="font-semibold tracking-tight">DankangNote</span>
                  </NextLink>
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <SignInButton />
                    <SignUpButton />
                  </div>
                </header>
                <main className="flex-1">{children}</main>
              </div>
            </Show>
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
