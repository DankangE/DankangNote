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
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* Clerk UI(로그인·조직·유저 메뉴)를 한국어로 — localization={koKR} */}
        <ClerkProvider localization={koKR}>
          <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
            <div className="flex items-center gap-5">
              <span className="font-semibold">DankangNote</span>
              <Show when="signed-in">
                <nav className="flex items-center gap-4">
                  <NavLink href="/notes">노트</NavLink>
                  <NavLink href="/chat">채팅</NavLink>
                  <NavLink href="/board">보드</NavLink>
                  <NavLink href="/members">멤버</NavLink>
                </nav>
              </Show>
            </div>
            <div className="flex items-center gap-3">
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
