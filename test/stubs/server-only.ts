// `server-only` 스텁. 실제 패키지는 react-server 조건이 아닌 환경에서 import되면 throw한다
// — 클라이언트 번들 혼입을 막는 장치라 Next 밖(Vitest)에서는 의미가 없다.
export {};
