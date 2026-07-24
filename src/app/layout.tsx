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
import { AppSidebar } from "@/lib/components/AppSidebar";
import { ThemeToggle } from "@/lib/components/ThemeToggle";
import "./globals.css";

// 하이드레이션 전에 저장된 테마를 <html>에 적용해 다크모드 깜빡임(FOUC)을 막는다.
// 저장값이 없으면 OS 설정을 따른다. ThemeToggle이 이후 클래스·localStorage를 갱신.
// IIFE로 전역 누출을 막고, localStorage 접근이 예외를 던져도(일부 프라이버시 모드)
// OS 감지 분기는 살아남도록 try를 분리한다.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark');return}if(t==='light'){return}}catch(e){}try{if(matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(e){}})()`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>
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
      </body>
    </html>
  );
}
