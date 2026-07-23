import { clerkMiddleware } from '@clerk/nextjs/server';

// Next 16에서 middleware는 proxy로 이름이 바뀌었다 — 파일명/함수만 다르고 역할은 동일.
// Clerk 권장(resource-based)대로 미들웨어는 auth 컨텍스트만 제공하고, 실제 보호는
// 각 페이지에서 auth.protect()로 한다 (createRouteMatcher 기반 보호는 deprecated).
export default clerkMiddleware();

export const config = {
  // Next 16 matcher는 중첩 capturing group을 허용하지 않는다 — 정적 자산과 _next를
  // 제외하고 나머지(Server Action POST 포함)에서 proxy가 돈다.
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // API 라우트는 경로에 점(.json 등)이 있어도 위 확장자 제외 패턴에 걸리지 않도록 항상 포함.
    // 웹훅 같은 공개 라우트도 통과하지만, clerkMiddleware는 기본적으로 아무것도 보호하지
    // 않으므로(resource-based) 차단되지 않는다.
    '/(api|trpc)(.*)',
  ],
};
