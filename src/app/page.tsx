import { redirect } from 'next/navigation';

// 홈은 채팅으로 — 슬랙형 셸에서 채팅을 기본 착지점으로 앞세운다.
export default function Home() {
  redirect('/chat');
}
