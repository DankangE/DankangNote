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
import { NavLink } from "@/lib/components/NavLink";
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
          <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b bg-background/80 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-5">
              <NextLink href="/notes" className="flex items-center gap-2">
                {/* 브랜드 마크 — 바이올렛 스퀘어 모노그램 */}
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
                >
                  D
                </span>
                <span className="font-semibold tracking-tight">DankangNote</span>
              </NextLink>
              <Show when="signed-in">
                <nav className="flex items-center gap-4">
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
      </body>
    </html>
  );
}
