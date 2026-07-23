import type { Metadata } from "next";
import Link from "next/link";
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
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
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
      data-astryx-theme="neutral"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        {/* Clerk UI(로그인·조직·유저 메뉴)를 한국어로 — localization={koKR} */}
        <ClerkProvider localization={koKR}>
          <Stack
            as="header"
            direction="horizontal"
            justify="between"
            vAlign="center"
            gap={4}
            paddingInline={6}
            paddingBlock={3}
          >
            <Stack direction="horizontal" gap={5} vAlign="center">
              <Text weight="semibold">DankangNote</Text>
              <Show when="signed-in">
                <Stack direction="horizontal" gap={4} vAlign="center">
                  <Link href="/notes">
                    <Text color="secondary">노트</Text>
                  </Link>
                  <Link href="/members">
                    <Text color="secondary">멤버</Text>
                  </Link>
                </Stack>
              </Show>
            </Stack>
            <Stack direction="horizontal" gap={3} vAlign="center">
              <Show when="signed-out">
                <SignInButton />
                <SignUpButton />
              </Show>
              <Show when="signed-in">
                <OrganizationSwitcher />
                <UserButton />
              </Show>
            </Stack>
          </Stack>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
