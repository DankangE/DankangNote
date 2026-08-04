import { clerkMiddleware } from '@clerk/nextjs/server';

// Next 16에서 middleware는 proxy로 이름이 바뀌었다 — 파일명/함수만 다르고 역할은 동일.
// Clerk 권장(resource-based)대로 미들웨어는 auth 컨텍스트만 제공하고, 실제 보호는
// 각 페이지에서 auth.protect()로 한다 (createRouteMatcher 기반 보호는 deprecated).
export default clerkMiddleware();

export const config = {
  // Next 16 matcher는 중첩 capturing group을 허용하지 않는다 — 정적 자산과 _next를
  // 제외하고 나머지(Server Action POST 포함)에서 proxy가 돈다.
  //
  // 확장자 목록 끝의 `$`가 이 패턴의 핵심이다(KAN-60). 앵커 대신 `js(?!on)`처럼
  // **중첩 lookahead**로 .json을 되살리면 dev(Turbopack)가 이 matcher를 컴파일하지 못해
  // **아무 경로도 매칭하지 않는다** — 에러 한 줄 없이 proxy가 통째로 안 도는 것이라,
  // auth()를 쓰는 모든 라우트가 'clerkMiddleware()를 못 찾겠다'는 500으로 죽는다.
  // prod 빌드는 같은 패턴이 정상 동작해서 tsc·lint·build로는 잡히지 않는다.
  // `$`로 끝맺으면 `.json`은 목록에 없어 자연히 포함되므로, 중첩 없이 같은 의도가 된다.
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)$).*)',
    // API 라우트는 경로에 점(.json 등)이 있어도 위 확장자 제외 패턴에 걸리지 않도록 항상 포함.
    // 웹훅 같은 공개 라우트도 통과하지만, clerkMiddleware는 기본적으로 아무것도 보호하지
    // 않으므로(resource-based) 차단되지 않는다.
    '/(api|trpc)(.*)',
  ],
};
